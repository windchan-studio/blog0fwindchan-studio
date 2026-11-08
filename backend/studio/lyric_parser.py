"""LRC 歌词解析、双语/罗马音合并与时间戳匹配引擎。

仅依赖 Python 标准库，负责将网易云音乐返回的原文歌词（lrc）、
中文译文（tlyric）与罗马音（romalrc）解析并合并为标准时间轴结构，
并提供与前端 TS 版严格等价的 ``match_sentence`` 二分查找实现。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


# 匹配标准 LRC 时间标签，如 [01:23.45] 或 [01:23.456] 或 [01:23:45]
_TIME_TAG_PATTERN = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")


@dataclass
class LyricLine:
    """单行解析后的歌词结构。

    Attributes:
        time_ms: 该句起始毫秒时间戳。
        duration_ms: 该句持续毫秒数。
        text: 原文歌词文本。
        translation: 中文译文文本（无译文时为空字符串）。
        romaji: 罗马音文本（无罗马音时为空字符串）。
    """

    time_ms: int
    duration_ms: int
    text: str
    translation: str = ""
    romaji: str = ""

    def to_dict(self) -> dict[str, Any]:
        """转换为可 JSON 序列化的字典结构。

        Returns:
            与 ``music.schema.json`` 对齐的单句歌词字典。
        """
        return {
            "time_ms": int(self.time_ms),
            "duration_ms": int(self.duration_ms),
            "text": self.text,
            "translation": self.translation,
            "romaji": self.romaji,
        }


class LyricParser:
    """LRC 歌词解析与句子匹配器。"""

    @staticmethod
    def parse_lrc_to_map(raw_lrc: str | None) -> dict[int, str]:
        """将原始 LRC 文本解析为 ``{毫秒时间戳: 歌词文本}`` 映射字典。

        支持同行多个时间标签（如副歌复用 ``[00:12.00][01:12.00]歌词``）。
        过滤空文本行与网易云 JSON 头部元数据行。

        Args:
            raw_lrc: 原始 LRC 格式字符串。

        Returns:
            按时间戳升序排列的 ``{time_ms: text}`` 字典。
        """
        if not raw_lrc or not isinstance(raw_lrc, str):
            return {}

        time_map: dict[int, str] = {}
        for raw_line in raw_lrc.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("{"):
                continue

            matches = list(_TIME_TAG_PATTERN.finditer(line))
            if not matches:
                continue

            content = _TIME_TAG_PATTERN.sub("", line).strip()
            if not content:
                continue

            for m in matches:
                minutes = int(m.group(1))
                seconds = int(m.group(2))
                frac_str = m.group(3) or "0"
                if len(frac_str) == 1:
                    millis = int(frac_str) * 100
                elif len(frac_str) == 2:
                    millis = int(frac_str) * 10
                else:
                    millis = int(frac_str[:3])

                total_ms = minutes * 60_000 + seconds * 1_000 + millis
                time_map[total_ms] = content

        return dict(sorted(time_map.items(), key=lambda item: item[0]))

    @classmethod
    def parse_full_lyrics(
        cls,
        raw_lrc: str | None,
        raw_tlyric: str | None = None,
        raw_romaji: str | None = None,
        song_duration_ms: int = 0,
        tolerance_ms: int = 80,
    ) -> dict[str, Any]:
        """解析并合并原文、译文与罗马音，计算每句持续时长。

        当译文或罗马音的时间戳与原文存在微小偏差（在 ``tolerance_ms`` 以内）时，
        自动吸附到最近的原文时间戳。

        Args:
            raw_lrc: 原文 LRC 字符串。
            raw_tlyric: 译文 LRC 字符串。
            raw_romaji: 罗马音 LRC 字符串。
            song_duration_ms: 歌曲总时长（毫秒），用于计算最后一句的持续时长。
            tolerance_ms: 译文/罗马音时间戳对齐容差（毫秒）。

        Returns:
            包含 ``has_translation``、``has_romaji`` 与 ``lines`` 列表的字典。
        """
        orig_map = cls.parse_lrc_to_map(raw_lrc)
        if not orig_map:
            return {
                "has_translation": False,
                "has_romaji": False,
                "lines": [],
            }

        trans_map = cls.parse_lrc_to_map(raw_tlyric)
        roma_map = cls.parse_lrc_to_map(raw_romaji)

        sorted_times = sorted(orig_map.keys())
        lines: list[LyricLine] = []
        has_translation = False
        has_romaji = False

        def _find_aligned_text(
            target_ms: int, candidate_map: dict[int, str]
        ) -> str:
            if not candidate_map:
                return ""
            if target_ms in candidate_map:
                return candidate_map[target_ms]
            best_key = None
            best_diff = tolerance_ms + 1
            for k in candidate_map:
                diff = abs(k - target_ms)
                if diff <= tolerance_ms and diff < best_diff:
                    best_diff = diff
                    best_key = k
            return candidate_map[best_key] if best_key is not None else ""

        for idx, t_ms in enumerate(sorted_times):
            if idx + 1 < len(sorted_times):
                next_t_ms = sorted_times[idx + 1]
                duration_ms = max(200, next_t_ms - t_ms)
            else:
                if song_duration_ms and song_duration_ms > t_ms:
                    duration_ms = max(500, song_duration_ms - t_ms)
                else:
                    duration_ms = 5000

            trans_text = _find_aligned_text(t_ms, trans_map)
            roma_text = _find_aligned_text(t_ms, roma_map)

            if trans_text:
                has_translation = True
            if roma_text:
                has_romaji = True

            lines.append(
                LyricLine(
                    time_ms=t_ms,
                    duration_ms=duration_ms,
                    text=orig_map[t_ms],
                    translation=trans_text,
                    romaji=roma_text,
                )
            )

        return {
            "has_translation": has_translation,
            "has_romaji": has_romaji,
            "lines": [ln.to_dict() for ln in lines],
        }

    @staticmethod
    def match_sentence(
        lyrics: list[dict[str, Any]], current_time_ms: float
    ) -> dict[str, Any]:
        """根据歌曲内部毫秒时间戳二分查找当前应显示的歌词行。

        与前端 ``frontend/src/studio/engine/lyricMatcher.ts`` 的 ``matchSentence`` 严格同构。

        Args:
            lyrics: 按 ``time_ms`` 升序排列的歌词字典列表。
            current_time_ms: 当前歌曲内部播放到的毫秒数。

        Returns:
            包含 ``index``、``current_line``、``line_progress``、``is_prelude``、``is_ended`` 的字典。
        """
        if not lyrics:
            return {
                "index": -1,
                "current_line": None,
                "line_progress": 0.0,
                "is_prelude": True,
                "is_ended": False,
            }

        total_lines = len(lyrics)
        first_line = lyrics[0]

        # 1. 第一句歌词之前（前奏 Prelude）
        if current_time_ms < first_line["time_ms"]:
            first_line_time = first_line["time_ms"]
            prelude_progress = min(
                1.0, max(0.0, current_time_ms / max(1, first_line_time))
            )
            return {
                "index": -1,
                "current_line": {
                    "index": -1,
                    "time_ms": 0,
                    "duration_ms": first_line_time,
                    "text": "♪",
                    "translation": "",
                    "romaji": "",
                    "line_progress": prelude_progress,
                },
                "line_progress": prelude_progress,
                "is_prelude": True,
                "is_ended": False,
            }

        # 2. 二分查找满足 lyrics[i]["time_ms"] <= current_time_ms 的最大索引
        active_idx = 0
        low = 0
        high = total_lines - 1
        while low <= high:
            mid = (low + high) // 2
            if lyrics[mid]["time_ms"] <= current_time_ms:
                active_idx = mid
                low = mid + 1
            else:
                high = mid - 1

        current_item = lyrics[active_idx]
        elapsed_in_line = current_time_ms - current_item["time_ms"]
        line_progress = min(
            1.0,
            max(0.0, elapsed_in_line / max(1, current_item["duration_ms"])),
        )
        is_ended = (
            active_idx == total_lines - 1
            and elapsed_in_line > current_item["duration_ms"]
        )

        return {
            "index": active_idx,
            "current_line": {
                **current_item,
                "index": active_idx,
                "line_progress": line_progress,
            },
            "line_progress": line_progress,
            "is_prelude": False,
            "is_ended": is_ended,
        }
