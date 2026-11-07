/**
 * 演播室逐帧状态快照（StudioFrameState）与 DOM 几何测量表类型定义。
 *
 * 任意时刻 $t$ 的画面表现完全由 `StudioFrameState` 唯一描述，不依赖任何历史累加状态。
 */

import type {
  StudioLocator,
  StudioMood,
  StudioScrollTarget,
  StudioThemeMode,
  StudioToastPosition,
  StudioToastType,
  StudioTypewriterTarget,
} from './script'

/** Cheer 情绪撒花星星粒子的单帧极坐标与透明度 */
export interface CheerStarParticleState {
  id: number
  /** 相对图标中心的水平偏移 (px) */
  x: number
  /** 相对图标中心的垂直偏移 (px) */
  y: number
  /** 缩放比例 */
  scale: number
  /** 透明度 [0, 1] */
  opacity: number
  /** 旋转角度 (deg) */
  rotationDeg: number
}

/** 桌宠字幕框（StudioTocPet）在时刻 $t$ 的完整状态 */
export interface StudioPetFrameState {
  /** 当前分段索引（0-based） */
  currentSegmentIndex: number
  /** 当前分段 ID */
  currentSegmentId: string
  /** 当前分段标题 */
  currentSegmentTitle: string
  /** 当前分段内部进度 [0, 1] */
  segmentProgress: number
  /** 全片步骤总进度 [0, 1] */
  totalStepProgress: number
  /** 当前台词全局索引（若处于纯画面 wait 或无台词则为最后一句或当前句索引） */
  currentGlobalLineIndex: number
  /** 当前台词在分段内的索引（0-based） */
  currentLineInSegmentIndex: number
  /** 气泡是否可见（在 `wait` 纯画面等待期间为 false） */
  bubbleVisible: boolean
  /** 是否处于两句之间的 `gapMs` 空白期（此时气泡保持高度但文本渲染为空占位） */
  isInGap: boolean
  /** 当前显示的台词文本（`thinking` 前 450ms 或 `gapMs` 期间可能被加工或置空） */
  displayText: string
  /** 原始台词文本 */
  rawText: string
  /** 气泡文本入场/退场透明度 [0, 1] */
  textOpacity: number
  /** 气泡文本垂直位移 (px)，入场从 +10px 到 0，退场从 0 到 -8px */
  textTranslateY: number
  /** 当前生效的情绪 */
  mood: StudioMood
  /** 情绪自最近一次生效以来的经过毫秒数 $\tau$ */
  moodElapsedMs: number
  /** 情绪图标附加垂直位移 (px)（用于 warning 敲击下压、proud 浮动） */
  iconOffsetY: number
  /** Thinking 情绪前导省略号点亮个数（0 = 正常显示正文，1~3 = 显示对应数量的点） */
  thinkingDotsCount: 0 | 1 | 2 | 3
  /** Proud 情绪气泡高光扫过位置百分比（null 表示未激活，[-30, 130] 表示扫光中） */
  proudShineLeftPercent: number | null
  /** Success 情绪绿色边框光晕强度 [0, 1] */
  successGlowIntensity: number
  /** Cheer 情绪顶部星星粒子列表 */
  cheerParticles: CheerStarParticleState[]
  /** 目录折叠抽屉展开进度 [0, 1]（经 cubic-bezier(0.25, 0.8, 0.25, 1) 插值） */
  tocExpandProgress: number
  /** 目录目标展开布尔状态 */
  tocExpanded: boolean
  /** 当前高亮的目录标题定位器 */
  activeHeadingLocator: StudioLocator | null
  /** 当前高亮的目录标题 DOM ID（若已解析） */
  activeHeadingId: string | null
}

