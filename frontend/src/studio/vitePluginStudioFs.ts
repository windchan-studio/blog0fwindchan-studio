import { type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 创建 `/__studio_fs/` 静态文件读取中间件。
 *
 * 剥离 URL query 参数并校验目标路径必须位于 `studioRoot` 内部，防止路径穿越。
 *
 * @param studioRoot 仓库根目录下 `studio/` 的绝对路径
 * @returns Connect 兼容的中间件函数
 */
function createStudioFsMiddleware(studioRoot: string) {
  const normalizedRoot = path.resolve(studioRoot)

  return (
    req: { url?: string },
    res: {
      statusCode: number
      setHeader: (name: string, value: string) => void
      end: (body?: string) => void
    },
    next: () => void,
  ) => {
    if (!req.url || !req.url.startsWith('/__studio_fs/')) {
      next()
      return
    }

    const pathname = req.url.split('?')[0] ?? ''
    const relativePath = decodeURIComponent(pathname.slice('/__studio_fs/'.length))
    const resolvedPath = path.resolve(normalizedRoot, relativePath)

    // 防止 ../ 路径穿越到 studio/ 目录之外
    if (
      !resolvedPath.startsWith(normalizedRoot + path.sep) &&
      resolvedPath !== normalizedRoot
    ) {
      res.statusCode = 403
      res.end('Forbidden')
      return
    }

    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(fs.readFileSync(resolvedPath, 'utf-8'))
    } else {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'File not found in studio/', path: relativePath }))
    }
  }
}

/**
 * 风风博客制片厂本地资源挂载与热重载插件。
 *
 * 将项目根目录下的 `studio/` 文件夹映射为开发/预览服务器的 `/__studio_fs/` 路由，
 * 并在开发模式下监听剧本与烘焙音乐 JSON 的变更以推送热重载事件。
 *
 * @returns Vite 插件实例
 */
export function studioFsPlugin(): Plugin {
  const projectRoot = path.resolve(fileURLToPath(import.meta.url), '../../..')
  const studioRoot = path.join(projectRoot, 'studio')

  return {
    name: 'vite-plugin-studio-fs',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(createStudioFsMiddleware(studioRoot))

      // 监听 studio/ 目录加入 watcher，支持剧本与音乐文件保存时原地热重载 (PRD F10)
      if (fs.existsSync(studioRoot)) {
        server.watcher.add(studioRoot)
      }

      server.watcher.on('change', (file) => {
        const resolvedFile = path.resolve(file)
        if (
          resolvedFile.startsWith(studioRoot + path.sep) &&
          resolvedFile.endsWith('.json')
        ) {
          server.ws.send({
            type: 'custom',
            event: 'studio:script-update',
            data: {
              file: path.relative(studioRoot, resolvedFile).replace(/\\/g, '/'),
            },
          })
        }
      })
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(createStudioFsMiddleware(studioRoot))
    },
  }
}
