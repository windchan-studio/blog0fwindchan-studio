# 《风风博客·制片厂》启动与配置指南

本文档说明如何在本地环境安装、配置、启动并使用 `blog0fwindchan-studio` 的演播室预览、音乐预烘焙、JSON 剧本编写与分段 MP4 离线渲染管线。

---

## 1. 环境前置要求

在启动制片厂前，系统需具备以下基础软件环境：

| 组件                   | 版本要求  | 用途说明                                                                   |
| :--------------------- | :-------- | :------------------------------------------------------------------------- |
| **Node.js**            | `v18.0+`  | 运行 Vite 前端开发服务器与分段离线渲染脚本（推荐 `v20+` 或 `v22+`）        |
| **Python**             | `3.10+`   | 运行 Flask 后端与 `/api/studio` 本地音乐预烘焙服务                         |
| **FFmpeg**             | `5.0+`    | 接收渲染管线的 `image2pipe` PNG 帧流并编码输出 H.264 `.mp4` 视频           |
| **Playwright Chromium**| 自动匹配  | 执行 1920×1080 离屏逐帧确定性截图                                          |

> **FFmpeg 可用性检查**：在终端执行 `ffmpeg -version`。若未加入系统 `PATH`，可在后续的 `studio/studio.config.json` 中显式配置 `ffmpegPath` 绝对路径。

---

## 2. 后端启动与制片厂依赖配置

制片厂后端在原博客后端（`backend/requirements.txt`）的基础上，通过独立的 `backend/requirements-studio.txt` 引入音乐预烘焙所需的依赖，保持与 upstream 依赖文件零冲突。

### 2.1 创建虚拟环境并安装依赖

在项目根目录下打开终端，进入 `backend/` 目录：

```powershell
cd backend

# 1. 创建并激活 Python 虚拟环境（Windows PowerShell）
python -m venv venv
.\venv\Scripts\activate

# （若为 Linux / macOS）
# python3 -m venv venv && source venv/bin/activate

# 2. 安装博客本体依赖
pip install -r requirements.txt

# 3. 安装制片厂专属扩展依赖（requests 与 Windows SMTC 支持）
pip install -r requirements-studio.txt
```

> **关于 `winsdk` 的降级说明**：
> - `requirements-studio.txt` 中的 `winsdk` 仅在 `sys_platform == "win32"` 时自动安装，用于一键识别 Windows 系统正在播放的桌面音乐（SMTC）。
> - 若在 Windows 上未安装 `winsdk`，后端会自动回退至 Win32 窗口标题扫描；若在 macOS / Linux 上运行，SMTC 能力会自动标记为不可用，导演控制栏会自动隐藏「🎧 识别当前播放」按钮，按歌曲 ID 或歌名搜索烘焙不受影响。

### 2.2 配置环境变量与本地拍片数据库

若首次克隆仓库，请在 `backend/` 目录下创建 `.env` 文件：

```ini
FLASK_DEBUG=True
JWT_SECRET_KEY=studio-local-secret-key-for-development-only-32chars
CORS_ORIGINS=http://localhost:5173
```

初始化本地数据库并导入示例文章（含示例剧本所用的 `how-to-customize-blog` 文章）：

```powershell
# 初始化数据表
flask db init

# 导入内置示例文章与分类数据（仅限首次初始化本地拍片库时执行）
python init_db.py
```

### 2.3 启动后端服务

```powershell
python app.py
```

当终端输出 `Running on http://127.0.0.1:5000` 时，博客 API 与制片厂本地扩展路由（`/api/studio/*`，仅允许本机回环地址 `127.0.0.1` / `::1` 访问）均已就绪。

---

## 3. 前端启动与 Playwright 浏览器准备

保持后端终端运行，另开一个终端进入 `frontend/` 目录：

```powershell
cd frontend

# 1. 安装前端依赖
npm install

# 2. （首次使用离线渲染前）确保已安装 Playwright Chromium 浏览器内核
npx playwright install chromium

# 3. 启动 Vite 本地开发服务器（默认监听 http://localhost:5173）
npm run dev
```

Vite 启动时会自动加载 `vite-plugin-studio-fs` 插件：
- 将仓库根目录下的 `studio/` 映射为 `/__studio_fs/*` 静态只读路由；
- 监听 `studio/scripts/*.json` 与 `studio/music/*.json` 的文件保存事件，通过 WebSocket 向浏览器推送原地热重载通知。

---

## 4. 制片厂全局配置文件 (`studio/studio.config.json`)

仓库提供了配置模板 `studio/studio.config.example.json`。如需自定义 FFmpeg 路径或默认硬件编码器，可将其复制为 `studio/studio.config.json`（该文件已被 `.gitignore` 忽略，不会泄露本机路径）：

```powershell
# 在仓库根目录下执行
Copy-Item studio/studio.config.example.json studio/studio.config.json
```

