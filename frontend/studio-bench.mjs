/**
 * studio-bench.mjs — 视频渲染管线基准测试脚本
 *
 * 在目标博客文章页面上，对比测量 Playwright 无头 Chromium 逐帧截图性能（CPU 软渲染 vs GPU 硬件合成），
 * 以及 FFmpeg 将图像序列合成为 MP4 视频的编码耗时（libx264 软编 vs 硬件加速编码）。
 *
 * @example
 * ```bash
 * # 需确保前后端开发服务均已启动，随后在 frontend/ 目录下执行：
 * node studio-bench.mjs
 * ```
 */

import { chromium } from 'playwright-core'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ─── 基准测试配置 ───────────────────────────────────────
const TARGET_URL =
  process.env.STUDIO_BENCH_URL || 'http://localhost:5173/articles/frontend/blog-introduction-0'
const FRAME_COUNT = Number(process.env.STUDIO_BENCH_FRAMES) || 300
const VIEWPORT = { width: 1920, height: 1080 }
const FFMPEG_PATH = process.env.STUDIO_FFMPEG_PATH || 'ffmpeg'
const TEMP_DIR = path.join(os.tmpdir(), 'studio-bench-frames')

/**
 * 动态探测本地 Playwright Chromium 可执行文件路径，避免硬编码系统用户名与版本号。
 * 优先读取环境变量 `STUDIO_CHROMIUM_PATH`，未设置时自动扫描当前用户的 `ms-playwright` 目录。
 *
 * @returns {string | undefined} Chromium 可执行文件路径；未找到时返回 `undefined` 交由 Playwright 默认解析
 */
function resolveChromiumPath() {
  if (process.env.STUDIO_CHROMIUM_PATH) return process.env.STUDIO_CHROMIUM_PATH
  const msPlaywrightDir = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
  if (fs.existsSync(msPlaywrightDir)) {
    const dirs = fs
      .readdirSync(msPlaywrightDir)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()
    for (const dir of dirs) {
      const win64 = path.join(msPlaywrightDir, dir, 'chrome-win64', 'chrome.exe')
      if (fs.existsSync(win64)) return win64
      const win32 = path.join(msPlaywrightDir, dir, 'chrome-win', 'chrome.exe')
      if (fs.existsSync(win32)) return win32
    }
  }
  return undefined
}

const CHROMIUM_PATH = resolveChromiumPath()

/**
 * 截帧基准测试统计结果。
 *
 * @typedef {Object} ScreenshotBenchResult
 * @property {string} label 测试场景名称
 * @property {string} frameDir 序列帧输出目录路径
 * @property {number} totalMs 截帧总耗时（毫秒）
 * @property {number} avgMs 单帧平均耗时（毫秒）
 * @property {number} medianMs 单帧中位数耗时（毫秒）
 * @property {number} p95Ms 单帧 P95 耗时（毫秒）
 * @property {number} fps 等效截帧帧率
 */

/**
 * FFmpeg 编码基准测试统计结果。
 *
 * @typedef {Object} EncodeBenchResult
 * @property {string} codec 编码器名称
 * @property {number} ms 编码总耗时（毫秒）
 * @property {number} [sizeMB] 输出视频文件体积（MB），失败时为空
 * @property {boolean} [error] 编码是否发生异常
 */

// ─── 工具函数 ──────────────────────────────────────────

/**
 * 重建指定目录；若已存在则先清空旧文件，确保每轮测试不受残留数据干扰。
 *
 * @param {string} dir 目标目录路径
 */
function ensureDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * 递归删除临时目录。
 *
 * @param {string} dir 待清理目录路径
 */
function cleanUp(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true })
}

/**
 * 将毫秒耗时格式化为带单位的秒级字符串（保留两位小数）。
 *
 * @param {number} ms 毫秒数
 * @returns {string} 格式化后的耗时字符串，如 `1.25s`
 */
