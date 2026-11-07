/**
 * 演播室文章锚点与代码块定位器解析模块（LocatorResolver）。
 *
 * 按标题原文匹配 DOM 节点，并在标题所属章节区间内扫描局部序号的 `.code-block-wrapper`，
 * 使得文章其他章节增删代码块时不影响当前章节的定位（PRD §5.5.1）。
 */

import type {
  StudioLocator,
  StudioScrollTarget,
  StudioTypewriterTarget,
} from '../types/script'
import type { StudioDomMetrics } from '../types/state'

/**
 * 将剧本定位器解析为真实文章 DOM 元素。
 *
 * @param locator 剧本定位器（`"#id"` 字符串或 `{ heading, nth?, codeBlock? }`）
 * @param contentRoot 文章 `.markdown-content` 根容器
 * @returns 匹配的 HTML 元素，未找到时返回 `null`
 */
export function resolveLocator(
  locator: StudioLocator,
  contentRoot: HTMLElement | null | undefined,
): HTMLElement | null {
  if (!contentRoot) return null

  // 1. 字符串简写：按 #id 或直接 id 查找
  if (typeof locator === 'string') {
    const rawId = locator.startsWith('#') ? locator.slice(1) : locator
    if (!rawId) return null
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(rawId)
        : rawId.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1')
    return contentRoot.querySelector<HTMLElement>(`[id="${escaped}"]`)
  }

  // 2. 按标题原文查找第 nth 个同名标题（忽略首尾空白）
  const targetText = locator.heading.trim()
  const nth = locator.nth ?? 1
  const headings = Array.from(
    contentRoot.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
  )
  const matchedHeadings = headings.filter(
    (h) => (h.textContent || '').trim() === targetText,
  )
  const anchorHeading = matchedHeadings[nth - 1]
  if (!anchorHeading) return null

  // 未指定 codeBlock 时，目标即为该标题本身
  if (locator.codeBlock === undefined) {
    return anchorHeading
  }

  // 3. 查找“该标题到下一个同级或更高级标题之间”的第 codeBlock 个代码块
  const anchorLevel = Number(anchorHeading.tagName.slice(1))
  const anchorIndex = headings.indexOf(anchorHeading)
  let boundaryHeading: HTMLElement | null = null

  for (let i = anchorIndex + 1; i < headings.length; i++) {
    const h = headings[i]!
    const level = Number(h.tagName.slice(1))
    if (level <= anchorLevel) {
      boundaryHeading = h
      break
    }
  }

  const allCodeBlocks = Array.from(
    contentRoot.querySelectorAll<HTMLElement>('.code-block-wrapper, pre'),
  )
  // 若既有 .code-block-wrapper 又有内部 pre，优先过滤出 .code-block-wrapper（若无 wrapper 则退回 pre）
  const hasWrappers = allCodeBlocks.some((el) =>
    el.classList.contains('code-block-wrapper'),
  )
  const candidateBlocks = hasWrappers
    ? allCodeBlocks.filter((el) => el.classList.contains('code-block-wrapper'))
    : allCodeBlocks

  const sectionCodeBlocks = candidateBlocks.filter((cb) => {
    const afterAnchor = Boolean(
      anchorHeading.compareDocumentPosition(cb) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const beforeBoundary = boundaryHeading
      ? Boolean(
          cb.compareDocumentPosition(boundaryHeading) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
      : true
    return afterAnchor && beforeBoundary
  })

  return sectionCodeBlocks[locator.codeBlock - 1] ?? null
}

/**
 * 基于真实文章 DOM 容器构造 `StudioDomMetrics` 测量器。
 *
 * @param getContentRoot 获取 `.markdown-content` 根元素的回调
 * @param getZoom 获取当前演播室 `video.zoom` 缩放比例的回调
 * @param typewriterLookup 可选的打字机标题权重查询接口
 * @returns 供 `deriveFrameState` 使用的 DOM 度量对象
 */
export function createBrowserDomMetrics(
  getContentRoot: () => HTMLElement | null,
  getZoom: () => number = () => 1.1,
  typewriterLookup?: {
    getTotalUnits: () => number
    getUnitsForElement: (el: HTMLElement) => number
  },
): StudioDomMetrics {
  return {
    resolveScrollTargetY(target: StudioScrollTarget, offset: number): number {
      if (typeof target === 'number') {
        return Math.max(0, target + offset)
      }
      if (target === 'top') {
        return 0
      }
      if (target === 'bottom') {
        if (typeof document === 'undefined') return 0
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        )
        return maxScroll
      }

      const root = getContentRoot()
      const el = resolveLocator(target, root)
      if (!el || typeof window === 'undefined') return 0

      const zoom = getZoom() || 1
      const rect = el.getBoundingClientRect()
      // getBoundingClientRect().top 在 zoom 下为缩放后视口偏移，结合当前 scrollY 换算目标滚动位置
      const elementDocTop = window.scrollY + rect.top * zoom
      return Math.max(0, Math.round(elementDocTop + offset))
    },

    resolveHeadingId(locator: StudioLocator | null): string | null {
      if (!locator) return null
      const root = getContentRoot()
      const el = resolveLocator(locator, root)
      if (el && el.id) return el.id
      if (typeof locator === 'string') {
        return locator.startsWith('#') ? locator.slice(1) : locator
      }
      return null
    },

    resolveTypewriterUnits(target: StudioTypewriterTarget): number {
      const total = typewriterLookup ? typewriterLookup.getTotalUnits() : 1000
      if (target === 'end') return total
      const root = getContentRoot()
      const el = resolveLocator(target, root)
      if (!el || !typewriterLookup) return total
      return typewriterLookup.getUnitsForElement(el)
    },

    get totalTypewriterUnits(): number {
      return typewriterLookup ? typewriterLookup.getTotalUnits() : 1000
    },
  }
}
