/**
 * 演播室主状态管理仓（useStudioStore）。
 *
 * 负责剧本与烘焙音乐加载、三层校验调度、时间线编译、逐帧状态快照维护，
 * 以及被拦截的博客原生系统 Toast 收集。
 */

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { TocItem } from '@/composables/useArticleInfo'
import type { ToastOptions } from '@/stores/toastStore'
import { setStudioThemeOverride } from '@/composables/useTheme'
import type { MusicBakeJson } from '../types/music'
import type {
  CompiledTimeline,
  ScriptJson,
  ValidationIssue,
} from '../types/script'
import type { StudioDomMetrics, StudioFrameState } from '../types/state'
import { studioFrameClock } from '../engine/frameClock'
import {
  validateScriptAgainstDom,
  validateScriptStatic,
} from '../engine/scriptValidator'
import {
  DEFAULT_DOM_METRICS,
  deriveFrameState,
} from '../engine/stateDeriver'
import { compileTimeline } from '../engine/timelineCompiler'

/** 被演播室拦截的博客自发系统 Toast 记录 */
export interface CapturedSystemToast {
  id: number
  message: string
  type: 'success' | 'warning' | 'error' | 'info'
  title?: string
  capturedAtTimeMs: number
  capturedAtWallTime: string
}

/** 高亮框在视口内的实测几何矩形 */
export interface HighlightOverlayRect {
  path: string
  style: 'glow' | 'box'
  opacity: number
  top: number
  left: number
  width: number
  height: number
}