function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`
}

// ─── 截帧测试（核心） ──────────────────────────────────

/**
 * 启动指定 Chromium 渲染参数配置，模拟页面线性滚动并执行逐帧 PNG 截图基准测试。
 *
 * @param {string} label 测试场景名称（同时用于构造临时子目录名）
 * @param {string[]} gpuArgs 传递给 Chromium 的 GPU 与渲染层启动参数
 * @returns {Promise<ScreenshotBenchResult>} 截帧统计数据与输出目录
 */
async function benchScreenshot(label, gpuArgs) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  🎬 测试: ${label}`)
  console.log(`${'═'.repeat(60)}`)

  const frameDir = path.join(TEMP_DIR, label.replace(/\s+/g, '_'))
  ensureDir(frameDir)

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--disable-dev-shm-usage',
      '--no-sandbox',
      ...gpuArgs,
    ],
  })

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()

  console.log('  → 正在加载页面...')
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 })

  // 强制跳过正文打字机入场动画，避免录制到半截文字或闪烁光标导致帧画面不一致
  await page.evaluate(() => {
    const container = document.querySelector('.content-type-writer')
    if (container) {
      container.classList.add('is-ready')
      container.classList.remove('is-typing')
    }
    document.querySelectorAll('.typing-hidden-block').forEach((el) => {
      el.classList.remove('typing-hidden-block')
      el.classList.add('typing-reveal-block')
    })
    document.querySelectorAll('.typing-cursor').forEach((el) => el.remove())
    const articleContent = document.querySelector('.article-content')
    if (articleContent) {
      articleContent.style.clipPath = 'none'
    }
  })

  // 预留重排与异步字体/图片解码稳定时间
  await page.waitForTimeout(1000)

  console.log(`  → 开始截取 ${FRAME_COUNT} 帧...`)
  const frameTimes = []
  const scrollHeight = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  )

  for (let i = 0; i < FRAME_COUNT; i++) {
    const scrollY = Math.round((i / (FRAME_COUNT - 1)) * scrollHeight)
    await page.evaluate((y) => window.scrollTo(0, y), scrollY)

    const t0 = performance.now()
    await page.screenshot({
      path: path.join(frameDir, `frame_${String(i).padStart(5, '0')}.png`),
      type: 'png',
    })
    const t1 = performance.now()
    frameTimes.push(t1 - t0)
  }

  await browser.close()

  const totalMs = frameTimes.reduce((a, b) => a + b, 0)
  const avgMs = totalMs / frameTimes.length
  const minMs = Math.min(...frameTimes)
  const maxMs = Math.max(...frameTimes)
  const fps = 1000 / avgMs

  const sorted = [...frameTimes].sort((a, b) => a - b)
  const medianMs = sorted[Math.floor(sorted.length / 2)]
  const p95Ms = sorted[Math.floor(sorted.length * 0.95)]

  console.log(`  ✅ 截帧完成！`)
  console.log(`  📊 统计 (${FRAME_COUNT} 帧):`)
  console.log(`     总耗时:    ${formatMs(totalMs)}`)
  console.log(`     平均每帧:  ${avgMs.toFixed(1)}ms`)
  console.log(`     中位数:    ${medianMs.toFixed(1)}ms`)
  console.log(`     P95:       ${p95Ms.toFixed(1)}ms`)
  console.log(`     最快:      ${minMs.toFixed(1)}ms`)
  console.log(`     最慢:      ${maxMs.toFixed(1)}ms`)
  console.log(`     等效帧率:  ${fps.toFixed(1)} fps`)

  return { label, frameDir, totalMs, avgMs, medianMs, p95Ms, fps }
}

// ─── FFmpeg 编码测试 ────────────────────────────────────

/**
 * 调用 FFmpeg 将指定目录内的 PNG 序列帧编码为 30fps MP4 视频并统计耗时。
 *
 * @param {string} label 编码方案显示名称
 * @param {string} frameDir 存放 `frame_%05d.png` 序列帧的目录路径
 * @param {string} codec 编码器标识符（用于日志展示）
 * @param {string[]} [extraArgs=[]] 附加的 FFmpeg 编码器参数
 * @returns {EncodeBenchResult} 编码耗时与输出体积统计
 */
function benchEncode(label, frameDir, codec, extraArgs = []) {
  const outFile = path.join(TEMP_DIR, `${label.replace(/\s+/g, '_')}.mp4`)
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile)

  const inputPattern = path.join(frameDir, 'frame_%05d.png')
  const args = [
    '-hide_banner',
    '-y',
    '-framerate',
    '30',
    '-i',
    inputPattern,
    ...extraArgs,
    '-pix_fmt',
    'yuv420p',
    outFile,
  ]

  console.log(`\n  🎞️  编码测试: ${label} (${codec})`)
  const t0 = performance.now()
  try {
    execFileSync(FFMPEG_PATH, args, {
      stdio: 'pipe',
      timeout: 120000,
    })
    const t1 = performance.now()
    const fileSize = fs.statSync(outFile).size
    console.log(`     耗时:     ${formatMs(t1 - t0)}`)
    console.log(`     文件大小: ${(fileSize / 1024 / 1024).toFixed(1)} MB`)
    return { codec, ms: t1 - t0, sizeMB: fileSize / 1024 / 1024 }
  } catch (e) {
    const t1 = performance.now()
    // 优先提取 FFmpeg stderr 尾部核心错误信息，避免被过长的命令行路径截断掩盖真实原因
    const stderrText = e.stderr?.toString().trim()
    const errorDetail = stderrText
      ? stderrText
          .split(/\r?\n/)
          .slice(-5)
          .join('\n        ')
      : e.message?.slice(0, 300)
    console.log(`     ❌ 编码失败 (${formatMs(t1 - t0)}):\n        ${errorDetail}`)
    return { codec, ms: t1 - t0, error: true }
  }
}