### 字段说明

```json
{
  "ffmpegPath": "ffmpeg",
  "defaultCodec": "libx264",
  "defaultFps": 30,
  "baseUrl": "http://localhost:5173",
  "outputDir": "studio/output"
}
```

| 字段           | 类型     | 默认值                    | 说明                                                                                                           |
| :------------- | :------- | :------------------------ | :------------------------------------------------------------------------------------------------------------- |
| `ffmpegPath`   | `string` | `"ffmpeg"`                | FFmpeg 可执行文件名或本机绝对路径（如 `"D:/Tools/ffmpeg/bin/ffmpeg.exe"`）                                     |
| `defaultCodec` | `string` | `"libx264"`               | 默认 H.264 编码器，可选：`"libx264"`（CPU 通用）、`"h264_nvenc"`（NVIDIA 独显加速）、`"h264_qsv"`（Intel 核显加速） |
| `defaultFps`   | `number` | `30`                      | 默认输出帧率（当剧本未指定 `video.fps` 时生效），支持 `24` 或 `30`                                             |
| `baseUrl`      | `string` | `"http://localhost:5173"` | 离线渲染时 Playwright 访问的前端基准地址                                                                       |
| `outputDir`    | `string` | `"studio/output"`         | 相对于仓库根目录的渲染产物输出目录                                                                             |

---

## 5. 进入演播室预览与使用导演控制栏

当前后端均处于运行状态时，在任意文章详情页 URL 后附加查询参数即可切换工作模式（以下以内置的 `example` 剧本为例）：

### 5.1 两种访问模式对比

| 模式名称         | 访问 URL 示例                                                                          | 适用场景与画面表现                                                                                     |
| :--------------- | :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **导演预览模式** | `http://localhost:5173/articles/topics/how-to-customize-blog?studio=example&director=1` | 审片、调轴、烘歌。底部挂载半透明导演控制栏，支持时间轴拖拽、快捷键跳段/跳句、校验错误定位与音乐烘焙面板 |
| **纯演播室模式** | `http://localhost:5173/articles/topics/how-to-customize-blog?studio=example`            | 离线渲染实际访问的页面。隐藏一切导航栏、按钮与导演控制栏，画面 100% 对应最终 MP4 成片                  |

### 5.2 导演控制栏快捷键一览

在导演预览模式（`?studio=<id>&director=1`）且焦点不在文本框内时，可使用以下快捷键：

| 按键                  | 功能说明                                                   |
| :-------------------- | :--------------------------------------------------------- |
| `Space`（空格）       | 播放 / 暂停实时预览                                        |
| `←` / `→`             | 向后 / 向前单步微调 `1` 帧                                 |
| `Shift + ←` / `→`     | 向后 / 向前跳转 `1000ms`（1 秒）                           |
| `[` / `]`             | 跳转到上一句 / 下一句台词起点                              |
| 数字键 `1` ~ `9`      | 直接跳转到第 1 ~ 9 个分段（`segment`）起点                 |
| `L`                   | 切换「当前分段内循环播放」（方便反复核对单段台词与动作节奏）|
| `H`                   | 折叠 / 展开底部导演控制栏                                  |

---

## 6. 音乐预烘焙工作流

为保证渲染期间零外部网络请求，顶栏歌词条所需的数据需提前在导演控制栏中预烘焙为本地 JSON：

1. 打开导演预览页，点击底部控制栏右侧的 **「🎵 烘焙」** 按钮，展开音乐预烘焙工坊面板。
2. **添加曲目**：
   - **按歌曲 ID 烘焙**：在输入框内每行填写一个网易云音乐数字 ID（如 `1974443814`），点击「开始烘焙」；
   - **按歌名/歌手搜索**：输入关键词（如 `群青 YOASOBI`），点击「开始烘焙」，面板会列出搜索到的候选列表，**手动点击对应版本右侧的「选这首烤制」**（系统禁止自动盲选第一首，以防歌词版本错位）；
   - **识别当前播放（Windows）**：桌面网易云正在放歌时，点击「🎧 识别当前播放」，系统会自动抓取歌名并列出候选供确认。
3. **复制 `ref` 与预览歌词**：
   - 烘焙完成后，文件保存在 `studio/music/<ref>.json`；
   - 在面板下方的「已烘焙本地曲库」中点击蓝色 `ref` 胶囊即可复制该引用名，将其填入剧本的 `music.tracks[].ref` 字段；
   - 点击「预览」可在面板内滚动检查整首歌的 LRC 时间戳与双语译文。

---

## 7. 编写视频分镜剧本 (`studio/scripts/<id>.script.json`)

在 `studio/scripts/` 下新建 `<你的剧本id>.script.json`。文件头部声明 `"$schema": "../schema/script.schema.json"` 即可在 VS Code 中获得完整的字段补全、悬停说明与语法校验。