export const useStudioStore = defineStore('studio', () => {
  /** 是否处于演播室模式（URL 含 `?studio=<id>`） */
  const isStudioMode = ref(false)
  /** 是否启用导演预览控制栏（URL 含 `?director=1`） */
  const isDirectorMode = ref(false)
  /** 当前加载的剧本 ID */
  const scriptId = ref<string>('')
  /** 是否正在加载剧本或音乐资产 */
  const isLoading = ref(false)
  /** 加载失败的致命错误描述 */
  const loadError = ref<string | null>(null)

  /** 原始剧本 JSON */
  const rawScript = shallowRef<ScriptJson | null>(null)
  /** 已加载的预烘焙音乐字典 */
  const musicMap = shallowRef<Record<string, MusicBakeJson>>({})
  /** 编译后的绝对时间线 */
  const compiledTimeline = shallowRef<CompiledTimeline | null>(null)
  /** 当前时刻 $t$ 推导出的完整画面状态快照 */
  const currentFrameState = shallowRef<StudioFrameState | null>(null)

  /** L1/L2 静态校验问题列表 */
  const staticIssues = ref<ValidationIssue[]>([])
  /** L3 DOM 定位器与遮挡校验问题列表 */
  const domIssues = ref<ValidationIssue[]>([])

  /** 当前文章解析出的目录项（由 ArticleDetailView 或 DOM 扫描同步） */
  const articleTocItems = ref<TocItem[]>([])
  /** 当前视口内活跃的高亮框实测坐标列表 */
  const activeHighlightRects = ref<HighlightOverlayRect[]>([])

  /** 被拦截的博客原生系统 Toast 队列 */
  const capturedSystemToasts = ref<CapturedSystemToast[]>([])
  let nextCapturedToastId = 1

  /** 外部注入的真实浏览器 DOM 度量表与页面舞台驱动钩子 */
  let domMetricsProvider: () => StudioDomMetrics = () => DEFAULT_DOM_METRICS
  let stageDriverCallback: ((state: StudioFrameState) => void) | null = null

  /** 合并后的全量校验问题 */
  const allIssues = computed<ValidationIssue[]>(() => [
    ...staticIssues.value,
    ...domIssues.value,
  ])

  const validationErrors = computed<ValidationIssue[]>(() =>
    allIssues.value.filter((i) => i.level === 'error'),
  )

  const validationWarnings = computed<ValidationIssue[]>(() =>
    allIssues.value.filter((i) => i.level === 'warning'),
  )

  const isScriptValid = computed<boolean>(
    () =>
      !loadError.value &&
      validationErrors.value.length === 0 &&
      compiledTimeline.value !== null,
  )

  /**当前页面缩放比例 */
  const videoZoom = computed<number>(
    () => compiledTimeline.value?.video.zoom ?? 1.1,
  )

  /**
   * 注册 DOM 度量提供器与舞台驱动回调。
   */
  function registerStageDriver(
    metricsGetter: () => StudioDomMetrics,
    driverFn: (state: StudioFrameState) => void,
  ) {
    domMetricsProvider = metricsGetter
    stageDriverCallback = driverFn
  }

  /**
   * 根据给定毫秒数 $t$ 同步计算并应用帧状态。
   */
  function evaluateAtTime(timeMs: number) {
    const timeline = compiledTimeline.value
    if (!timeline) return

    const metrics = domMetricsProvider()
    const state = deriveFrameState(timeline, timeMs, metrics)
    currentFrameState.value = state
    setStudioThemeOverride(state.theme)

    if (stageDriverCallback) {
      stageDriverCallback(state)
    }
  }

  // 订阅全局帧时钟 tick
  studioFrameClock.onTick((t) => {
    if (isStudioMode.value && compiledTimeline.value) {
      evaluateAtTime(t)
    }
  })

  /**
   * 拦截并记录一条博客原生发出的系统 Toast（PRD §7.0 & §10 #6）。
   */
  function captureSystemToast(options: ToastOptions): number {
    const id = nextCapturedToastId++
    const now = new Date()
    const wallTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    capturedSystemToasts.value.unshift({
      id,
      message: options.message,
      type: options.type || 'info',
      title: options.title,
      capturedAtTimeMs: Math.round(studioFrameClock.currentTimeMs.value),
      capturedAtWallTime: wallTime,
    })
    return id
  }

  function clearCapturedToasts() {
    capturedSystemToasts.value = []
  }

  /**
   * 在 html 根节点上同步演播室属性与缩放 CSS 变量。
   */
  function syncRootHtmlAttributes(active: boolean, zoom = 1.1) {
    if (typeof document === 'undefined') return
    const html = document.documentElement
    if (active) {
      html.setAttribute('data-studio-mode', 'true')
      html.style.setProperty('--studio-zoom', String(zoom))
    } else {
      html.removeAttribute('data-studio-mode')
      html.style.removeProperty('--studio-zoom')
    }
  }

  /**
   * 从 `/__studio_fs/` 加载指定 ID 的剧本及关联的烘焙音乐文件，并完成编译。
   *
   * @param targetScriptId 剧本 ID（对应 `studio/scripts/<id>.script.json`）
   * @param preserveTimeMs 热重载时是否保留当前帧时钟位置
   */
  async function loadStudioScript(
    targetScriptId: string,
    preserveTimeMs = false,
  ): Promise<boolean> {
    const prevTimeMs = preserveTimeMs ? studioFrameClock.currentTimeMs.value : 0
    isLoading.value = true
    loadError.value = null
    staticIssues.value = []
    domIssues.value = []
    scriptId.value = targetScriptId

    try {
      const cacheBuster = `?t=${Date.now()}`
      const scriptResp = await fetch(
        `/__studio_fs/scripts/${encodeURIComponent(targetScriptId)}.script.json${cacheBuster}`,
      )
      if (!scriptResp.ok) {
        throw new Error(
          `无法加载剧本文件 "studio/scripts/${targetScriptId}.script.json" (HTTP ${scriptResp.status})`,
        )
      }

      let parsedScript: unknown
      try {
        parsedScript = await scriptResp.json()
      } catch (syntaxErr) {
        throw new Error(
          `剧本 JSON 语法解析失败: ${(syntaxErr as Error).message}`,
        )
      }

      // 预加载剧本引用的所有预烘焙音乐文件
      const loadedMusic: Record<string, MusicBakeJson> = {}
      const maybeTracks = (parsedScript as ScriptJson)?.music?.tracks
      if (Array.isArray(maybeTracks)) {
        for (const tr of maybeTracks) {
          if (tr && typeof tr.ref === 'string' && tr.ref.trim()) {
            const refName = tr.ref.trim()
            if (loadedMusic[refName]) continue
            try {
              const mResp = await fetch(
                `/__studio_fs/music/${encodeURIComponent(refName)}.json${cacheBuster}`,
              )
              if (mResp.ok) {
                loadedMusic[refName] = (await mResp.json()) as MusicBakeJson
              }
            } catch {
              // 缺失或损坏的音乐文件交由 L2 校验器统一报错定位
            }
          }
        }
      }

      musicMap.value = loadedMusic

      // 运行 L1 + L2 静态校验
      const staticResult = validateScriptStatic(parsedScript, loadedMusic)
      staticIssues.value = [
        ...staticResult.errors,
        ...staticResult.warnings,
      ]

      if (!staticResult.valid) {
        rawScript.value = parsedScript as ScriptJson
        compiledTimeline.value = null
        return false
      }

      const validScript = parsedScript as ScriptJson
      rawScript.value = validScript

      // 编译为绝对时间线
      const timeline = compileTimeline(validScript, loadedMusic)
      compiledTimeline.value = timeline

      // 配置帧时钟参数
      studioFrameClock.fps.value = timeline.video.fps
      studioFrameClock.totalDurationMs.value = timeline.totalDurationMs
      syncRootHtmlAttributes(true, timeline.video.zoom)

      await studioFrameClock.seek(
        preserveTimeMs
          ? Math.min(prevTimeMs, timeline.totalDurationMs)
          : 0,
      )
      return true
    } catch (err) {
      loadError.value = (err as Error).message || '加载剧本失败'
      compiledTimeline.value = null
      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 在文章 `.markdown-content` 渲染就绪后执行 L3 DOM 校验并刷新当前帧布局。
   */
  function runDomValidationAndRefresh(contentRoot: HTMLElement | null) {
    if (!rawScript.value || !compiledTimeline.value || !contentRoot) {
      return
    }
    // 扫描真实文章标题填充目录项
    const headings = Array.from(
      contentRoot.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    )
    articleTocItems.value = headings.map((h, idx) => {
      if (!h.id) {
        h.id = `studio-heading-${idx}`
      }
      return {
        id: h.id,
        text: (h.textContent || '').trim(),
        level: Number(h.tagName.slice(1)),
      }
    })

    domIssues.value = validateScriptAgainstDom(
      rawScript.value,
      compiledTimeline.value,
      contentRoot,
    )
    evaluateAtTime(studioFrameClock.currentTimeMs.value)
  }

  /**
   * 进入演播室模式。
   */
  async function enterStudioMode(
    targetScriptId: string,
    director = false,
  ): Promise<boolean> {
    isStudioMode.value = true
    isDirectorMode.value = director
    syncRootHtmlAttributes(true, 1.1)
    return loadStudioScript(targetScriptId, false)
  }

  /**
   * 退出演播室模式并恢复日常浏览状态。
   */
  function exitStudioMode() {
    studioFrameClock.reset()
    isStudioMode.value = false
    isDirectorMode.value = false
    scriptId.value = ''
    rawScript.value = null
    compiledTimeline.value = null
    currentFrameState.value = null
    staticIssues.value = []
    domIssues.value = []
    activeHighlightRects.value = []
    setStudioThemeOverride(null)
    syncRootHtmlAttributes(false)
  }

  return {
    isStudioMode,
    isDirectorMode,
    scriptId,
    isLoading,
    loadError,
    rawScript,
    musicMap,
    compiledTimeline,
    currentFrameState,
    staticIssues,
    domIssues,
    allIssues,
    validationErrors,
    validationWarnings,
    isScriptValid,
    videoZoom,
    articleTocItems,
    activeHighlightRects,
    capturedSystemToasts,
    registerStageDriver,
    evaluateAtTime,
    captureSystemToast,
    clearCapturedToasts,
    loadStudioScript,
    runDomValidationAndRefresh,
    enterStudioMode,
    exitStudioMode,
  }
})