// ─── 主流程 ─────────────────────────────────────────────

/**
 * 执行完整基准测试流程并输出汇总报告。
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║        Studio 渲染与编码基准测试 (studio-bench.mjs)      ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log(`║  CPU:     ${os.cpus()[0]?.model?.trim() || 'Unknown'}`)
  console.log(
    `║  内存:    ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB (可用 ${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB)`,
  )
  console.log(`║  目标:    ${TARGET_URL}`)
  console.log(`║  帧数:    ${FRAME_COUNT} 帧 @ ${VIEWPORT.width}x${VIEWPORT.height}`)
  console.log(`║  临时目录: ${TEMP_DIR}`)
  console.log('╚══════════════════════════════════════════════════════════╝')

  ensureDir(TEMP_DIR)

  // 场景 1：禁用 GPU 硬件加速（纯 CPU 光栅化）
  const cpuResult = await benchScreenshot('CPU 软件渲染 (--disable-gpu)', [
    '--disable-gpu',
    '--disable-gpu-compositing',
  ])

  // 场景 2：启用 ANGLE D3D11 与 GPU 光栅化合成
  const gpuResult = await benchScreenshot('GPU 合成 (--enable-gpu)', [
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--use-gl=angle',
    '--use-angle=d3d11',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
  ])

  const encodeFrameDir = gpuResult.frameDir

  // 编码对比 1：x264 CPU 软编码
  const softEnc = benchEncode('H264-CPU', encodeFrameDir, 'libx264', [
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
  ])

  // 编码对比 2：NVIDIA NVENC 独显硬编码
  const nvencEnc = benchEncode('H264-NVENC', encodeFrameDir, 'h264_nvenc', [
    '-c:v',
    'h264_nvenc',
    '-preset',
    'p4',
    '-cq',
    '23',
  ])

  // 编码对比 3：Intel QSV 核显硬编码
  const qsvEnc = benchEncode('H264-QSV', encodeFrameDir, 'h264_qsv', [
    '-c:v',
    'h264_qsv',
    '-global_quality',
    '23',
  ])

  console.log('\n')
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║              📋 基准测试汇总                            ║')
  console.log('╠══════════════════════════════════════════════════════════╣')
  console.log(
    `║  CPU 软渲染:  ${cpuResult.fps.toFixed(1)} fps (avg ${cpuResult.avgMs.toFixed(0)}ms, P95 ${cpuResult.p95Ms.toFixed(0)}ms)`,
  )
  console.log(
    `║  GPU 合成:    ${gpuResult.fps.toFixed(1)} fps (avg ${gpuResult.avgMs.toFixed(0)}ms, P95 ${gpuResult.p95Ms.toFixed(0)}ms)`,
  )
  console.log(`║  H264 软编:   ${formatMs(softEnc.ms)} / ${softEnc.sizeMB?.toFixed(1) || '?'} MB`)
  console.log(
    `║  H264 NVENC:  ${formatMs(nvencEnc.ms)} / ${nvencEnc.sizeMB?.toFixed(1) || '?'} MB${nvencEnc.error ? ' (失败)' : ''}`,
  )
  console.log(
    `║  H264 QSV:    ${formatMs(qsvEnc.ms)} / ${qsvEnc.sizeMB?.toFixed(1) || '?'} MB${qsvEnc.error ? ' (失败)' : ''}`,
  )
  console.log('╠══════════════════════════════════════════════════════════╣')

  const bestFps = Math.max(cpuResult.fps, gpuResult.fps)
  const bestMode = gpuResult.fps > cpuResult.fps ? 'GPU 合成' : 'CPU 软渲染'
  const concurrency = 3
  const effectiveFps = bestFps * concurrency

  console.log(`║  🏆 推荐模式:  ${bestMode}`)
  console.log(`║  单进程最优:  ${bestFps.toFixed(1)} fps`)
  console.log(`║  ${concurrency} 进程并行:   ~${effectiveFps.toFixed(0)} fps (理论)`)
  console.log('║')
  console.log(`║  按 30fps 输出估算：`)
  console.log(`║    1 分钟视频 (1800帧):  ~${formatMs((1800 / effectiveFps) * 1000)}`)
  console.log(`║    5 分钟视频 (9000帧):  ~${formatMs((9000 / effectiveFps) * 1000)}`)
  console.log(`║   10 分钟视频 (18000帧): ~${formatMs((18000 / effectiveFps) * 1000)}`)
  console.log('╚══════════════════════════════════════════════════════════╝')

  cleanUp(TEMP_DIR)
  console.log('\n  🧹 临时文件已清理，基准测试完成。')
}

main().catch((e) => {
  console.error('❌ 测试脚本执行异常:', e)
  process.exit(1)
})
