/**
 * 演播室页面舞台 DOM 驱动器（PageStageDriver）。
 *
 * 负责将纯函数推导出的 `StudioFrameState` 同步施加到真实浏览器 DOM：
 * - 页面垂直滚动位置 `window.scrollTo({ top, behavior: 'instant' })`
 * - 打字机静态揭示快照
 * - 代码块复制按钮 `.copied` 视觉反馈
 * - 目标元素高亮框的视口坐标测算
 */

import type { StudioFrameState } from '../types/state'
import {
  createBrowserDomMetrics,
  resolveLocator,
} from '../engine/locatorResolver'
import {
  useStudioStore,
  type HighlightOverlayRect,
} from '../stores/useStudioStore'

/** 打字机组件在演播室模式下注册的快照控制接口 */
export interface StudioTypewriterController {
  getTotalUnits(): number
  getUnitsForElement(el: HTMLElement): number
  applySnapshot(units: number, enabled: boolean): void
}

let activeTypewriterController: StudioTypewriterController | null = null

/**
 * 由 `ContentTypeWriter.vue` 在挂载/卸载时注册或注销演播室快照控制器。
 */
export function registerStudioTypewriterController(
  ctrl: StudioTypewriterController | null,
): void {
  activeTypewriterController = ctrl
}

/**
 * 查找当前页面中的文章 Markdown 正文根容器。
 */
export function getArticleContentRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return (
    document.querySelector<HTMLElement>(
      '.markdown-content .content-wrapper',
    ) ||
    document.querySelector<HTMLElement>('.markdown-content') ||
    document.querySelector<HTMLElement>('.article-content')
  )
}

/**
 * 将 `StudioFrameState` 同步施加到真实页面 DOM。
 */
export function applyPageStageState(state: StudioFrameState): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const studioStore = useStudioStore()
  const contentRoot = getArticleContentRoot()
  const zoom = studioStore.videoZoom || 1

  // 1. 驱动打字机快照（若当前页面挂载了 ContentTypeWriter）
  if (activeTypewriterController) {
    activeTypewriterController.applySnapshot(
      state.revealedUnits,
      state.typewriterEnabled,
    )
  }

  // 2. 驱动确定性页面垂直滚动（禁止 smooth 异步滚动）
  if (Math.abs(window.scrollY - state.scrollY) > 0.5) {
    window.scrollTo({
      top: state.scrollY,
      left: 0,
      behavior: 'instant' as ScrollBehavior,
    })
  }

  if (!contentRoot) {
    studioStore.activeHighlightRects = []
    return
  }

  // 3. 驱动代码块 `.code-copy-btn` 的 `.copied` 反馈状态
  const allCopyBtns = contentRoot.querySelectorAll<HTMLElement>(
    '.code-copy-btn.copied',
  )
  allCopyBtns.forEach((btn) => btn.classList.remove('copied'))

  for (const cp of state.copiedTargets) {
    const targetEl = resolveLocator(cp.target, contentRoot)
    if (!targetEl) continue
    const copyBtn = targetEl.classList.contains('code-copy-btn')
      ? targetEl
      : targetEl.querySelector<HTMLElement>('.code-copy-btn')
    if (copyBtn) {
      copyBtn.classList.add('copied')
    }
  }

  // 4. 测算当前活跃的 highlight 元素在输出视口（1920x1080）中的坐标矩形
  const rects: HighlightOverlayRect[] = []
  for (const hl of state.highlights) {
    const targetEl = resolveLocator(hl.target, contentRoot)
    if (!targetEl) continue
    const r = targetEl.getBoundingClientRect()
    // .main-layout 应用了 CSS zoom，getBoundingClientRect() 返回的坐标需乘以 zoom 对齐顶层 StudioRoot 视口像素
    rects.push({
      path: hl.path,
      style: hl.style,
      opacity: hl.opacity,
      top: Math.round(r.top * zoom - 6),
      left: Math.round(r.left * zoom - 8),
      width: Math.round(r.width * zoom + 16),
      height: Math.round(r.height * zoom + 12),
    })
  }
  studioStore.activeHighlightRects = rects
}

/**
 * 初始化并向 `useStudioStore` 绑定浏览器 DOM 度量与舞台驱动器。
 */
export function setupStudioStageBridge(): void {
  const studioStore = useStudioStore()
  const domMetrics = createBrowserDomMetrics(
    getArticleContentRoot,
    () => studioStore.videoZoom,
    {
      getTotalUnits: () =>
        activeTypewriterController
          ? activeTypewriterController.getTotalUnits()
          : 1000,
      getUnitsForElement: (el: HTMLElement) =>
        activeTypewriterController
          ? activeTypewriterController.getUnitsForElement(el)
          : 1000,
    },
  )

  studioStore.registerStageDriver(() => domMetrics, applyPageStageState)
}
