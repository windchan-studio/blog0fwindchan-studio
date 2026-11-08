"""风风博客·制片厂（Studio）本地扩展后端模块。

暴露 ``studio_bp`` 蓝图（挂载于 ``/api/studio``），包含严格の本机回环地址守卫，
拒绝任何非 localhost 来源的请求（ARCHITECTURE §6.3）。
"""

from __future__ import annotations

from flask import Blueprint, abort, request

from extensions import limiter

studio_bp = Blueprint("studio", __name__)
limiter.exempt(studio_bp)

ALLOWED_LOCAL_IPS = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


@studio_bp.before_request
def restrict_to_localhost() -> None:
    """强制校验请求来源必须为本机回环地址。"""
    remote = request.remote_addr or ""
    if remote not in ALLOWED_LOCAL_IPS:
        abort(403, description="Studio API is restricted to localhost only.")


from . import routes as _routes  # noqa: E402, F401
