/**
 * 演播室剧本原始数据结构（ScriptJson）与编译后绝对时间线（CompiledTimeline）类型定义。
 */

import type { MusicBakeJson } from './music'

/** 桌宠全量情绪枚举（含原日常情绪与演播室新增教学情绪） */
export type StudioMood =
  | 'typing'
  | 'reading'
  | 'sleepy'
  | 'dizzy'
  | 'shocked'
  | 'warning'
  | 'cheer'
  | 'thinking'
  | 'proud'
  | 'success'

/** 缓动函数名称 */
export type StudioEasingName = 'linear' | 'easeInOut' | 'easeOut'

/** 亮暗主题枚举 */
export type StudioThemeMode = 'light' | 'dark'

/** Toast 类型枚举 */
export type StudioToastType = 'success' | 'info' | 'warning' | 'error'

/** Toast 屏幕方位 */
export type StudioToastPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'

/**
 * 文章锚点与代码块定位器（PRD §5.5.1）。
 * - 字符串简写：`"#dom-id"`
 * - 对象写法：按标题原文匹配第 `nth` 个同名标题，或该标题章节下的第 `codeBlock` 个代码块
 */
export type StudioLocator =
  | string
  | {
      heading: string
      nth?: number
      codeBlock?: number
    }

/** 滚动动作目标：定位器、页面顶/底部或绝对像素值 */
export type StudioScrollTarget = StudioLocator | 'top' | 'bottom' | number

/** 打字机动作目标：标题定位器或全文末尾 */
export type StudioTypewriterTarget = StudioLocator | 'end'

/** 页面平滑滚动动作 */
export interface StudioScrollAction {
  type: 'scroll'
  at?: number
  to: StudioScrollTarget
  offset?: number
  durationMs?: number
  easing?: StudioEasingName
}

/** 打字机推进动作 */
export interface StudioTypewriterAction {
  type: 'typewriter'
  at?: number
  until: StudioTypewriterTarget
  durationMs: number
}

/** 目录栏展开/收起与节点高亮动作 */
export interface StudioTocAction {
  type: 'toc'
  at?: number
  expand?: boolean
  highlight?: StudioLocator
}

/** 元素高亮框动作 */
export interface StudioHighlightAction {
  type: 'highlight'
  at?: number
  target: StudioLocator
  style?: 'glow' | 'box'
  untilLineEnd?: boolean
}

/** 代码块复制按钮反馈动作 */
export interface StudioCopyAction {
  type: 'copy'
  at?: number
  target: StudioLocator
}

/** 亮暗主题切换动作 */
export interface StudioThemeAction {
  type: 'theme'
  at?: number
  to: StudioThemeMode
  durationMs?: number
}

/** 剧本定时 Toast 投放动作 */
export interface StudioToastAction {
  type: 'toast'
  at?: number
  text: string
  toastType?: StudioToastType
  durationMs?: number
  position?: StudioToastPosition
}

/** 本句台词结束后的额外纯画面等待动作 */
export interface StudioWaitAction {
  type: 'wait'
  at?: number
  durationMs: number
}

/** Phase 3 预留画中画/实操叠加动作（Phase 1 校验报错） */
export interface StudioOverlayAction {
  type: 'overlay'
  at?: number
  [key: string]: unknown
}

/** 剧本动作联合类型 */
export type StudioAction =
  | StudioScrollAction
  | StudioTypewriterAction
  | StudioTocAction
  | StudioHighlightAction
  | StudioCopyAction
  | StudioThemeAction
  | StudioToastAction
  | StudioWaitAction
  | StudioOverlayAction

/** 单句台词定义 */
export interface StudioLine {
  text: string
  duration?: number
  mood?: StudioMood
  note?: string
  actions?: StudioAction[]
}

/** 视频分段定义（对应 1 个教学步骤 = 1 个输出 MP4） */
export interface StudioSegment {
  id: string
  title: string
  tocAnchor?: StudioLocator
  lines: StudioLine[]
}

/** 歌单曲目引用配置 */
export interface StudioMusicTrackConfig {
  ref: string
  startAtMs?: number
}

/** 剧本音乐配置区 */
export interface StudioMusicConfig {
  tracks?: StudioMusicTrackConfig[]
  crossfadeMs?: number
  announce?: boolean
  outro?: {
    text?: string
  }
}

/** 剧本视频全局配置区 */
export interface StudioVideoConfig {
  width?: number
  height?: number
  fps?: 24 | 30
  zoom?: number
  theme?: StudioThemeMode
  defaults?: {
    mood?: StudioMood
    gapMs?: number
  }
}

/** 剧本 JSON 顶层结构（对应 `studio/scripts/<id>.script.json`） */
export interface ScriptJson {
  $schema?: string
  version: 1
  id: string
  title: string
  article: {
    slug: string
    category?: string
  }
  video?: StudioVideoConfig
  music?: StudioMusicConfig
  segments: StudioSegment[]
}

// ============================================================================
// 编译后绝对时间线数据结构 (CompiledTimeline)
// ============================================================================

