/**
 * 演播室状态推导纯函数（StateDeriver）。
 *
 * 实现核心命题 $\text{Frame}(t) = \mathcal{F}(\text{CompiledTimeline}, \text{StudioDomMetrics}, t)$：
 * 任意时刻 $t$ 的画面状态完全由编译后时间线与 $t$ 直接算出，不依赖播放历史。
 */

import type {
  CompiledLine,
  CompiledMusicTrack,
  CompiledTimeline,
  StudioLocator,
  StudioThemeMode,
} from '../types/script'
import type {
  ActiveCopyFeedbackState,
  ActiveHighlightState,
  ActiveStudioToastState,
  CheerStarParticleState,
  StudioDomMetrics,
  StudioFrameState,
  StudioLyricFrameState,
  StudioPetFrameState,
} from '../types/state'
import {
  clamp,
  easeInCubic,
  easeOutCubic,
  easeTocExpand,
  evaluateEasing,
} from './easing'
import { matchSentence } from './lyricMatcher'
import { createMulberry32, hashStringToSeed } from './seededRandom'

/** 顶栏歌词基准最大透明度（PRD §7.2） */
const LYRIC_BASE_OPACITY = 0.85

/** 歌单结束后触发片尾 outro 的静默等待阈值（PRD §6.3：15 秒写死） */
const OUTRO_SILENCE_THRESHOLD_MS = 15000

/** 默认空 DOM 度量表（用于纯逻辑推导或 DOM 未挂载阶段） */
export const DEFAULT_DOM_METRICS: StudioDomMetrics = {
  resolveScrollTargetY: (target, offset) =>
    typeof target === 'number' ? Math.max(0, target + offset) : 0,
  resolveHeadingId: (locator) => {
    if (!locator) return null
    if (typeof locator === 'string') {
      return locator.startsWith('#') ? locator.slice(1) : locator
    }
    return locator.heading
  },
  resolveTypewriterUnits: () => 1000,
  totalTypewriterUnits: 1000,
}

/**
 * 二分查找定位时刻 $t$ 所在的编译后台词项。
 */
