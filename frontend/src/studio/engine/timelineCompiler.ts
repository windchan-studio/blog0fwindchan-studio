/**
 * 演播室剧本编译器（TimelineCompiler）。
 *
 * 将手写的顺序时间剧本 `ScriptJson` 与预烘焙音乐字典编译为扁平的绝对时间线 `CompiledTimeline`，
 * 支持任意时刻 $t$ 的 $O(\log N)$ 无状态跳转推导。
 */

import type { MusicBakeJson } from '../types/music'
import type {
  CompiledCopyEvent,
  CompiledHighlightEvent,
  CompiledLine,
  CompiledMusicTimeline,
  CompiledMusicTrack,
  CompiledScrollEvent,
  CompiledSegment,
  CompiledThemeEvent,
  CompiledTimeline,
  CompiledToastEvent,
  CompiledTocEvent,
  CompiledTypewriterEvent,
  ResolvedVideoConfig,
  ScriptJson,
  StudioLocator,
  StudioMood,
  StudioThemeMode,
} from '../types/script'
import { clamp } from './easing'

/** 默认片尾结束语（PRD §6.3, §9.1 P5） */
export const DEFAULT_OUTRO_TEXT = '感谢收看～我们下期再见 awa'

/**
 * 剥离台词中的轻量标记（`**加粗**` 与 `` `代码` ``），供字数统计与纯文本分析使用。
 *
 * @param text 原始台词文本
 * @returns 纯文本内容
 */
