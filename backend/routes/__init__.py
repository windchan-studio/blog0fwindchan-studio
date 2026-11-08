from flask import Blueprint
from .public import public_bp
from .auth import auth_bp
from .admin import admin_bp
from .assets import assets_bp
from .seo import seo_bp

def register_routes(app):
    """注册所有蓝图"""
    # 基础健康检查
    @app.route("/")
    def hello() -> str:
        return "Hello! Blog Backend is running."

    # 注册蓝图分组
    app.register_blueprint(public_bp, url_prefix='/api')
    app.register_blueprint(auth_bp, url_prefix='/api')
    app.register_blueprint(admin_bp, url_prefix='/api')
    app.register_blueprint(assets_bp, url_prefix='/api')

    # NOTE: SEO 蓝图注册在最后，路径与 SPA 前端路由重合。
    # 爬虫命中时由 Flask 返回 meta HTML；普通浏览器请求由 Nginx 的静态文件服务接管，不会到达此处。
    app.register_blueprint(seo_bp, url_prefix='')

    # Studio 制片厂本地扩展路由（仅 studio 分支存在）
    try:
        from studio import studio_bp
        app.register_blueprint(studio_bp, url_prefix='/api/studio')
    except ImportError as exc:
        app.logger.warning("Studio blueprint skipped: %s", exc)
