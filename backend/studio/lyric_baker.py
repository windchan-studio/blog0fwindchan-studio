"""网易云音乐搜歌、单曲元数据获取、双语歌词抓取与本地 JSON 预烘焙服务。

基于 ``requests.Session`` 同步实现（ARCHITECTURE §6.1），将抓取到的双语歌词与
元数据写入仓库根目录下的 ``studio/music/<ref>.json``。
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from .lyric_parser import LyricParser

# 定位仓库根目录下的 studio/music 文件夹
STUDIO_MUSIC_DIR = Path(__file__).resolve().parents[2] / "studio" / "music"

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://music.163.com/",
    "Origin": "https://music.163.com",
}

_SAFE_REF_PATTERN = re.compile(r"[^a-zA-Z0-9_-]+")


def _get_requests_session():
    """延迟导入并创建配置好请求头的 ``requests.Session``。"""
    import requests  # type: ignore[import-untyped]

    session = requests.Session()
    session.headers.update(_DEFAULT_HEADERS)
    return session


def normalize_music_ref(raw_ref: str | None, song_id: int) -> str:
    """将自定义引用名规范化为安全文件名，未提供时默认返回 ``ncm-<song_id>``。

    Args:
        raw_ref: 用户指定的自定义引用名。
        song_id: 网易云歌曲数字 ID。

    Returns:
        不含路径分隔符的安全文件基名。
    """
    if raw_ref and raw_ref.strip():
        cleaned = _SAFE_REF_PATTERN.sub("-", raw_ref.strip()).strip("-")
        if cleaned:
            return cleaned.lower()
    return f"ncm-{int(song_id)}"


class LyricBaker:
    """网易云音乐搜索与歌词离线烘焙器。"""

    @staticmethod
    def list_baked_tracks() -> list[dict[str, Any]]:
        """扫描 ``studio/music/*.json`` 返回已烘焙曲库摘要列表。

        Returns:
            按文件名排序的已烘焙曲目摘要字典列表。
        """
        if not STUDIO_MUSIC_DIR.exists():
            return []

        summaries: list[dict[str, Any]] = []
        for file_path in sorted(STUDIO_MUSIC_DIR.glob("*.json")):
            try:
                data = json.loads(file_path.read_text(encoding="utf-8"))
                meta = data.get("meta") or {}
                lyrics = data.get("lyrics") or {}
                summaries.append(
                    {
                        "id": data.get("id") or file_path.stem,
                        "title": meta.get("title", file_path.stem),
                        "artist": meta.get("artist", ""),
                        "album": meta.get("album", ""),
                        "duration_ms": int(meta.get("duration_ms", 0)),
                        "has_translation": bool(
                            lyrics.get("has_translation", False)
                        ),
                        "line_count": len(lyrics.get("lines") or []),
                    }
                )
            except Exception:
                continue

        return summaries

    @staticmethod
    def read_baked_track(ref: str) -> dict[str, Any] | None:
        """读取指定 ``ref`` 的完整烘焙 JSON 内容。

        Args:
            ref: 烘焙曲目 ID（不含 ``.json`` 后缀）。

        Returns:
            烘焙数据字典；若文件不存在或越界则返回 ``None``。
        """
        safe_name = Path(ref).name
        target = (STUDIO_MUSIC_DIR / f"{safe_name}.json").resolve()
        if STUDIO_MUSIC_DIR.resolve() not in target.parents or not target.is_file():
            return None
        return json.loads(target.read_text(encoding="utf-8"))

    @staticmethod
    def search_songs(query: str, limit: int = 8) -> list[dict[str, Any]]:
        """按关键词调用网易云搜索接口，返回候选曲目列表供用户挑选。

        Args:
            query: 搜索关键词（歌名 / 歌手）。
            limit: 返回的最大候选数量，默认 8。

        Returns:
            候选歌曲列表，每项包含 ``song_id``、``title``、``artist``、``album``、``duration_ms``。
        """
        if not query or not query.strip():
            return []

        session = _get_requests_session()
        resp = session.post(
            "https://music.163.com/api/search/get/web",
            data={
                "s": query.strip(),
                "type": 1,
                "offset": 0,
                "total": "true",
                "limit": max(1, min(20, int(limit))),
            },
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()
        songs = (payload.get("result") or {}).get("songs") or []

        candidates: list[dict[str, Any]] = []
        for s in songs:
            song_id = s.get("id")
            if not song_id:
                continue
            artists = s.get("artists") or s.get("ar") or []
            artist_names = " / ".join(
                a.get("name", "") for a in artists if a.get("name")
            )
            album_obj = s.get("album") or s.get("al") or {}
            duration_ms = int(s.get("duration") or s.get("dt") or 0)

            candidates.append(
                {
                    "song_id": int(song_id),
                    "title": s.get("name", ""),
                    "artist": artist_names,
                    "album": album_obj.get("name", ""),
                    "duration_ms": duration_ms,
                }
            )

        return candidates

    @staticmethod
    def fetch_song_detail(song_id: int) -> dict[str, Any]:
        """按网易云数字歌曲 ID 查询单曲详情（歌名、歌手、专辑、时长）。

        Args:
            song_id: 网易云歌曲数字 ID。

        Returns:
            包含 ``title``、``artist``、``album``、``duration_ms`` 的元数据字典。
        """
        session = _get_requests_session()
        resp = session.get(
            "https://music.163.com/api/song/detail/",
            params={"id": int(song_id), "ids": f"[{int(song_id)}]"},
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()
        songs = payload.get("songs") or []
        if not songs:
            return {
                "title": f"Track {song_id}",
                "artist": "Unknown",
                "album": "",
                "duration_ms": 0,
            }

        s = songs[0]
        artists = s.get("artists") or s.get("ar") or []
        artist_names = " / ".join(
            a.get("name", "") for a in artists if a.get("name")
        )
        album_obj = s.get("album") or s.get("al") or {}
        duration_ms = int(s.get("duration") or s.get("dt") or 0)

        return {
            "title": s.get("name") or f"Track {song_id}",
            "artist": artist_names or "Unknown",
            "album": album_obj.get("name", ""),
            "duration_ms": duration_ms,
        }

    @staticmethod
    def fetch_raw_lyrics(song_id: int) -> dict[str, str]:
        """按网易云歌曲 ID 拉取原始 LRC、译文与罗马音字符串。

        Args:
            song_id: 网易云歌曲数字 ID。

        Returns:
            包含 ``lrc``、``tlyric``、``romalrc`` 原始字符串的字典。
        """
        session = _get_requests_session()
        resp = session.get(
            "https://music.163.com/api/song/lyric",
            params={
                "id": int(song_id),
                "lv": -1,
                "kv": -1,
                "tv": -1,
                "rv": -1,
            },
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()

        return {
            "lrc": ((payload.get("lrc") or {}).get("lyric")) or "",
            "tlyric": ((payload.get("tlyric") or {}).get("lyric")) or "",
            "romalrc": ((payload.get("romalrc") or {}).get("lyric")) or "",
        }

    @classmethod
    def bake_song_to_disk(
        cls,
        song_id: int,
        custom_ref: str | None = None,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        """执行完整烘焙管线：拉取详情 → 拉取双语歌词 → 解析合并 → 写入 ``studio/music/<ref>.json``。

        Args:
            song_id: 网易云歌曲数字 ID。
            custom_ref: 可选自定义文件基名（缺省为 ``ncm-<song_id>``）。
            overwrite: 若同名文件已存在，是否允许覆盖。

        Returns:
            结果字典：
            - 若文件已存在且 ``overwrite=False``，返回 ``{"status": "exists", "ref": ref, "existing_meta": ...}``；
            - 若烘焙成功，返回 ``{"status": "baked", "ref": ref, "data": bake_json}``。
        """
        ref = normalize_music_ref(custom_ref, song_id)
        STUDIO_MUSIC_DIR.mkdir(parents=True, exist_ok=True)
        target_path = STUDIO_MUSIC_DIR / f"{ref}.json"

        if target_path.exists() and not overwrite:
            existing = cls.read_baked_track(ref) or {}
            return {
                "status": "exists",
                "ref": ref,
                "existing_meta": existing.get("meta") or {},
            }

        meta = cls.fetch_song_detail(song_id)
        raw_lyrics = cls.fetch_raw_lyrics(song_id)
        parsed_lyrics = LyricParser.parse_full_lyrics(
            raw_lrc=raw_lyrics["lrc"],
            raw_tlyric=raw_lyrics["tlyric"],
            raw_romaji=raw_lyrics["romalrc"],
            song_duration_ms=meta["duration_ms"],
        )

        # यदि歌曲详情未返回 duration_ms 但有歌词行，用末行时间兜底
        if meta["duration_ms"] <= 0 and parsed_lyrics["lines"]:
            last_ln = parsed_lyrics["lines"][-1]
            meta["duration_ms"] = int(
                last_ln["time_ms"] + last_ln["duration_ms"]
            )

        tz_shanghai = timezone(timedelta(hours=8))
        baked_doc: dict[str, Any] = {
            "$schema": "../schema/music.schema.json",
            "version": 1,
            "id": ref,
            "baked_at": datetime.now(tz_shanghai).isoformat(timespec="seconds"),
            "source": {
                "provider": "netease",
                "song_id": int(song_id),
            },
            "meta": meta,
            "lyrics": parsed_lyrics,
        }

        target_path.write_text(
            json.dumps(baked_doc, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        return {
            "status": "baked",
            "ref": ref,
            "data": baked_doc,
        }
