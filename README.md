# 🎬 风风博客·制片厂 (blog0fwindchan-studio)

> ⚠️ **本项目正在施工中！** 功能尚未实现，当前仅完成了产品定义（PRD）。

基于 [风风博客 (Blog0fwindchan)](https://github.com/futurelesswindchan/blog0fwindchan) fork 出的**教学视频制片厂底座**。

把博客本身改造成一台「剧本驱动、逐帧可复现」的教学视频制片机！
写一份 JSON 剧本，博客页面就会按帧时钟自动滚动、打字，目录桌宠说台词，顶栏放歌词，最后离线逐帧渲染成分段 MP4。

## 与 upstream 原仓库的关系

|          | upstream（原仓库）                                                                        | studio（本仓库）                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 仓库     | [futurelesswindchan/blog0fwindchan](https://github.com/futurelesswindchan/blog0fwindchan) | [windchan-studio/blog0fwindchan-studio](https://github.com/windchan-studio/blog0fwindchan-studio) |
| 分支     | `main`                                                                                    | `studio`（开发分支）、`main`（与 upstream 同步）                                                  |
| 用途     | 公网生产博客，日常使用                                                                    | 本地制片厂，仅在本地运行，不部署到公网                                                            |
| 数据     | 公网 `blog.db`（线上文章）                                                                | 本地 `blog.db`（拍片专用，可随意修改）                                                            |
| 合并方向 | —                                                                                         | upstream → studio **单向**。studio 的改动**永远不会**回推 upstream                                |

- 本仓库定期从 upstream 合并更新，保持博客本体最新。
- 制片厂的所有新增代码都在 `studio` 分支，尽量放在新增文件和模式开关后面，减少合并冲突。
- 开发中发现的博客本身问题（如性能、字体等），回 upstream 仓库修复，再合并回来。

## 当前进度

- [x] 产品定义（PRD v1.0） → [`docs/studio/PRD.md`](docs/studio/PRD.md)
- [ ] 架构设计
- [ ] 编码实现
- [ ] 测试
- [ ] 文档

## 制片厂新增的核心能力（规划中）

1. **演播室模式**：`?studio=<剧本id>` 进入，画面完全由剧本控制
2. **帧时钟**：全局唯一时间源，保证同一剧本渲染出同一帧
3. **TocPet 字幕**：目录桌宠变身字幕系统，台词、情绪、目录联动全由剧本驱动
4. **顶栏歌词条**：一行原文歌词，支持歌单连播
5. **音乐预烘焙**：从网易云抓取歌词，离线存为 JSON，渲染时零网络请求
6. **导演预览控制栏**：时间轴拖拽、逐帧步进、分段循环
7. **分段离线渲染**：Playwright 逐帧截图 + FFmpeg 编码输出 MP4

## 本地开发

博客本体的启动方式与 upstream 完全一致，请参考 [upstream 的 README](https://github.com/futurelesswindchan/blog0fwindchan#-启动本地开发小冒险)。

制片厂功能尚在开发中，启动方式待补充。

---

> 关于风风博客本身的介绍、技术栈、部署教程、使用许可等，请参阅 [upstream 仓库的 README](https://github.com/futurelesswindchan/blog0fwindchan)。

**Copyright © 2026 没有未来的小风酱 (futurelesswindchan)**