/** 编译后的单句台词绝对时间槽 */
export interface CompiledLine {
  /** 全局台词序号（0-based） */
  globalLineIndex: number
  /** 所属分段序号（0-based） */
  segmentIndex: number
  /** 分段内台词序号（0-based） */
  lineIndex: number
  /** 结构化路径（如 `segments[1].lines[0]`） */
  path: string
  /** 原始台词文本 */
  text: string
  /** 导演备注 */
  note?: string
  /** 生效的情绪（已處理继承） */
  mood: StudioMood
  /** 气泡显示起始毫秒 $t_{\text{start}}$ */
  startMs: number
  /** 气泡说话结束毫秒 $t_{\text{speakEnd}} = t_{\text{start}} + \text{speakDurationMs}$ */
  speakEndMs: number
  /** 纯画面等待结束毫秒 $t_{\text{waitEnd}} = t_{\text{speakEnd}} + W$ */
  waitEndMs: number
  /** 含句间 `gapMs` 的完整槽位结束毫秒 $t_{\text{slotEnd}}$ */
  slotEndMs: number
  /** 说话持续毫秒数 */
  speakDurationMs: number
  /** 时长来源：手写或语速公式推算 */
  durationSource: 'manual' | 'auto'
  /** 附加等待毫秒数 */
  waitDurationMs: number
  /** 句尾空白间隔毫秒数 */
  gapDurationMs: number
}

/** 编译后的分段绝对时间区间 */
export interface CompiledSegment {
  /** 分段索引（0-based） */
  index: number
  /** 分段唯一 ID */
  id: string
  /** 分段标题 */
  title: string
  /** 进入本分段时自动高亮的目录锚点 */
  tocAnchor?: StudioLocator
  /** 分段起始毫秒 */
  startMs: number
  /** 分段结束毫秒 */
  endMs: number
  /** 分段总时长毫秒 */
  durationMs: number
  /** 起始帧号（含） */
  startFrame: number
  /** 结束帧号（不含） */
  endFrame: number
  /** 进入该分段瞬间的初始持续状态快照（供增量渲染计算 segmentHash） */
  enteredState: {
    theme: StudioThemeMode
    tocExpanded: boolean
    activeHeadingLocator: StudioLocator | null
    mood: StudioMood
  }
  /** 本分段包含的已编译台词列表 */
  lines: CompiledLine[]
}

/** 编译后的滚动事件 */
export interface CompiledScrollEvent {
  path: string
  startMs: number
  endMs: number
  durationMs: number
  to: StudioScrollTarget
  offset: number
  easing: StudioEasingName
}

/** 编译后的目录状态事件 */
export interface CompiledTocEvent {
  path: string
  atMs: number
  expand?: boolean
  highlight?: StudioLocator
}

/** 编译后的元素高亮事件 */
export interface CompiledHighlightEvent {
  path: string
  startMs: number
  endMs: number
  target: StudioLocator
  style: 'glow' | 'box'
}

/** 编译后的代码块复制反馈事件 */
export interface CompiledCopyEvent {
  path: string
  startMs: number
  endMs: number
  target: StudioLocator
}

/** 编译后的主题切换事件 */
export interface CompiledThemeEvent {
  path: string
  startMs: number
  endMs: number
  to: StudioThemeMode
}

/** 编译后的定时 Toast 事件（含剧本手动投放与歌单自动署名） */
export interface CompiledToastEvent {
  id: string
  path: string
  startMs: number
  endMs: number
  durationMs: number
  text: string
  toastType: StudioToastType
  position: StudioToastPosition
  isMusicAnnounce?: boolean
}

/** 编译后的打字机事件 */
export interface CompiledTypewriterEvent {
  path: string
  startMs: number
  endMs: number
  durationMs: number
  until: StudioTypewriterTarget
}

/** 编译后的单首曲目时间线排期 */
export interface CompiledMusicTrack {
  trackIndex: number
  ref: string
  startAtMs: number
  playDurationMs: number
  videoStartMs: number
  videoEndMs: number
  songStartAtMs: number
  songEndAtMs: number
  bakeData: MusicBakeJson
}

/** 编译后的歌单时间线总结构 */
export interface CompiledMusicTimeline {
  tracks: CompiledMusicTrack[]
  totalMusicDurationMs: number
  crossfadeMs: number
  announce: boolean
  outroText: string
}

/** 标准化后的视频全局参数 */
export interface ResolvedVideoConfig {
  width: number
  height: number
  fps: 24 | 30
  zoom: number
  initialTheme: StudioThemeMode
  defaultMood: StudioMood
  gapMs: number
}

/** 剧本编译总产物 */
export interface CompiledTimeline {
  scriptId: string
  title: string
  articleSlug: string
  articleCategory?: string
  video: ResolvedVideoConfig
  totalDurationMs: number
  totalFrames: number
  segments: CompiledSegment[]
  lines: CompiledLine[]
  events: {
    scrolls: CompiledScrollEvent[]
    tocs: CompiledTocEvent[]
    highlights: CompiledHighlightEvent[]
    copies: CompiledCopyEvent[]
    themes: CompiledThemeEvent[]
    toasts: CompiledToastEvent[]
    typewriters: CompiledTypewriterEvent[]
  }
  music: CompiledMusicTimeline
}

/** 剧本校验问题项（错误或警告） */
export interface ValidationIssue {
  level: 'error' | 'warning'
  layer: 'L1' | 'L2' | 'L3'
  /** 标准化结构路径，如 `segments[1].lines[2].actions[0].target` */
  path: string
  message: string
  segmentIndex?: number
  lineIndex?: number
   globalLineIndex?: number
}
