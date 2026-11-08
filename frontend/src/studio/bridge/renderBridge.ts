/**
 * 演播室与 Playwright 离线渲染器的全局握手协议（`window.__studio`）。
 *
 * 暴露 `ready()`、`seek(timeMs)`、`getState()` 方法，保证离线截帧前字体、图片、
 * 文章 Markdown DOM 与 L3 定位器校验全部就绪。
 */

import type { CompiledTimeline, ValidationIssue } from '../types/script'
import type { StudioFrameState } from '../types/state'
import { studioFrameClock } from '../engine/frameClock'
import { useStudioStore } from '../stores/useStudioStore'
import { getArticleContentRoot } from './pageStageDriver'

export interface StudioReadyPayload {
  valid: boolean
  loadError: string | null
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  compiledTimeline: CompiledTimeline | null
  articleTextLength: number
}

export interface StudioRenderBridge {
  /** 等待剧本、音乐、文章 DOM、字体与图片全部就绪并完成 L3 校验 */
  ready(timeoutMs?: number): Promise<StudioReadyPayload>
  /** 跳转到精确毫秒时刻 $t$，等待 DOM 更新与双 rAF 光栅化稳定后 resolve */
  seek(timeMs: number): Promise<void>
  /** 获取当前帧完整状态快照 */
  getState(): StudioFrameState | null
}

declare global {
  interface Window {
    __studio?: StudioRenderBridge
  }
}

/**
 * 轮询等待文章 `.markdown-content` 渲染出实际内容。
 */
async function waitForArticleContentDom(
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const root = getArticleContentRoot()
    if (root && root.textContent && root.textContent.trim().length > 0) {
      return root
    }
    await new Promise((r) => setTimeout(r, 60))
  }
  return getArticleContentRoot()
}

/**
 * 将文章内所有图片设为 eager 加载并等待解码完成，防止滚动截帧时图片闪烁。
 */
async function preloadArticleImages(root: HTMLElement | null): Promise<void> {
  if (!root) return
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'))
  await Promise.all(
    images.map(async (img) => {
      img.loading = 'eager'
      try {
        if (!img.complete && typeof img.decode === 'function') {
          await img.decode()
        }
      } catch {
        // 忽略个别离线或占位图解码异常，避免阻塞整体渲染
      }
    }),
  )
}

/**
 * 在 `window.__studio` 上挂载渲染桥接器。
 */
export function installStudioRenderBridge(): StudioRenderBridge {
  const bridge: StudioRenderBridge = {
    async ready(timeoutMs = 15000): Promise<StudioReadyPayload> {
      const studioStore = useStudioStore()
      const start = Date.now()

      // 1. 等待剧本与音乐 JSON 加载完毕
      while (studioStore.isLoading && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 40))
      }

      // 2. 等待文章正文 DOM 渲染完毕
      const contentRoot = await waitForArticleContentDom(
        Math.max(1000, timeoutMs - (Date.now() - start)),
      )

      // 3. 等待字体与图片解码
      if (typeof document !== 'undefined' && 'fonts' in document) {
        try {
          await document.fonts.ready
        } catch {
          // 忽略字体等待异常
        }
      }
      await preloadArticleImages(contentRoot)

      // 4. 运行 L3 DOM 校验并定位到第 0 帧
      studioStore.runDomValidationAndRefresh(contentRoot)
      await studioFrameClock.seek(studioFrameClock.currentTimeMs.value)

      return {
        valid: studioStore.isScriptValid,
        loadError: studioStore.loadError,
        errors: studioStore.validationErrors,
        warnings: studioStore.validationWarnings,
        compiledTimeline: studioStore.compiledTimeline,
        articleTextLength: contentRoot?.textContent?.length ?? 0,
      }
    },

    async seek(timeMs: number): Promise<void> {
      await studioFrameClock.seek(timeMs)
    },

    getState(): StudioFrameState | null {
      const studioStore = useStudioStore()
      return studioStore.currentFrameState
    },
  }

  if (typeof window !== 'undefined') {
    window.__studio = bridge
  }

  return bridge
}