/** 顶栏单行歌词条（StudioLyricBar）在时刻 $t$ 的状态 */
export interface StudioLyricFrameState {
  /** 是否配置了音乐轨 */
  enabled: boolean
  /** 当前显示的文本（原文歌词、`♪`、`♪ 纯音乐 ♪` 或片尾 outro） */
  text: string
  /** 主歌词透明度 [0, 0.85] */
  opacity: number
  /** 歌间交叉渐变时叠加的下一首歌首行文本（无渐变时为 null） */
  crossfadeNextText: string | null
  /** 歌间交叉渐变时下一首歌文本的透明度 [0, 0.85] */
  crossfadeNextOpacity: number
  /** 当前模式：歌词正文 / 前奏间奏音符呼吸 / 纯音乐 / 片尾结束语 */
  mode: 'lyric' | 'note-breathing' | 'instrumental' | 'outro'
  /** 当前正在播放的曲目索引（无曲目或已结束时为 -1） */
  activeTrackIndex: number
  /** 当前曲目的歌曲内部毫秒时间戳 $t_{\text{song}}$ */
  songTimeMs: number
}

/** 时刻 $t$ 活跃的单条剧本 Toast 状态 */
export interface ActiveStudioToastState {
  id: string
  text: string
  toastType: StudioToastType
  position: StudioToastPosition
  /** 综合入场/退场透明度 [0, 1] */
  opacity: number
  /** 垂直或水平入场位移 (px) */
  translateY: number
  /** 底部倒计时进度条剩余比例 [0, 1] */
  remainingRatio: number
}

/** 时刻 $t$ 活跃的元素高亮框状态 */
export interface ActiveHighlightState {
  path: string
  target: StudioLocator
  style: 'glow' | 'box'
  /** 入场/退场透明度 [0, 1] */
  opacity: number
}

/** 时刻 $t$ 活跃的代码块复制反馈状态 */
export interface ActiveCopyFeedbackState {
  path: string
  target: StudioLocator
}

/**
 * DOM 几何测量与映射接口。
 *
 * 在纯函数单元测试中可传入 Mock 表，在真实浏览器中由 `locatorResolver` 提供实测值。
 */
export interface StudioDomMetrics {
  /**
   * 将滚动目标解析为目标 `window.scrollY` 像素值（已含 offset 偏移）。
   */
  resolveScrollTargetY: (target: StudioScrollTarget, offset: number) => number
  /**
   * 将标题定位器解析为文章 TOC 中的 heading ID。
   */
  resolveHeadingId: (locator: StudioLocator | null) => string | null
  /**
   * 将打字机目标解析为字符/节点累计权重值 $[0, \text{totalUnits}]$。
   */
  resolveTypewriterUnits: (target: StudioTypewriterTarget) => number
  /**
   * 全文打字机总权重值（无打字机动作时恒等于此值）。
   */
  totalTypewriterUnits: number
}

/** 任意时刻 $t$ 推导出的演播室全量画面状态快照 */
export interface StudioFrameState {
  /** 当前帧时钟毫秒数 $t$ */
  timeMs: number
  /** 当前帧序号 $\lfloor t \cdot \text{fps} / 1000 \rfloor$ */
  frameIndex: number
  /** 当前亮暗主题 */
  theme: StudioThemeMode
  /** 当前页面垂直滚动坐标 `window.scrollY` (px) */
  scrollY: number
  /** 是否启用了打字机模式（若剧本中无任何 typewriter 动作则为 false） */
  typewriterEnabled: boolean
  /** 当前打字机已揭示的累计权重单位 */
  revealedUnits: number
  /** 桌宠字幕框与目录步骤状态 */
  pet: StudioPetFrameState
  /** 顶栏单行歌词条状态 */
  lyric: StudioLyricFrameState
  /** 当前活跃的剧本 Toast 列表 */
  toasts: ActiveStudioToastState[]
  /** 当前活跃的高亮元素列表 */
  highlights: ActiveHighlightState[]
  /** 当前处于 `.copied` 状态的代码块列表 */
  copiedTargets: ActiveCopyFeedbackState[]
}