export function stripSubtitleMarkup(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

/**
 * 按语速公式推算单句台词默认停留毫秒数（PRD §5.4 F13）。
 *
 * 公式：`clamp(600 + 中文字数 × 220 + 英文单词数 × 300, 1500, 8000)`。
 *
 * @param text 台词文本
 * @returns 推算出的停留毫秒数
 */
export function estimateLineDurationMs(text: string): number {
  const plain = stripSubtitleMarkup(text)
  const zhMatches = plain.match(/[\u4e00-\u9fff]/g)
  const enMatches = plain.match(/[a-zA-Z0-9]+/g)
  const zhCount = zhMatches ? zhMatches.length : 0
  const enCount = enMatches ? enMatches.length : 0
  return clamp(600 + zhCount * 220 + enCount * 300, 1500, 8000)
}

/**
 * 将剧本 JSON 与预烘焙音乐字典编译为绝对时间线 `CompiledTimeline`。
 *
 * @param script 校验通过的剧本对象
 * @param musicMap 已加载的预烘焙音乐字典（键为 `track.ref`）
 * @returns 编译后的绝对时间线产物
 */
export function compileTimeline(
  script: ScriptJson,
  musicMap: Record<string, MusicBakeJson> = {},
): CompiledTimeline {
  const video: ResolvedVideoConfig = {
    width: script.video?.width ?? 1920,
    height: script.video?.height ?? 1080,
    fps: script.video?.fps ?? 30,
    zoom: script.video?.zoom ?? 1.1,
    initialTheme: script.video?.theme ?? 'dark',
    defaultMood: script.video?.defaults?.mood ?? 'reading',
    gapMs: script.video?.defaults?.gapMs ?? 300,
  }

  // 统计全片总台词句数，用于判断是否为全片最后一句（末句不加 gapMs）
  const totalLinesCount = script.segments.reduce(
    (sum, seg) => sum + seg.lines.length,
    0,
  )

  const compiledSegments: CompiledSegment[] = []
  const compiledLines: CompiledLine[] = []

  const scrolls: CompiledScrollEvent[] = []
  const tocs: CompiledTocEvent[] = []
  const highlights: CompiledHighlightEvent[] = []
  const copies: CompiledCopyEvent[] = []
  const themes: CompiledThemeEvent[] = []
  const toasts: CompiledToastEvent[] = []
  const typewriters: CompiledTypewriterEvent[] = []

  let cursorMs = 0
  let globalLineIndex = 0

  // 持续状态跟踪游标（用于记录每个分段进入时的 enteredState）
  let currentMood: StudioMood = video.defaultMood
  let currentTheme: StudioThemeMode = video.initialTheme
  let currentTocExpanded = false
  let currentActiveHeading: StudioLocator | null = null

  for (let sIdx = 0; sIdx < script.segments.length; sIdx++) {
    const seg = script.segments[sIdx]!
    const segStartMs = cursorMs

    // 若分段配置了 tocAnchor，在进入本分段起点自动触发一次目录高亮 (PRD §5.4)
    if (seg.tocAnchor !== undefined) {
      tocs.push({
        path: `segments[${sIdx}].tocAnchor`,
        atMs: segStartMs,
        highlight: seg.tocAnchor,
      })
      currentActiveHeading = seg.tocAnchor
    }

    const enteredState = {
      theme: currentTheme,
      tocExpanded: currentTocExpanded,
      activeHeadingLocator: currentActiveHeading,
      mood: currentMood,
    }

    const segLines: CompiledLine[] = []

    for (let lIdx = 0; lIdx < seg.lines.length; lIdx++) {
      const line = seg.lines[lIdx]!
      const linePath = `segments[${sIdx}].lines[${lIdx}]`
      const isLastLineOfScript = globalLineIndex === totalLinesCount - 1

      const speakDurationMs =
        line.duration !== undefined
          ? line.duration
          : estimateLineDurationMs(line.text)
      const durationSource: 'manual' | 'auto' =
        line.duration !== undefined ? 'manual' : 'auto'

      const resolvedMood: StudioMood = line.mood ?? currentMood
      currentMood = resolvedMood

      // 累加本句中的 wait 动作时长
      let waitDurationMs = 0
      if (line.actions) {
        for (const act of line.actions) {
          if (act.type === 'wait') {
            waitDurationMs += Math.max(0, act.durationMs)
          }
        }
      }

      const startMs = cursorMs
      const speakEndMs = startMs + speakDurationMs
      const waitEndMs = speakEndMs + waitDurationMs
      const gapDurationMs = isLastLineOfScript ? 0 : video.gapMs
      const slotEndMs = waitEndMs + gapDurationMs

      // 编译挂在本句台词上的各个动作
      if (line.actions) {
        for (let aIdx = 0; aIdx < line.actions.length; aIdx++) {
          const act = line.actions[aIdx]!
          const actPath = `${linePath}.actions[${aIdx}]`
          const atOffset = act.at ?? 0
          const actStartMs = startMs + atOffset

          switch (act.type) {
            case 'scroll': {
              const dur = act.durationMs ?? 1000
              scrolls.push({
                path: actPath,
                startMs: actStartMs,
                endMs: actStartMs + dur,
                durationMs: dur,
                to: act.to,
                offset: act.offset ?? -120,
                easing: act.easing ?? 'easeInOut',
              })
              break
            }
            case 'toc': {
              tocs.push({
                path: actPath,
                atMs: actStartMs,
                expand: act.expand,
                highlight: act.highlight,
              })
              if (act.expand !== undefined) {
                currentTocExpanded = act.expand
              }
              if (act.highlight !== undefined) {
                currentActiveHeading = act.highlight
              }
              break
            }
            case 'highlight': {
              const untilLineEnd = act.untilLineEnd ?? true
              highlights.push({
                path: actPath,
                startMs: actStartMs,
                // 若 untilLineEnd 为 false，先暂存 -1，待全片总时长算出后替换为 totalDurationMs
                endMs: untilLineEnd ? Math.max(actStartMs, speakEndMs) : -1,
                target: act.target,
                style: act.style ?? 'glow',
              })
              break
            }
            case 'copy': {
              copies.push({
                path: actPath,
                startMs: actStartMs,
                endMs: actStartMs + 2000,
                target: act.target,
              })
              break
            }
            case 'theme': {
              const dur = act.durationMs ?? 0
              themes.push({
                path: actPath,
                startMs: actStartMs,
                endMs: actStartMs + dur,
                to: act.to,
              })
              currentTheme = act.to
              break
            }
            case 'toast': {
              const dur = act.durationMs ?? 4000
              toasts.push({
                id: `script-toast-${sIdx}-${lIdx}-${aIdx}`,
                path: actPath,
                startMs: actStartMs,
                endMs: actStartMs + dur,
                durationMs: dur,
                text: act.text,
                toastType: act.toastType ?? 'success',
                position: act.position ?? 'top-right',
              })
              break
            }
            case 'typewriter': {
              typewriters.push({
                path: actPath,
                startMs: actStartMs,
                endMs: actStartMs + act.durationMs,
                durationMs: act.durationMs,
                until: act.until,
              })
              break
            }
            case 'wait':
            case 'overlay':
              break
          }
        }
      }

      const compiledLine: CompiledLine = {
        globalLineIndex,
        segmentIndex: sIdx,
        lineIndex: lIdx,
        path: linePath,
        text: line.text,
        note: line.note,
        mood: resolvedMood,
        startMs,
        speakEndMs,
        waitEndMs,
        slotEndMs,
        speakDurationMs,
        durationSource,
        waitDurationMs,
        gapDurationMs,
      }

      segLines.push(compiledLine)
      compiledLines.push(compiledLine)

      cursorMs = slotEndMs
      globalLineIndex++
    }

    const segEndMs = cursorMs
    const startFrame = Math.floor((segStartMs * video.fps) / 1000)
    const endFrame = Math.round((segEndMs * video.fps) / 1000)

    compiledSegments.push({
      index: sIdx,
      id: seg.id,
      title: seg.title,
      tocAnchor: seg.tocAnchor,
      startMs: segStartMs,
      endMs: segEndMs,
      durationMs: segEndMs - segStartMs,
      startFrame,
      endFrame,
      enteredState,
      lines: segLines,
    })
  }

  const totalDurationMs = cursorMs
  const totalFrames = Math.round((totalDurationMs * video.fps) / 1000)

  // 回填非 untilLineEnd 的持续高亮事件终点
  for (const hl of highlights) {
    if (hl.endMs < 0) {
      hl.endMs = totalDurationMs
    }
  }

  // 编译歌单时间线与自动署名 Toast (ARCHITECTURE §4.2.3 & PRD §6.3)
  const compiledTracks: CompiledMusicTrack[] = []
  const announce = script.music?.announce ?? true
  const crossfadeMs = script.music?.crossfadeMs ?? 1500
  const outroText = script.music?.outro?.text || DEFAULT_OUTRO_TEXT

  let musicCursorMs = 0
  const trackConfigs = script.music?.tracks ?? []

  for (let k = 0; k < trackConfigs.length; k++) {
    const tc = trackConfigs[k]!
    const bakeData = musicMap[tc.ref]
    if (!bakeData) continue

    const startAtMs = tc.startAtMs ?? 0
    const playDurationMs = Math.max(0, bakeData.meta.duration_ms - startAtMs)
    if (playDurationMs <= 0) continue

    const videoStartMs = musicCursorMs
    const videoEndMs = videoStartMs + playDurationMs
    const songStartAtMs = startAtMs
    const songEndAtMs = startAtMs + playDurationMs

    compiledTracks.push({
      trackIndex: compiledTracks.length,
      ref: tc.ref,
      startAtMs,
      playDurationMs,
      videoStartMs,
      videoEndMs,
      songStartAtMs,
      songEndAtMs,
      bakeData,
    })

    // 若开启自动署名且歌曲起点在全片时长内，自动投放 4 秒右上角 success Toast
    if (announce && videoStartMs < totalDurationMs) {
      const announceDuration = 4000
      toasts.push({
        id: `music-announce-${k}`,
        path: `music.tracks[${k}]`,
        startMs: videoStartMs,
        endMs: videoStartMs + announceDuration,
        durationMs: announceDuration,
        text: `♪ ${bakeData.meta.title} - ${bakeData.meta.artist}`,
        toastType: 'success',
        position: 'top-right',
        isMusicAnnounce: true,
      })
    }

    musicCursorMs = videoEndMs
  }

  // 对所有时间事件按触发时间稳定升序排列
  scrolls.sort((a, b) => a.startMs - b.startMs)
  tocs.sort((a, b) => a.atMs - b.atMs)
  themes.sort((a, b) => a.startMs - b.startMs)
  toasts.sort((a, b) => a.startMs - b.startMs)
  typewriters.sort((a, b) => a.startMs - b.startMs)

  const musicTimeline: CompiledMusicTimeline = {
    tracks: compiledTracks,
    totalMusicDurationMs: musicCursorMs,
    crossfadeMs,
    announce,
    outroText,
  }

  return {
    scriptId: script.id,
    title: script.title,
    articleSlug: script.article.slug,
    articleCategory: script.article.category,
    video,
    totalDurationMs,
    totalFrames,
    segments: compiledSegments,
    lines: compiledLines,
    events: {
      scrolls,
      tocs,
      highlights,
      copies,
      themes,
      toasts,
      typewriters,
    },
    music: musicTimeline,
  }
}
