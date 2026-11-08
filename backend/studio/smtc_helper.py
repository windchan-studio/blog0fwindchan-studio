"""Windows 系统媒体传输控制（SMTC）曲目识别辅助模块。

支持三层优雅降级（ARCHITECTURE §6.2）：
1. 优先尝试 ``winsdk`` 的 ``GlobalSystemMediaTransportControlsSessionManager``；
2. 若在 Windows 上未安装 ``winsdk``，回退至 ``user32`` 枚举桌面窗口标题（匹配网易云音乐 ``歌名 - 歌手``）；
3. 若在非 Windows 平台，``is_smtc_supported()`` 返回 ``False``，前端自动隐藏「识别当前播放」按钮。
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

IS_WINDOWS = sys.platform == "win32"

_HAS_WINSDK = False
if IS_WINDOWS:
    try:
        from winsdk.windows.media.control import (  # type: ignore[import-not-found]
            GlobalSystemMediaTransportControlsSessionManager as SMTCManager,
        )

        _HAS_WINSDK = True
    except ImportError:
        _HAS_WINSDK = False


def is_smtc_supported() -> bool:
    """检查当前运行环境是否支持识别正在播放的桌面音乐。

    Returns:
        在 Windows 平台下返回 ``True``，其他平台返回 ``False``。
    """
    return IS_WINDOWS


async def _query_winsdk_smtc() -> dict[str, Any] | None:
    """通过 ``winsdk`` WinRT 协程读取当前活动媒体会话信息。"""
    if not _HAS_WINSDK:
        return None

    manager = await SMTCManager.request_async()
    session = manager.get_current_session()
    if session is None:
        sessions = manager.get_sessions()
        if sessions and len(sessions) > 0:
            session = sessions[0]

    if session is None:
        return None

    props = await session.try_get_media_properties_async()
    if props is None or not getattr(props, "title", ""):
        return None

    timeline = session.get_timeline_properties()
    duration_ms = 0
    if timeline is not None and getattr(timeline, "end_time", None) is not None:
        duration_ms = int(timeline.end_time.total_seconds() * 1000)

    return {
        "status": "playing",
        "title": (props.title or "").strip(),
        "artist": (props.artist or "").strip(),
        "album": (props.album_title or "").strip(),
        "duration_ms": max(0, duration_ms),
        "source": "winsdk_smtc",
    }


def _query_window_title_fallback() -> dict[str, Any] | None:
    """在未安装 ``winsdk`` 时通过 Win32 API 扫描窗口标题中的 ``歌名 - 歌手``。"""
    if not IS_WINDOWS:
        return None

    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        found_candidates: list[str] = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def enum_proc(hwnd: int, _lparam: int) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length <= 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            # 网易云音乐桌面端常见格式："歌名 - 歌手" 或 "歌名 - 歌手 - 网易云音乐"
            if " - " in title and not any(
                ignore in title
                for ignore in (
                    "Visual Studio",
                    "Google Chrome",
                    "Microsoft Edge",
                    "PowerShell",
                    "文件资源管理器",
                )
            ):
                found_candidates.append(title)
            return True

        user32.EnumWindows(enum_proc, 0)

        for raw_title in found_candidates:
            cleaned = raw_title.replace(" - 网易云音乐", "").strip()
            parts = [p.strip() for p in cleaned.split(" - ") if p.strip()]
            if len(parts) >= 2:
                return {
                    "status": "playing",
                    "title": parts[0],
                    "artist": parts[1],
                    "album": "",
                    "duration_ms": 0,
                    "source": "win32_window_title",
                }
    except Exception:
        return None

    return None


def get_current_playing_track() -> dict[str, Any]:
    """同步获取当前系统正在播放的曲目信息。

    Returns:
        包含 ``status``、``title``、``artist``、``album``、``duration_ms`` 的字典。
    """
    if not IS_WINDOWS:
        return {
            "status": "unsupported",
            "title": "",
            "artist": "",
            "album": "",
            "duration_ms": 0,
            "message": "当前操作系统不支持 SMTC 识别",
        }

    if _HAS_WINSDK:
        try:
            res = asyncio.run(_query_winsdk_smtc())
            if res and res.get("title"):
                return res
        except Exception:
            pass

    fallback = _query_window_title_fallback()
    if fallback and fallback.get("title"):
        return fallback

    return {
        "status": "stopped",
        "title": "",
        "artist": "",
        "album": "",
        "duration_ms": 0,
        "message": "未检测到正在播放的桌面音乐会话",
    }
