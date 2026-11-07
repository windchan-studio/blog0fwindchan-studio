/**
 * 顶栏歌词行匹配器（TS 版 `match_sentence`）。
 *
 * 与 `backend/studio/lyric_parser.py` 中 `LyricParser.match_sentence` 保持严格同构，
 * 采用二分查找定位当前句，并处理前奏（Prelude）、纯音乐与尾奏结束状态。
 */

import type { BakedLyricLine, MatchedSentenceResult } from '../types/music'

/**
 * 根据歌曲内部毫秒时间戳查询当前应显示的歌词行。
 *
 * @param lyrics 预烘焙的按时间升序排列的歌词数组
 * @param currentTimeMs 当前在歌曲内部播放到的毫秒数 $t_{\text{song}}$
 * @returns 匹配结果（含当前句、进度、是否处于前奏或已结束）
 */
export function matchSentence(
  lyrics: BakedLyricLine[],
  currentTimeMs: number,
): MatchedSentenceResult {
  // 0. 纯音乐或空歌词兜底 (PRD §6.2.1)
  if (!lyrics || lyrics.length === 0) {
    return {
      index: -1,
      current_line: null,
      line_progress: 0.0,
      is_prelude: true,
      is_ended: false,
    }
  }

  const totalLines = lyrics.length
  const firstLine = lyrics[0]!

  // 1. 第一句歌词之前（前奏 Prelude）
  if (currentTimeMs < firstLine.time_ms) {
    const firstLineTime = firstLine.time_ms
    const preludeProgress = Math.min(
      1.0,
      Math.max(0.0, currentTimeMs / Math.max(1, firstLineTime)),
    )
    return {
      index: -1,
      current_line: {
        index: -1,
        time_ms: 0,
        duration_ms: firstLineTime,
        text: '♪',
        translation: '',
        romaji: '',
        line_progress: preludeProgress,
      },
      line_progress: preludeProgress,
      is_prelude: true,
      is_ended: false,
    }
  }

  // 2. 二分查找满足 lyrics[i].time_ms <= currentTimeMs 的最大索引 activeIdx
  let activeIdx = 0
  let low = 0
  let high = totalLines - 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (lyrics[mid]!.time_ms <= currentTimeMs) {
      activeIdx = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const currentItem = lyrics[activeIdx]!
  const elapsedInLine = currentTimeMs - currentItem.time_ms
  const lineProgress = Math.min(
    1.0,
    Math.max(0.0, elapsedInLine / Math.max(1, currentItem.duration_ms)),
  )
  const isEnded =
    activeIdx === totalLines - 1 && elapsedInLine > currentItem.duration_ms

  return {
    index: activeIdx,
    current_line: {
      ...currentItem,
      index: activeIdx,
      line_progress: lineProgress,
    },
    line_progress: lineProgress,
    is_prelude: false,
    is_ended: isEnded,
  }
}
