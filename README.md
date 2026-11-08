# 🎬 风风博客·制片厂 (blog0fwindchan-studio)

`blog0fwindchan-studio` 是基于 [风风博客 (Blog0fwindchan)](https://github.com/futurelesswindchan/blog0fwindchan) 派生的**本地教学视频制片厂系统**。

本项目在保留原博客全栈架构与 Aero 玻璃拟态视觉体系的基础上，将交互式 Web 页面收敛为关于帧时钟 $t$ 的纯函数状态机：通过编写声明式 JSON 剧本，驱动博客文章页面自动执行滚动、打字机揭示、代码块高亮与复制反馈、目录桌宠双行字幕与教学情绪播报、顶栏预烘焙歌词同步，并最终通过 Playwright 与 FFmpeg 内存管道逐帧渲染为分段无声 MP4 视频素材与时间码清单（`manifest.json`），供后期非线性编辑软件（如 Premiere Pro）对齐配音与背景音乐。

---

## 1. 与 upstream 原仓库的关系

| 维度     | upstream（原仓库）                                                                        | studio（本仓库）                                                                                  |
| :------- | :---------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| 仓库地址 | [futurelesswindchan/blog0fwindchan](https://github.com/futurelesswindchan/blog0fwindchan) | [windchan-studio/blog0fwindchan-studio](https://github.com/windchan-studio/blog0fwindchan-studio) |
| 核心分支 | `main`                                                                                    | `studio`（制片厂开发分支）、`main`（与 upstream 同步）                                            |
| 运行定位 | 公网生产环境个人博客                                                                      | 本地视频渲染工作站，仅在本地回环环境运行，不部署至公网                                            |
| 数据存储 | 生产环境 `blog.db`                                                                        | 本地拍片专用 `blog.db`（文章内容与锚点可按剧本需求自由调整）                                      |
| 合并策略 | —                                                                                         | `upstream → studio` **单向合并**；studio 的代码、配置与资产永不回推 upstream                      |

- **低侵入集成**：制片厂新增逻辑全部收拢于 `studio/`、`frontend/src/studio/`、`frontend/scripts/` 与 `backend/studio/` 目录；对 upstream 既有文件仅保留最小化的插件挂载、条件渲染守卫与主题覆盖钩子，以降低跨仓库合并冲突。
- **问题归属边界**：日常浏览与公网共用的缺陷在 upstream 仓库修复后合并回本仓库；仅服务于视频录制的特性与样式规则留在本仓库 `studio` 分支。

---

## 2. 已实现的核心机制与子系统

### 2.1 纯函数时间线编译与状态推导引擎 (`frontend/src/studio/engine/`)

- **两阶段模型**：剧本加载时由 `TimelineCompiler` 将顺序台词时长（支持手写毫秒数或基于中英文字数的语速公式推算）与动作偏移编译为绝对时间线 `CompiledTimeline`；任意时刻 $t$ 由纯函数 `deriveFrameState(timeline, t)` 在 $O(\log N)$ 时间内直接导出完整画面快照 `StudioFrameState`。
- **帧时钟接管 (`FrameClock`)**：提供全局唯一时间源 `currentTimeMs`，支持实时预览播放、暂停、任意时间点 `seek(t)`、逐帧步进（`±1` 帧）与分段区间循环；每次 `seek(t)` 均等待 Vue DOM 更新与双层 `requestAnimationFrame` 光栅化完成，确保离线截帧的确定性。
- **确定性背景与动效**：冻结演播室模式下非受控的 CSS `transition`，所有过渡进度（气泡入退场、目录抽屉展开、歌词渐变、情绪动效）均由 $t$ 的数学插值直接绑定为行内样式；背景粒子层（`ParticleLayer`）由基于剧本 ID 的固定种子伪随机数生成器（`mulberry32`）与周期折叠公式驱动。
- **三层剧本校验 (`ScriptValidator`)**：
  - **L1（静态结构）**：校验 JSON 结构、必填项、枚举值与定位器语法，输出精确字段路径（如 `segments[1].lines[2].mood`）；
  - **L2（时间线语义）**：检测 `scroll` 区间重叠、跨句动作提示、`bottom-right` Toast 遮挡警告与预烘焙音乐文件存在性；
  - **L3（运行时 DOM）**：基于真实渲染后的文章 DOM 校验标题与章节内局部第 $N$ 个代码块（`resolveLocator`）是否存在、26px 字幕是否超过 2 行上限，以及高亮目标是否与右下角字幕框发生视口重叠。

### 2.2 演播室舞台与专用 UI 组件 (`frontend/src/studio/components/` & `bridge/`)

- **零侵入视觉清场 (`studioStage.css`)**：URL 携带 `?studio=<剧本id>` 时在 `<html>` 挂载 `data-studio-mode="true"`，隐藏侧边导航栏、顶栏非歌词元素、返回按钮、文章元信息行、篇尾导航与滚动指示器，并对主舞台施加 `zoom` 缩放（默认 `1.1`）与鼠标交互冻结。
- **演播室字幕与步骤条 (`StudioTocPet.vue`)**：固定于成片右下角（`640px` 宽、`26px` 字号、最多 2 行），支持 `**加粗**` 与 `` `行内代码` `` 安全渲染；内置 10 种情绪配色与帧时钟驱动动效（含新增教学情绪 `warning`、`cheer`、`thinking`、`proud`、`success`）、400ms 贝塞尔目录折叠抽屉及底部 `segment` 级教学步骤进度条。
- **顶栏单行歌词条 (`StudioLyricBar.vue`)**：内置与 Python 端严格同构的 TS 版 `matchSentence` 二分匹配器，支持多曲目歌单顺序连播、歌间交叉渐变（`crossfadeMs`）、前奏/间奏 `♪` 呼吸动画，以及歌单结束 15 秒后自动淡入片尾结束语（`outro`）。
- **状态隔离与系统通知拦截 (`studioPiniaPlugin.ts`)**：
  - 拦截演播室期间所有经由 `useToastStore.add()` 触发的博客自发通知，转入导演控制栏消息队列，画面内仅由 `StudioToastLayer.vue` 渲染剧本定时 Toast 与每首歌起点的自动署名 Toast（`♪ 歌名 - 歌手`）；
  - 备份并重置 `useSettingsStore` 为演播室标准参数，屏蔽 `localStorage` 落盘与跨标签页 `storage` 事件干扰；通过 `setStudioThemeOverride` 接管全局亮暗主题切换。

### 2.3 音乐预烘焙后端与导演预览控制栏 (`backend/studio/` & `DirectorBar.vue`)

- **本地音乐烘焙接口 (`/api/studio/music/*`)**：通过 Flask Blueprint 挂载并强制校验本机回环 IP（`127.0.0.1` / `::1`）访问且豁免全局限流；使用 `requests` 同步抓取网易云歌曲详情与原文/译文/罗马音歌词，经 `LyricParser` 合并计算行时长后写入 `studio/music/<ref>.json`，确保预览与渲染阶段零外部网络请求。
- **SMTC 三层降级识别 (`smtc_helper.py`)**：支持通过 Windows `winsdk` 读取系统当前播放曲目，未安装 `winsdk` 时自动回退至 Win32 窗口标题扫描，非 Windows 环境下自动隐藏识别入口。
- **导演实时预览控制栏 (`DirectorBar.vue` & `MusicBakePanel.vue`)**：仅在 URL 附加 `&director=1` 时激活（离线渲染天然不入画）。提供分段色块、台词刻度（含校验错误标红与悬停详情）、播放头拖拽、快捷键控制（`Space`、`←/→`、`Shift+←/→`、`[/]`、`1~9`、`L`、`H`）、被拦截系统消息查看器、可视化音乐烘焙面板，以及基于 Vite WebSocket 的剧本保存原地热重载。

### 2.4 分段离线渲染管线 (`frontend/scripts/studio-render.mjs`)

- **内存管道直通编码**：通过 Playwright Chromium Headless 加载目标文章演播室页面，按帧调用 `window.__studio.seek(t)` 并将截图 PNG Buffer 经由 `image2pipe` 直通写入 FFmpeg `stdin` 编码输出 `<序号>-<分段id>.mp4`，全程不产生磁盘临时图片文件。
- **按段重渲与增量跳过**：支持 `--segment <id1,id2>` 仅渲染指定分段，或通过 `--incremental` 比对分段确定性 SHA-256 哈希（涵盖视频配置、文章正文哈希、分段起始时间、进入分段时的持续状态快照、分段剧本定义与音乐切片）自动跳过未变更分段。
- **渲染清单 (`manifest.json`)**：每次渲染自动输出总帧数、歌单时间线及各分段的起止帧、哈希值与 `music_cues`（精确记录每首歌在分段内的起止毫秒、全片起始毫秒与歌曲内部裁剪毫秒），用于后期音轨对齐。

---

## 3. 目录结构

```plain
blog0fwindchan-studio/
├── STUDIO_GUIDE.md                     # 制片厂完整启动、配置与使用指南
├── docs/studio/
│   ├── PRD.md                          # 产品需求文档 v1.0
│   └── ARCHITECTURE.md                 # 系统架构设计文档 v1.0
├── studio/                             # 制片厂本地资产与数据契约目录
│   ├── studio.config.example.json      # 渲染器与 FFmpeg 配置模板
│   ├── schema/
│   │   ├── script.schema.json          # 剧本 JSON Schema (Draft-07)
│   │   └── music.schema.json           # 预烘焙音乐 JSON Schema (Draft-07)
│   ├── scripts/
│   │   └── example.script.json         # 示例分镜剧本（其余私人剧本已被 .gitignore 忽略）
│   ├── music/
│   │   └── example-song.json           # 示例预烘焙歌词（其余曲库缓存已被 .gitignore 忽略）
│   └── output/                         # 分段 MP4 与 manifest.json 输出目录（被 .gitignore 忽略）
├── backend/
│   ├── requirements-studio.txt         # 制片厂后端专属依赖 (requests, winsdk)
│   └── studio/                         # 音乐预烘焙 Flask 蓝图模块
│       ├── __init__.py                 # 蓝图定义与 localhost 访问守卫
│       ├── routes.py                   # /api/studio/music/* 路由实现
│       ├── lyric_parser.py             # LRC 解析、双语对齐与 match_sentence 算法
│       ├── lyric_baker.py              # 网易云搜歌、抓词与 JSON 落盘服务
│       └── smtc_helper.py              # Windows SMTC / Win32 窗口标题曲目识别
└── frontend/
    ├── scripts/
    │   └── studio-render.mjs           # Playwright -> FFmpeg 分段离线渲染 CLI
    └── src/studio/                     # 演播室前端核心模块
        ├── vitePluginStudioFs.ts       # /__studio_fs/ 静态文件挂载与剧本热重载插件
        ├── types/                      # 剧本、音乐与逐帧状态快照 TS 类型定义
        ├── engine/                     # 帧时钟、编译器、状态推导、定位器、歌词匹配与校验器
        ├── bridge/                     # Pinia 隔离插件、DOM 舞台驱动与 window.__studio 桥接
        ├── stores/useStudioStore.ts    # 演播室状态管理仓
        ├── styles/studioStage.css      # 演播室全局清场与动画冻结样式表
        └── components/                 # StudioRoot / StudioTocPet / StudioLyricBar / DirectorBar 等
```

---

## 4. 文档与快速导航

关于本项目的安装部署、制片工作流与设计规范，请查阅以下专题文档：

| 文档名称                                                                             | 内容概述                                                                                          |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| 📖 [**启动与配置指南 (`STUDIO_GUIDE.md`)**](STUDIO_GUIDE.md)                         | 前后端环境安装、`studio.config.json` 配置、导演控制栏操作、音乐预烘焙、剧本编写与离线渲染完整教程 |
| 🎨 [**产品需求文档 (`docs/studio/PRD.md`)**](docs/studio/PRD.md)                     | 制片厂产品定位、功能分档、剧本与烘焙音乐数据契约、UI/UX 规范与验收标准                            |
| 🏛️ [**系统架构设计 (`docs/studio/ARCHITECTURE.md`)**](docs/studio/ARCHITECTURE.md)   | $\text{Frame}(t)$ 纯函数推导模型、确定性接管矩阵、低侵入集成边界与离线渲染管线设计                |
| 🍃 [**Upstream 博客本体文档**](https://github.com/futurelesswindchan/blog0fwindchan) | 风风博客本体的基础功能、技术栈说明、日常更新维护与许可协议                                        |

---

## 5. 当前工程进度

- [x] 产品定义（PRD v1.0） → [`docs/studio/PRD.md`](docs/studio/PRD.md)
- [x] 系统架构设计（v1.0） → [`docs/studio/ARCHITECTURE.md`](docs/studio/ARCHITECTURE.md)
- [x] 编码实现（M1 数据契约与底座 / M2 纯函数引擎 / M3 演播室舞台与组件 / M4 音乐烘焙后端与导演控制栏 / M5 分段离线渲染管线）
- [x] 启动与配置文档 → [`STUDIO_GUIDE.md`](STUDIO_GUIDE.md)
- [ ] 自动化测试与跨语言对拍验证

---

**Copyright © 2026 没有未来的小风酱 (futurelesswindchan)**
