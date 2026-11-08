"""制片厂音乐预烘焙与环境能力查询 HTTP 路由。

实现 ARCHITECTURE §6.4 定义的 5 个接口：
- ``GET  /api/studio/music/capabilities``
- ``GET  /api/studio/music/smtc``
- ``POST /api/studio/music/search``
- ``POST /api/studio/music/bake``
- ``GET  /api/studio/music/<ref>``
"""

from __future__ import annotations

from flask import jsonify, request

from . import studio_bp
from .lyric_baker import LyricBaker
from .smtc_helper import get_current_playing_track, is_smtc_supported


@studio_bp.route("/music/capabilities", methods=["GET"])
def get_music_capabilities():
    """查询当前系统 SMTC 可用性与本地已烘焙曲库列表。"""
    return jsonify(
        {
            "smtc_available": is_smtc_supported(),
            "tracks": LyricBaker.list_baked_tracks(),
        }
    )


@studio_bp.route("/music/smtc", methods=["GET"])
def get_smtc_now_playing():
    """读取桌面播放器当前正在播放的曲目信息。"""
    info = get_current_playing_track()
    return jsonify(info)


@studio_bp.route("/music/search", methods=["POST"])
def search_music_candidates():
    """按关键词搜索网易云音乐，返回候选列表供用户手动挑选。"""
    body = request.get_json(silent=True) or {}
    query = str(body.get("query") or "").strip()
    limit = int(body.get("limit") or 8)

    if not query:
        return jsonify({"error": "搜索关键词 query 不能为空", "candidates": []}), 400

    try:
        candidates = LyricBaker.search_songs(query=query, limit=limit)
        return jsonify({"candidates": candidates})
    except Exception as exc:
        return (
            jsonify(
                {
                    "error": f"网易云搜索接口请求失败: {exc}",
                    "candidates": [],
                }
            ),
            502,
        )


@studio_bp.route("/music/bake", methods=["POST"])
def bake_music_by_id():
    """按确定的网易云歌曲 ID 抓取双语歌词并写入 ``studio/music/<ref>.json``。"""
    body = request.get_json(silent=True) or {}
    raw_song_id = body.get("song_id")
    custom_ref = body.get("ref")
    overwrite = bool(body.get("overwrite", False))

    try:
        song_id = int(raw_song_id)
        if song_id <= 0:
            raise ValueError("song_id must be positive")
    except (TypeError, ValueError):
        return jsonify({"error": "必须提供合法的正整数 song_id"}), 400

    try:
        result = LyricBaker.bake_song_to_disk(
            song_id=song_id,
            custom_ref=str(custom_ref) if custom_ref else None,
            overwrite=overwrite,
        )
        if result["status"] == "exists":
            return jsonify(result), 409
        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": f"歌词烘焙失败: {exc}"}), 502


@studio_bp.route("/music/<string:ref>", methods=["GET"])
def get_baked_music_detail(ref: str):
    """读取指定已烘焙歌曲的完整 JSON 数据供前端预览。"""
    data = LyricBaker.read_baked_track(ref)
    if data is None:
        return jsonify({"error": f"未找到已烘焙曲目 '{ref}'"}), 404
    return jsonify(data)
