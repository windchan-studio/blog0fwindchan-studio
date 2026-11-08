#!/usr/bin/env node
/**
 * 《风风博客·制片厂》分段离线渲染 CLI 与清单生成器（studio-render.mjs）。
 *
 * 核心流程（ARCHITECTURE §7）：
 * 1. 读取 studio.config.json（不存在时回退至 studio.config.example.json）与目标剧本 JSON；
 * 2. 启动 Playwright Chromium Headless（固定整数视口 1920×1080，deviceScaleFactor=1）；
 * 3. 导航至目标文章演播室页面（不带 director 参数，控制栏不入画）；
 * 4. 调用 window.__studio.ready() 完成字体、图片解码与 L1~L3 校验（有 error 则立即拒绝开工）；
 * 5. 按分段计算确定性 SHA-256 哈希（支持 --incremental 跳过未变更分段与 --segment 指定分段重渲）；
 * 6. 逐帧调用 window.__studio.seek(t)，将 PNG Buffer 通过 image2pipe 管道直通 FFmpeg stdin 编码为 MP4；
 * 7. 生成包含分段帧区间与 PR 音轨对齐时间码（music_cues）的 manifest.json。
 */

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const STUDIO_ROOT = path.join(PROJECT_ROOT, 'studio')

/**
 * 解析命令行参数。
 */
function parseCliArgs(argv) {
  const args = {
    script: '',
    segments: null,
    codec: '',
    fps: 0,
    incremental: false,
    baseUrl: '',
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--script' && argv[i + 1]) {
      args.script = argv[++i]
    } else if (token.startsWith('--script=')) {
      args.script = token.slice('--script='.length)
    } else if (token === '--segment' && argv[i + 1]) {
      args.segments = argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (token.startsWith('--segment=')) {
      args.segments = token
        .slice('--segment='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (token === '--codec' && argv[i + 1]) {
      args.codec = argv[++i]
    } else if (token.startsWith('--codec=')) {
      args.codec = token.slice('--codec='.length)
    } else if (token === '--fps' && argv[i + 1]) {
      args.fps = Number(argv[++i])
    } else if (token.startsWith('--fps=')) {
      args.fps = Number(token.slice('--fps='.length))
    } else if (token === '--incremental') {
      args.incremental = true
    } else if (token === '--base-url' && argv[i + 1]) {
      args.baseUrl = argv[++i]
    }
  }

  return args
}

/**
 * 读取 studio.config.json（若未创建则回退读取 studio.config.example.json）。
 */
function loadStudioConfig() {
  const localCfgPath = path.join(STUDIO_ROOT, 'studio.config.json')
  const exampleCfgPath = path.join(STUDIO_ROOT, 'studio.config.example.json')
  const targetPath = fs.existsSync(localCfgPath) ? localCfgPath : exampleCfgPath

  const defaults = {
    ffmpegPath: 'ffmpeg',
    defaultCodec: 'libx264',
    defaultFps: 30,
    baseUrl: 'http://localhost:5173',
    outputDir: 'studio/output',
  }

  if (!fs.existsSync(targetPath)) {
    return defaults
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf-8'))
    return { ...defaults, ...parsed }
  } catch {
    return defaults
  }
}

/**
 * 计算对象的 16 位确定性 SHA-256 十六进制摘要。
 */
function computeShortSha256(payload) {
  const jsonStr =
    typeof payload === 'string' ? payload : JSON.stringify(payload)
  return crypto.createHash('sha256').update(jsonStr).digest('hex').slice(0, 16)
}

/**
 * 计算分段与歌单时间线的交集（music_cues），用于 manifest.json 的 PR 音轨对齐（PRD US7）。
 */
function computeSegmentMusicCues(segStartMs, segEndMs, musicTracks) {
  const cues = []
  for (const tr of musicTracks) {
    const overlapStart = Math.max(segStartMs, tr.videoStartMs)
    const overlapEnd = Math.min(segEndMs, tr.videoEndMs)
    if (overlapStart < overlapEnd) {
      cues.push({
        ref: tr.ref,
        title: tr.bakeData?.meta?.title || tr.ref,
        in_segment_start_ms: Math.round(overlapStart - segStartMs),
        in_segment_end_ms: Math.round(overlapEnd - segStartMs),
        in_video_start_ms: Math.round(overlapStart),
        in_song_start_ms: Math.round(
          tr.startAtMs + (overlapStart - tr.videoStartMs),
        ),
      })
    }
  }
  return cues
}

/**
 * 带背压控制的管道写入。
 */
function writeToStreamWithBackpressure(stream, buffer) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup()
      reject(err)
    }
    const cleanup = () => {
      stream.off('error', onError)
    }

    stream.once('error', onError)
    const ok = stream.write(buffer)
    if (ok) {
      cleanup()
      resolve()
    } else {
      stream.once('drain', () => {
        cleanup()
        resolve()
      })
    }
  })
}

