/**
 * 顶栏音乐预烘焙数据契约与歌词匹配结果类型定义。
 *
 * 字段命名与后端 `LyricLine.to_dict()` 及 `studio/schema/music.schema.json` 保持一致。
 */

/** 单行预烘焙歌词项 */
export interface BakedLyricLine {
  /** 该句起始毫秒时间戳 */
  time_ms: number
  /** 该句持续毫秒数 */
  duration_ms: number
  /** 原文歌词 */
  text: string
  /** 中文译文（无译文时为空字符串） */
  translation: string
  /** 罗马音（无罗马音时为空字符串） */
  romaji: string
}

/** 烘焙音乐元数据 */
export interface BakedMusicMeta {
  title: string
  artist: string
  album: string
  duration_ms: number
}

/** 烘焙音乐完整 JSON 文件结构（对应 `studio/music/<ref>.json`） */
export interface MusicBakeJson {
  $schema?: string
  version: 1
  id: string
  baked_at: string
  source: {
    provider: 'netease' | 'custom'
    song_id: number
  }
  meta: BakedMusicMeta
  lyrics: {
    has_translation: boolean
    has_romaji: boolean
    lines: BakedLyricLine[]
  }
}

/** 单句匹配结果（含当前句内部播放进度） */
export interface MatchedLyricLine extends BakedLyricLine {
  /** 在歌词数组中的索引，前奏期间为 -1 */
  index: number
  /** 当前句内部的播放进度 [0, 1] */
  line_progress: number
}

/** `matchSentence` 歌词查询函数的返回结构 */
export interface MatchedSentenceResult {
  /** 命中的歌词行索引，前奏或空歌词时为 -1 */
  index: number
  /** 当前命中的歌词行详情，纯音乐无歌词时为 null */
  current_line: MatchedLyricLine | null
  /** 当前句进度 [0, 1] */
  line_progress: number
  /** 是否处于第一句歌词之前的前奏阶段 */
  is_prelude: boolean
  /** 是否已超过最后一句歌词的结束时间 */
  is_ended: boolean
}
