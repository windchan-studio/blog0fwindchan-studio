/**
 * 演播室全局唯一帧时钟（FrameClock）。
 *
 * 接管演播室模式下的一切时间推进：
 * - 实时预览模式下通过 `performance.now()` 增量驱动 `currentTimeMs`；
 * - 导演拖拽与 Playwright 离线截帧模式下通过 `await seek(t)` 一步到位并等待双 rAF 光栅化提交。
 */

import { computed, nextTick, readonly, ref, type ComputedRef, type Ref } from 'vue'
import { clamp } from './easing'

export interface FrameClock {
  /** 当前精确毫秒时间戳（响应式只读） */
  readonly currentTimeMs: Readonly<Ref<number>>
  /** 当前总时长毫秒数 */
  readonly totalDurationMs: Ref<number>
  /** 当前帧率（24 或 30） */
  readonly fps: Ref<24 | 30>
  /** 当前帧序号：Math.floor((currentTimeMs * fps) / 1000) */
  readonly currentFrame: ComputedRef<number>
  /** 是否处于实时预览播放中 */
  readonly isPlaying: Readonly<Ref<boolean>>
  /** 循环播放区间（导演控制栏按 L 键启用当前 segment 循环） */
  readonly loopRange: Ref<{ startMs: number; endMs: number } | null>

  /** 启动实时预览播放 */
  play(): void
  /** 暂停播放 */
  pause(): void
  /** 切换播放/暂停 */
  togglePlay(): void
  /**
   * 跳转到任意毫秒时刻 $t$，同步触发状态推导与 DOM 驱动，并在渲染管线就绪后 resolve。
   */
  seek(timeMs: number): Promise<void>
  /** 按帧步进：`deltaFrames` 可为 +1 / -1 / +fps / -fps */
  stepFrames(deltaFrames: number): Promise<void>
  /** 注册每次时间变更时的同步状态应用钩子 */
  onTick(listener: (timeMs: number) => void): () => void
  /** 重置帧时钟 */
  reset(): void
}

/**
 * 等待浏览器完成两轮 `requestAnimationFrame`（在非浏览器测试环境下立即 resolve）。
 */
function waitDoubleRaf(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        resolve()
      })
    })
  })
}

/**
 * 创建帧时钟实例。
 */
export function createFrameClock(): FrameClock {
  const currentTimeMs = ref(0)
  const totalDurationMs = ref(0)
  const fps = ref<24 | 30>(30)
  const isPlaying = ref(false)
  const loopRange = ref<{ startMs: number; endMs: number } | null>(null)

  const listeners = new Set<(timeMs: number) => void>()
  let rafId: number | null = null
  let lastWallTimeMs = 0

  const currentFrame = computed(() =>
    Math.floor((currentTimeMs.value * fps.value) / 1000),
  )

  const notifyListeners = (t: number) => {
    for (const fn of listeners) {
      fn(t)
    }
  }

  const stopRaf = () => {
    if (
      rafId !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(rafId)
    }
    rafId = null
  }

  const stepLoop = (now: number) => {
    if (!isPlaying.value) return
    const delta = Math.max(0, now - lastWallTimeMs)
    lastWallTimeMs = now

    const maxTime = Math.max(0, totalDurationMs.value)
    let nextTime = currentTimeMs.value + delta

    if (loopRange.value) {
      const { startMs, endMs } = loopRange.value
      if (nextTime >= endMs) {
        nextTime = startMs + ((nextTime - startMs) % Math.max(1, endMs - startMs))
      }
    } else if (maxTime > 0 && nextTime >= maxTime) {
      nextTime = maxTime
      isPlaying.value = false
      stopRaf()
    }

    currentTimeMs.value = clamp(nextTime, 0, maxTime > 0 ? maxTime : nextTime)
    notifyListeners(currentTimeMs.value)

    if (
      isPlaying.value &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      rafId = window.requestAnimationFrame(stepLoop)
    }
  }

  const play = () => {
    if (isPlaying.value) return
    const maxTime = totalDurationMs.value
    if (maxTime > 0 && currentTimeMs.value >= maxTime) {
      currentTimeMs.value = loopRange.value ? loopRange.value.startMs : 0
      notifyListeners(currentTimeMs.value)
    }
    isPlaying.value = true
    lastWallTimeMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function'
    ) {
      rafId = window.requestAnimationFrame(stepLoop)
    }
  }

  const pause = () => {
    isPlaying.value = false
    stopRaf()
  }

  const togglePlay = () => {
    if (isPlaying.value) {
      pause()
    } else {
      play()
    }
  }

  const seek = async (timeMs: number): Promise<void> => {
    const maxTime = totalDurationMs.value
    const clamped =
      maxTime > 0 ? clamp(timeMs, 0, maxTime) : Math.max(0, timeMs)
    currentTimeMs.value = clamped
    lastWallTimeMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now()

    notifyListeners(clamped)
    await nextTick()
    await waitDoubleRaf()
  }

  const stepFrames = async (deltaFrames: number): Promise<void> => {
    pause()
    const frameDurationMs = 1000 / fps.value
    const targetFrame = Math.max(0, currentFrame.value + deltaFrames)
    const targetTimeMs = targetFrame * frameDurationMs
    await seek(targetTimeMs)
  }

  const onTick = (listener: (timeMs: number) => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const reset = () => {
    pause()
    currentTimeMs.value = 0
    totalDurationMs.value = 0
    loopRange.value = null
  }

  return {
    currentTimeMs: readonly(currentTimeMs),
    totalDurationMs,
    fps,
    currentFrame,
    isPlaying: readonly(isPlaying),
    loopRange,
    play,
    pause,
    togglePlay,
    seek,
    stepFrames,
    onTick,
    reset,
  }
}

/** 全局帧时钟单例 */
export const studioFrameClock = createFrameClock()