### 7.1 最小可用剧本骨架

```json
{
  "$schema": "../schema/script.schema.json",
  "version": 1,
  "id": "my-first-video",
  "title": "我的第一支教程视频",
  "article": {
    "category": "topics",
    "slug": "how-to-customize-blog"
  },
  "video": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "zoom": 1.1,
    "theme": "dark",
    "defaults": {
      "mood": "reading",
      "gapMs": 300
    }
  },
  "music": {
    "tracks": [
      { "ref": "example-song", "startAtMs": 0 }
    ],
    "crossfadeMs": 1500,
    "announce": true,
    "outro": {
      "text": "感谢收看～我们下期再见 awa"
    }
  },
  "segments": [
    {
      "id": "intro",
      "title": "开场",
      "lines": [
        {
          "text": "大家好呀～今天我们一起来制作专属博客 awa",
          "mood": "cheer",
          "actions": [
            { "type": "toc", "expand": true }
          ]
        }
      ]
    }
  ]
}
```

### 7.2 常用定位器（Locator）与动作（Actions）速查

- **定位标题**：`{ "heading": "二、核心装修区：站点配置文件 📝" }`（直接复制 Markdown 标题原文，同名标题可加 `"nth": 2`）。
- **定位标题章节下的第 N 个代码块**：`{ "heading": "2.1 你的站点大名", "codeBlock": 1 }`（只在该标题到下一个同级/更高级标题之间计数，其他章节增删代码不受影响）。
- **支持的情绪（`mood`）**：
  - 教学扩展情绪：`warning`（琥珀色敲黑板加粗）、`cheer`（撒花星星粒子）、`thinking`（前置三点省略号亮起）、`proud`（皇冠浮动 + 高光扫过）、`success`（绿框闪烁 + 步骤打勾）；
  - 基础桌宠情绪：`reading`、`typing`、`sleepy`、`dizzy`、`shocked`。
- **支持的动作（`actions[]`）**：
  - `scroll`：平滑滚动至标题、代码块、`top`、`bottom` 或指定像素；
  - `highlight`：为目标元素叠加 `glow`（蓝光）或 `box`（琥珀框）高亮，默认本句结束自动移除；
  - `copy`：触发目标代码块右上角按钮的 `Copied!` 视觉状态（持续 2 秒，不污染系统剪贴板）；
  - `toc`：展开/收起目录抽屉（`expand: true/false`）或切换高亮节点（`highlight`）；
  - `typewriter`：开启打字机模式并在 `durationMs` 内揭示至目标标题或全文末尾 `"end"`（若全片不写任何 `typewriter` 动作，文章默认从片头即全量显示）；
  - `theme`：在剧本指定时刻切换 `"dark"` / `"light"` 主题；
  - `toast`：在画面右上角投放由帧时钟驱动的定时通知；
  - `wait`：在本句说话结束后附加一段隐藏字幕气泡的纯画面展示时间。

> **实时热重载**：在编辑器中修改并保存 `.script.json` 后，已打开的浏览器预览页会自动重新编译时间线并刷新到当前时刻 $t$，无需手动刷新网页。若存在 Schema 错误或找不到 DOM 定位器，导演控制栏顶部会直接标红报错路径。

---

## 8. 执行分段离线渲染与 PR 后期对齐

当在导演预览模式中确认节奏无误后，保持前端（及后端）运行，在 `frontend/` 目录下执行渲染 CLI：

### 8.1 常用渲染命令

```powershell
cd frontend

# 1. 渲染指定剧本的全部切分段落
npm run studio:render -- --script example

# 2. 仅重渲某一个或几个修改过的分段（其他分段文件保持不变）
npm run studio:render -- --script example --segment fork,config

# 3. 启用增量渲染（自动比对分段 SHA-256 哈希，跳过未改动分段）
npm run studio:render -- --script example --incremental

# 4. 显式指定 NVIDIA NVENC 硬件编码器与帧率
npm run studio:render -- --script example --incremental --codec h264_nvenc --fps 30
```

### 8.2 输出产物与 Premiere Pro 音轨对齐

渲染完成后，产物位于 `studio/output/<剧本id>/`：

- `01-intro.mp4`、`02-fork.mp4`、`03-config.mp4`……：按分段切分的 1920×1080 无声视频素材，可直接按顺序拖入 PR 轨道并录制/对齐各段配音。
- `manifest.json`：渲染清单文件。其中的 `music_timeline` 与每个分段下的 `music_cues` 字段精确记录了每首背景音乐在视频第几毫秒切入（`in_video_start_ms`）、在当前分段第几毫秒开始（`in_segment_start_ms`）以及对应原曲的起始裁剪位置（`in_song_start_ms`）。在 PR 中按该毫秒数放置音频文件，即可让画面顶栏歌词与背景音乐实现帧级同步。