function findLineAtTime(lines: CompiledLine[], t: number): CompiledLine | null {
  if (lines.length === 0) return null
  if (t <= lines[0]!.startMs) return lines[0]!
  const last = lines[lines.length - 1]!
  if (t >= last.slotEndMs) return last

  let low = 0
  let high = lines.length - 1
  let resultIdx = 0

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const item = lines[mid]!
    if (item.startMs <= t) {
      resultIdx = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return lines[resultIdx] ?? null
}

/**
 * 生成 `cheer` 情绪顶部 7 颗撒花星星粒子的逐帧确定性状态（ARCHITECTURE §3.3）。
 */
function deriveCheerParticles(
  scriptId: string,
  globalLineIndex: number,
  elapsedMs: number,
): CheerStarParticleState[] {
  const durationMs = 1200
  if (elapsedMs < 0 || elapsedMs > durationMs) return []

  const progress = clamp(elapsedMs / durationMs, 0, 1)
  const rand = createMulberry32(
    hashStringToSeed(`${scriptId}:cheer:${globalLineIndex}`),
  )
  const count = 7
  const particles: CheerStarParticleState[] = []

  for (let i = 0; i < count; i++) {
    const angle = (-Math.PI * 0.85) + (i / (count - 1)) * (Math.PI * 0.7) + (rand() - 0.5) * 0.2
    const speed = 42 + rand() * 36
    const gravity = 55
    const rotSpeed = (rand() - 0.5) * 240

    const x = Math.cos(angle) * speed * progress
    const y =
      Math.sin(angle) * speed * progress +
      0.5 * gravity * progress * progress
    const scale =
      progress < 0.25
        ? easeOutCubic(progress / 0.25)
        : clamp(1 - (progress - 0.25) / 0.75, 0, 1)
    const opacity =
      progress < 0.2
        ? clamp(progress / 0.2, 0, 1)
        : clamp(1 - (progress - 0.2) / 0.8, 0, 1)

    particles.push({
      id: i,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      scale: Math.round(scale * 1000) / 1000,
      opacity: Math.round(opacity * 1000) / 1000,
      rotationDeg: Math.round(rotSpeed * progress * 10) / 10,
    })
  }

  return particles
}

/**
 * 计算单首歌曲在内部时刻 `songTimeMs` 下的文本、模式与自身淡入淡出系数 $[0, 1]$。
 */
function evaluateSingleTrackLyric(
  track: CompiledMusicTrack,
  songTimeMs: number,
  videoTimeMs: number,
): {
  text: string
  mode: 'lyric' | 'note-breathing' | 'instrumental'
  alphaFactor: number
} {
  const lines = track.bakeData.lyrics.lines
  if (!lines || lines.length === 0) {
    return {
      text: '♪ 纯音乐 ♪',
      mode: 'instrumental',
      alphaFactor: 1.0,
    }
  }

  const matched = matchSentence(lines, songTimeMs)
  if (matched.is_prelude || matched.is_ended || !matched.current_line) {
    // 前奏或尾奏期间：♪ 慢速正弦呼吸
    const breathing = 0.45 + 0.35 * Math.sin((2 * Math.PI * videoTimeMs) / 2400)
    return {
      text: '♪',
      mode: 'note-breathing',
      alphaFactor: clamp(breathing / LYRIC_BASE_OPACITY, 0, 1),
    }
  }

  const line = matched.current_line
  const lineStart = line.time_ms
  const lineEnd = line.time_ms + Math.max(1, line.duration_ms)

  // 句首 300ms 淡入
  const fadeIn = clamp((songTimeMs - lineStart) / 300, 0, 1)

  // 句尾 300ms 淡出（若下一句文本与当前句完全相同则保持不淡出）
  const nextLine = lines[matched.index + 1]
  const sameAsNext = nextLine && nextLine.text.trim() === line.text.trim()
  const fadeOut = sameAsNext
    ? 1.0
    : clamp((lineEnd - songTimeMs) / 300, 0, 1)

  return {
    text: line.text || '♪',
    mode: 'lyric',
    alphaFactor: Math.min(fadeIn, fadeOut),
  }
}

/**
 * 推导时刻 $t$ 的顶栏歌词条状态（ARCHITECTURE §4.2.3 & §5.2.2）。
 */
function deriveLyricState(
  timeline: CompiledTimeline,
  t: number,
): StudioLyricFrameState {
  const { tracks, totalMusicDurationMs, crossfadeMs, outroText } =
    timeline.music

  if (tracks.length === 0) {
    return {
      enabled: false,
      text: '',
      opacity: 0,
      crossfadeNextText: null,
      crossfadeNextOpacity: 0,
      mode: 'note-breathing',
      activeTrackIndex: -1,
      songTimeMs: 0,
    }
  }

  // 情况 A：仍在歌单总播放时长内 (t < M_end)
  if (t < totalMusicDurationMs) {
    let activeIdx = tracks.length - 1
    for (let i = 0; i < tracks.length; i++) {
      if (t >= tracks[i]!.videoStartMs && t < tracks[i]!.videoEndMs) {
        activeIdx = i
        break
      }
    }

    const track = tracks[activeIdx]!
    const songTimeMs = t - track.videoStartMs + track.startAtMs
    const currentEval = evaluateSingleTrackLyric(track, songTimeMs, t)

    let primaryOpacity = currentEval.alphaFactor * LYRIC_BASE_OPACITY
    let crossfadeNextText: string | null = null
    let crossfadeNextOpacity = 0

    // 检查是否处于歌间交叉渐变区间（后面还有歌，且距本首结束不足 crossfadeMs）
    const remainInTrackMs = track.videoEndMs - t
    const nextTrack = tracks[activeIdx + 1]
    if (
      nextTrack &&
      crossfadeMs > 0 &&
      remainInTrackMs <= crossfadeMs &&
      remainInTrackMs >= 0
    ) {
      const crossProgress = clamp(1 - remainInTrackMs / crossfadeMs, 0, 1)
      const nextEval = evaluateSingleTrackLyric(
        nextTrack,
        nextTrack.startAtMs,
        t,
      )
      primaryOpacity *= 1 - crossProgress
      crossfadeNextText = nextEval.text
      crossfadeNextOpacity =
        nextEval.alphaFactor * LYRIC_BASE_OPACITY * crossProgress
    }

    return {
      enabled: true,
      text: currentEval.text,
      opacity: Math.round(primaryOpacity * 1000) / 1000,
      crossfadeNextText,
      crossfadeNextOpacity: Math.round(crossfadeNextOpacity * 1000) / 1000,
      mode: currentEval.mode,
      activeTrackIndex: activeIdx,
      songTimeMs,
    }
  }

  // 情况 B：歌单已播放完毕，但视频尚未结束 (t >= M_end)
  const afterMusicMs = t - totalMusicDurationMs
  const remainingVideoAfterMusicMs =
    timeline.totalDurationMs - totalMusicDurationMs

  // 若最后一首结束 15 秒内视频也结束，全程显示 ♪ 慢闪，不显示 outro
  if (
    remainingVideoAfterMusicMs <= OUTRO_SILENCE_THRESHOLD_MS ||
    afterMusicMs < OUTRO_SILENCE_THRESHOLD_MS
  ) {
    const breathing = 0.45 + 0.35 * Math.sin((2 * Math.PI * t) / 2400)
    // 若即将切换到 outro，在 15s 前的最后 300ms 淡出 ♪
    const preOutroFadeOut =
      remainingVideoAfterMusicMs > OUTRO_SILENCE_THRESHOLD_MS
        ? clamp((OUTRO_SILENCE_THRESHOLD_MS - afterMusicMs) / 300, 0, 1)
        : 1.0

    return {
      enabled: true,
      text: '♪',
      opacity: Math.round(breathing * preOutroFadeOut * 1000) / 1000,
      crossfadeNextText: null,
      crossfadeNextOpacity: 0,
      mode: 'note-breathing',
      activeTrackIndex: -1,
      songTimeMs: 0,
    }
  }

  // 最后一首结束已满 15 秒且视频仍未结束：300ms 淡入显示 outro 结束语并保持到片尾
  const outroElapsedMs = afterMusicMs - OUTRO_SILENCE_THRESHOLD_MS
  const outroFadeIn = clamp(outroElapsedMs / 300, 0, 1)

  return {
    enabled: true,
    text: outroText,
    opacity: Math.round(outroFadeIn * LYRIC_BASE_OPACITY * 1000) / 1000,
    crossfadeNextText: null,
    crossfadeNextOpacity: 0,
    mode: 'outro',
    activeTrackIndex: -1,
    songTimeMs: 0,
  }
}

/**
 * 根据编译后时间线与任意毫秒时刻 $t$ 推导全量画面状态快照 `StudioFrameState`。
 *
 * @param timeline 编译后的绝对时间线
 * @param timeMs 目标毫秒时刻 $t$
 * @param domMetrics DOM 几何测量回调表（可选，默认使用纯逻辑回退表）
 * @returns 时刻 $t$ 的完整状态快照
 */
export function deriveFrameState(
  timeline: CompiledTimeline,
  timeMs: number,
  domMetrics: StudioDomMetrics = DEFAULT_DOM_METRICS,
): StudioFrameState {
  const t = clamp(timeMs, 0, timeline.totalDurationMs)
  const frameIndex = Math.floor((t * timeline.video.fps) / 1000)

  // 1. 亮暗主题推导：取 startMs <= t 的最后一次 theme 事件
  let theme: StudioThemeMode = timeline.video.initialTheme
  for (const th of timeline.events.themes) {
    if (th.startMs <= t) {
      theme = th.to
    } else {
      break
    }
  }

  // 2. 页面垂直滚动位置 scrollY 推导
  let scrollY = 0
  for (const sc of timeline.events.scrolls) {
    if (t < sc.startMs) break
    const targetY = domMetrics.resolveScrollTargetY(sc.to, sc.offset)
    if (t >= sc.endMs || sc.durationMs <= 0) {
      scrollY = targetY
    } else {
      const progress = (t - sc.startMs) / sc.durationMs
      const eased = evaluateEasing(sc.easing, progress)
      scrollY = scrollY + (targetY - scrollY) * eased
      break
    }
  }

  // 3. 打字机揭示进度推导
  const typewriterEvents = timeline.events.typewriters
  const typewriterEnabled = typewriterEvents.length > 0
  let revealedUnits = domMetrics.totalTypewriterUnits
  if (typewriterEnabled) {
    revealedUnits = 0
    for (const tw of typewriterEvents) {
      if (t < tw.startMs) break
      const targetUnits = domMetrics.resolveTypewriterUnits(tw.until)
      if (t >= tw.endMs || tw.durationMs <= 0) {
        revealedUnits = targetUnits
      } else {
        const progress = clamp((t - tw.startMs) / tw.durationMs, 0, 1)
        revealedUnits = Math.round(
          revealedUnits + (targetUnits - revealedUnits) * progress,
        )
        break
      }
    }
  }

  // 4. 目录展开进度与高亮标题推导
  let tocExpanded = false
  let tocExpandProgress = 0
  let activeHeadingLocator: StudioLocator | null = null

  for (const tc of timeline.events.tocs) {
    if (tc.atMs > t) break
    if (tc.highlight !== undefined) {
      activeHeadingLocator = tc.highlight
    }
    if (tc.expand !== undefined && tc.expand !== tocExpanded) {
      const toggleElapsed = clamp((t - tc.atMs) / 400, 0, 1)
      const eased = easeTocExpand(toggleElapsed)
      tocExpandProgress = tc.expand
        ? tocExpandProgress + (1 - tocExpandProgress) * eased
        : tocExpandProgress * (1 - eased)
      tocExpanded = tc.expand
    }
  }

  const activeHeadingId = domMetrics.resolveHeadingId(activeHeadingLocator)

  // 5. 当前分段与台词气泡状态推导
  const activeLine = findLineAtTime(timeline.lines, t)
  const activeSegIndex = activeLine ? activeLine.segmentIndex : 0
  const activeSeg = timeline.segments[activeSegIndex]
  const segCount = Math.max(1, timeline.segments.length)

  const segmentProgress = activeSeg
    ? clamp(
        (t - activeSeg.startMs) / Math.max(1, activeSeg.durationMs),
        0,
        1,
      )
    : 1
  const totalStepProgress = clamp(
    (activeSegIndex + segmentProgress) / segCount,
    0,
    1,
  )

  let bubbleVisible = true
  let isInGap = false
  let rawText = ''
  let displayText = ''
  let textOpacity = 1
  let textTranslateY = 0
  let mood = timeline.video.defaultMood
  let moodElapsedMs = 0
  let iconOffsetY = 0
  let thinkingDotsCount: 0 | 1 | 2 | 3 = 0
  let proudShineLeftPercent: number | null = null
  let successGlowIntensity = 0
  let cheerParticles: CheerStarParticleState[] = []

  if (activeLine) {
    mood = activeLine.mood
    rawText = activeLine.text
    moodElapsedMs = Math.max(0, t - activeLine.startMs)

    if (t < activeLine.speakEndMs) {
      // 处于正常说话期
      bubbleVisible = true
      isInGap = false
      displayText = activeLine.text

      const inElapsed = t - activeLine.startMs
      const outRemain = activeLine.speakEndMs - t

      if (inElapsed < 200) {
        const alpha = easeOutCubic(inElapsed / 200)
        textOpacity = alpha
        textTranslateY = (1 - alpha) * 10
      } else if (outRemain < 150) {
        const outProgress = (150 - outRemain) / 150
        const alpha = 1 - easeInCubic(outProgress)
        textOpacity = alpha
        textTranslateY = -(1 - alpha) * 8
      }
    } else if (t < activeLine.waitEndMs) {
      // 处于 wait 纯画面等待期（气泡隐藏）
      bubbleVisible = false
      isInGap = false
      displayText = ''
      textOpacity = 0
    } else {
      // 处于两句之间的 gapMs 空白期（气泡保持高度，内容为空）
      bubbleVisible = true
      isInGap = true
      displayText = ''
      textOpacity = 0
    }

    // 教学情绪专属动效计算 (ARCHITECTURE §3.3 & PRD §5.6)
    switch (mood) {
      case 'warning': {
        if (moodElapsedMs <= 300) {
          iconOffsetY =
            6 * Math.sin(Math.PI * clamp(moodElapsedMs / 300, 0, 1))
        }
        break
      }
      case 'cheer': {
        cheerParticles = deriveCheerParticles(
          timeline.scriptId,
          activeLine.globalLineIndex,
          moodElapsedMs,
        )
        break
      }
      case 'thinking': {
        if (!isInGap && bubbleVisible && moodElapsedMs < 450) {
          const step = Math.min(3, Math.floor(moodElapsedMs / 150) + 1) as
            | 1
            | 2
            | 3
          thinkingDotsCount = step
          displayText = '.'.repeat(step)
        }
        break
      }
      case 'proud': {
        iconOffsetY = 3 * Math.sin((2 * Math.PI * moodElapsedMs) / 1600)
        if (moodElapsedMs <= 600) {
          proudShineLeftPercent = -30 + (moodElapsedMs / 600) * 160
        }
        break
      }
      case 'success': {
        if (moodElapsedMs <= 500) {
          successGlowIntensity = Math.sin((Math.PI * moodElapsedMs) / 500)
        }
        break
      }
      default:
        break
    }
  }

  const pet: StudioPetFrameState = {
    currentSegmentIndex: activeSegIndex,
    currentSegmentId: activeSeg?.id ?? '',
    currentSegmentTitle: activeSeg?.title ?? '',
    segmentProgress,
    totalStepProgress,
    currentGlobalLineIndex: activeLine?.globalLineIndex ?? 0,
    currentLineInSegmentIndex: activeLine?.lineIndex ?? 0,
    bubbleVisible,
    isInGap,
    displayText,
    rawText,
    textOpacity: Math.round(textOpacity * 1000) / 1000,
    textTranslateY: Math.round(textTranslateY * 100) / 100,
    mood,
    moodElapsedMs,
    iconOffsetY: Math.round(iconOffsetY * 100) / 100,
    thinkingDotsCount,
    proudShineLeftPercent:
      proudShineLeftPercent !== null
        ? Math.round(proudShineLeftPercent * 100) / 100
        : null,
    successGlowIntensity: Math.round(successGlowIntensity * 1000) / 1000,
    cheerParticles,
    tocExpandProgress: Math.round(tocExpandProgress * 1000) / 1000,
    tocExpanded,
    activeHeadingLocator,
    activeHeadingId,
  }

  // 6. 顶栏歌词状态推导
  const lyric = deriveLyricState(timeline, t)

  // 7. 活跃的剧本 Toast 列表推导
  const toasts: ActiveStudioToastState[] = []
  for (const ts of timeline.events.toasts) {
    if (t >= ts.startMs && t < ts.endMs) {
      const elapsed = t - ts.startMs
      const remain = ts.endMs - t
      const fadeIn = clamp(elapsed / 220, 0, 1)
      const fadeOut = clamp(remain / 220, 0, 1)
      const opacity = Math.min(fadeIn, fadeOut)
      const translateY = (1 - easeOutCubic(fadeIn)) * -12
      const remainingRatio = clamp(remain / Math.max(1, ts.durationMs), 0, 1)

      toasts.push({
        id: ts.id,
        text: ts.text,
        toastType: ts.toastType,
        position: ts.position,
        opacity: Math.round(opacity * 1000) / 1000,
        translateY: Math.round(translateY * 100) / 100,
        remainingRatio: Math.round(remainingRatio * 1000) / 1000,
      })
    }
  }

  // 8. 活跃的元素高亮框列表推导
  const highlights: ActiveHighlightState[] = []
  for (const hl of timeline.events.highlights) {
    if (t >= hl.startMs && t < hl.endMs) {
      const elapsed = t - hl.startMs
      const remain = hl.endMs - t
      const opacity = Math.min(
        clamp(elapsed / 180, 0, 1),
        clamp(remain / 180, 0, 1),
      )
      highlights.push({
        path: hl.path,
        target: hl.target,
        style: hl.style,
        opacity: Math.round(opacity * 1000) / 1000,
      })
    }
  }

  // 9. 活跃的代码块复制反馈列表推导
  const copiedTargets: ActiveCopyFeedbackState[] = []
  for (const cp of timeline.events.copies) {
    if (t >= cp.startMs && t < cp.endMs) {
      copiedTargets.push({
        path: cp.path,
        target: cp.target,
      })
    }
  }

  return {
    timeMs: t,
    frameIndex,
    theme,
    scrollY: Math.round(scrollY * 100) / 100,
    typewriterEnabled,
    revealedUnits,
    pet,
    lyric,
    toasts,
    highlights,
    copiedTargets,
  }
}