/**
 * 根据选定的编码器生成 FFmpeg 视频编码参数。
 */
function buildEncoderArgs(codec) {
  switch (codec) {
    case 'h264_nvenc':
      return [
        '-c:v',
        'h264_nvenc',
        '-preset',
        'p5',
        '-cq',
        '19',
        '-pix_fmt',
        'yuv420p',
      ]
    case 'h264_qsv':
      return [
        '-c:v',
        'h264_qsv',
        '-global_quality',
        '19',
        '-pix_fmt',
        'yuv420p',
      ]
    case 'libx264':
    default:
      return [
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
      ]
  }
}

/**
 * 使用 FFmpeg image2pipe 渲染单个分段。
 */
async function renderSegmentToMp4({
  page,
  ffmpegPath,
  codec,
  fps,
  segment,
  outputMp4Path,
}) {
  const startFrame = segment.startFrame
  const endFrame = segment.endFrame
  const frameCount = Math.max(1, endFrame - startFrame)

  const ffArgs = [
    '-y',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    '-framerate',
    String(fps),
    '-i',
    '-',
    ...buildEncoderArgs(codec),
    '-movflags',
    '+faststart',
    outputMp4Path,
  ]

  const ffProc = spawn(ffmpegPath, ffArgs, {
    stdio: ['pipe', 'ignore', 'pipe'],
  })

  let stderrLog = ''
  ffProc.stderr.on('data', (chunk) => {
    stderrLog += chunk.toString()
  })

  const exitPromise = new Promise((resolve, reject) => {
    ffProc.on('error', reject)
    ffProc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(
            `FFmpeg 退出码 ${code}。\n命令: ${ffmpegPath} ${ffArgs.join(' ')}\n输出:\n${stderrLog.slice(-800)}`,
          ),
        )
      }
    })
  })

  for (let f = startFrame; f < endFrame; f++) {
    const timeMs = (f / fps) * 1000
    await page.evaluate((ms) => window.__studio.seek(ms), timeMs)
    const pngBuffer = await page.screenshot({ type: 'png' })
    await writeToStreamWithBackpressure(ffProc.stdin, pngBuffer)

    const doneFrames = f - startFrame + 1
    if (doneFrames % 15 === 0 || doneFrames === frameCount) {
      const pct = ((doneFrames / frameCount) * 100).toFixed(1)
      process.stdout.write(
        `\r  🎬 [${segment.id}] 帧 ${doneFrames}/${frameCount} (${pct}%)`,
      )
    }
  }
  process.stdout.write('\n')

  ffProc.stdin.end()
  await exitPromise
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2))
  if (!cli.script) {
    console.error(
      '❌ 请通过 --script <剧本id> 指定要渲染的剧本，例如：\n   npm run studio:render -- --script example',
    )
    process.exit(1)
  }

  const studioCfg = loadStudioConfig()
  const scriptPath = path.join(
    STUDIO_ROOT,
    'scripts',
    `${cli.script}.script.json`,
  )
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ 找不到剧本文件: ${scriptPath}`)
    process.exit(1)
  }

  const rawScript = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'))
  const baseUrl = (cli.baseUrl || studioCfg.baseUrl).replace(/\/+$/, '')
  const codec = cli.codec || studioCfg.defaultCodec || 'libx264'
  const fps =
    cli.fps === 24 || cli.fps === 30
      ? cli.fps
      : rawScript.video?.fps || studioCfg.defaultFps || 30
  const width = rawScript.video?.width || 1920
  const height = rawScript.video?.height || 1080
  const zoom = rawScript.video?.zoom || 1.1

  const category = rawScript.article?.category || 'topics'
  const slug = rawScript.article?.slug
  const targetUrl = `${baseUrl}/articles/${encodeURIComponent(category)}/${encodeURIComponent(slug)}?studio=${encodeURIComponent(cli.script)}`

  const outDir = path.resolve(PROJECT_ROOT, studioCfg.outputDir, rawScript.id)
  fs.mkdirSync(outDir, { recursive: true })
  const manifestPath = path.join(outDir, 'manifest.json')

  let previousManifest = null
  if (fs.existsSync(manifestPath)) {
    try {
      previousManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
      previousManifest = null
    }
  }

  console.log(`🚀 启动《风风博客·制片厂》离线渲染管线`)
  console.log(`   剧本: ${rawScript.title} (${rawScript.id})`)
  console.log(`   页面: ${targetUrl}`)
  console.log(`   规格: ${width}×${height} @ ${fps}fps (zoom=${zoom}, codec=${codec})`)

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    })
    const page = await context.newPage()

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
    const readyPayload = await page.evaluate(() => window.__studio.ready(20000))

    if (readyPayload.loadError) {
      console.error(`❌ 剧本加载失败: ${readyPayload.loadError}`)
      process.exit(1)
    }

    if (readyPayload.warnings && readyPayload.warnings.length > 0) {
      console.warn(`⚠️ 校验警告 (${readyPayload.warnings.length} 项):`)
      for (const w of readyPayload.warnings) {
        console.warn(`   - [${w.layer}] ${w.path}: ${w.message}`)
      }
    }

    if (!readyPayload.valid || (readyPayload.errors && readyPayload.errors.length > 0)) {
      console.error(`❌ 剧本校验未通过，拒绝渲染 (${readyPayload.errors.length} 个错误):`)
      for (const err of readyPayload.errors) {
        console.error(`   - [${err.layer}] ${err.path}: ${err.message}`)
      }
      process.exit(1)
    }

    const timeline = readyPayload.compiledTimeline
    const articleContentHash = computeShortSha256(
      String(readyPayload.articleTextLength),
    )

    const manifestSegments = []
    for (let i = 0; i < timeline.segments.length; i++) {
      const seg = timeline.segments[i]
      const seqStr = String(i + 1).padStart(2, '0')
      const fileName = `${seqStr}-${seg.id}.mp4`
      const filePath = path.join(outDir, fileName)

      const musicCues = computeSegmentMusicCues(
        seg.startMs,
        seg.endMs,
        timeline.music.tracks,
      )

      const segHash = computeShortSha256({
        videoConfig: { width, height, fps, zoom },
        articleContentHash,
        segmentStartMs: seg.startMs,
        enteredState: seg.enteredState,
        segmentDefinition: rawScript.segments[i],
        musicSlice: musicCues,
      })

      const startFrame = Math.floor((seg.startMs * fps) / 1000)
      const endFrame = Math.round((seg.endMs * fps) / 1000)

      const shouldFilterSkip =
        cli.segments && !cli.segments.includes(seg.id)
      const prevSegEntry = previousManifest?.segments?.find(
        (s) => s.id === seg.id && s.file === fileName,
      )
      const shouldIncrementalSkip =
        cli.incremental &&
        prevSegEntry &&
        prevSegEntry.hash === segHash &&
        fs.existsSync(filePath)

      if (shouldFilterSkip) {
        console.log(`⏭️ 跳过未指定分段 [${fileName}]`)
      } else if (shouldIncrementalSkip) {
        console.log(`✨ 增量跳过未改动分段 [${fileName}] (hash=${segHash})`)
      } else {
        console.log(
          `🎞️ 开始渲染分段 #${i + 1} [${fileName}] (${seg.durationMs}ms, 帧 ${startFrame}..${endFrame})`,
        )
        await renderSegmentToMp4({
          page,
          ffmpegPath: studioCfg.ffmpegPath,
          codec,
          fps,
          segment: { ...seg, startFrame, endFrame },
          outputMp4Path: filePath,
        })
      }

      manifestSegments.push({
        index: i + 1,
        id: seg.id,
        title: seg.title,
        file: fileName,
        hash: segHash,
        start_ms: seg.startMs,
        end_ms: seg.endMs,
        duration_ms: seg.durationMs,
        start_frame: startFrame,
        end_frame: endFrame,
        frame_count: Math.max(0, endFrame - startFrame),
        music_cues: musicCues,
      })
    }

    const manifest = {
      version: 1,
      script_id: timeline.scriptId,
      title: timeline.title,
      rendered_at: new Date().toISOString(),
      video: {
        width,
        height,
        fps,
        zoom,
        codec,
        total_duration_ms: timeline.totalDurationMs,
        total_frames: Math.round((timeline.totalDurationMs * fps) / 1000),
      },
      music_timeline: timeline.music.tracks.map((tr) => ({
        track_index: tr.trackIndex,
        ref: tr.ref,
        title: tr.bakeData?.meta?.title || tr.ref,
        artist: tr.bakeData?.meta?.artist || '',
        video_start_ms: tr.videoStartMs,
        video_end_ms: tr.videoEndMs,
        song_start_at_ms: tr.songStartAtMs,
        song_end_at_ms: tr.songEndAtMs,
      })),
      segments: manifestSegments,
    }

    fs.writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8',
    )
    console.log(`✅ 渲染完成！清单已写入: ${manifestPath}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('❌ 渲染异常中止:', err)
  process.exit(1)
})
