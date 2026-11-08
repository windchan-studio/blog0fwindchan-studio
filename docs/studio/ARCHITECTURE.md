# 《风风博客·制片厂》系统架构设计文档 v1.0

> 项目：`blog0fwindchan-studio`（`studio` 分支）
> 上游依赖：`docs/studio/PRD.md` v1.0
> 作者：🏛️ 架构设计 ｜ 日期：2026-11-07 ｜ 状态：**架构设计完成，交接主力开发**

---

## 0. 文档导读与设计目标

本文档承接《产品需求文档（PRD）v1.0》，将产品定义转化为可供主力开发直接落地的工程蓝图，并逐项回应 PRD §10 提出的 11 个架构关注点。

### 0.1 核心架构命题

制片厂的本质是**将一个充满异步副作用的交互式 Web 应用，在演播室模式下收敛为一个关于时间 $t$ 的纯函数**：

$$\text{Frame}(t) = \mathcal{F}(\text{CompiledScript}, \text{ArticleDOM}, t)$$

任意时刻 $t \in [0, T_{\text{total}}]$ 的画面状态*滚动位置、打字机揭示进度、目录展开状态、高亮节点、桌宠情绪与气泡文案、顶栏歌词行、Toast 列表、背景粒子坐标、亮暗主题*均由 $(t, \text{剧本})$ 直接推导得出，不依赖“从 $0$ 播放到 $t$”的历史累积。

### 0.2 PRD §10 关注点索引

| PRD 关注点                | 对应章节   | 核心决策摘要                                                                                                                                                       |
| :------------------------ | :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 帧时钟接管范围         | §3.1, §3.3 | 引入全局 `FrameClock` 单例；演播室模式下冻结 CSS transition/animation，禁用 rAF/Timer 自走逻辑                                                                     |
| #2 可跳转（Seekable）实现 | §4.1, §4.2 | 剧本加载时预编译为绝对时间线 `CompiledTimeline`，任意 $t$ 通过二分查找 + 逆向扫描一步算出全量状态快照 `StudioFrameState`                                           |
| #3 截帧性能               | §7.4       | Phase 1 保正确性；渲染器采用 PNG Image Pipe 直通 FFmpeg `stdin` 省去磁盘 I/O；毛玻璃性能留待 upstream 处理                                                         |
| #4 歌词查询一致性         | §5.2       | 前端 TS 严格复刻 `LyricParser.match_sentence`（二分查找 + 前奏处理），配套跨语言对拍测试夹具                                                                       |
| #5 仓库单向关系与低冲突   | §2         | Studio 代码全部收拢在 `frontend/src/studio/`、`backend/studio/`、`studio/` 三个专属目录；upstream 已有文件仅做“单行守卫/插槽”级微改                                |
| #6 Toast 按来源拦截       | §5.3       | 通过 Pinia 插件拦截 `useToastStore.add()`：演播室模式下默认转入导演控制栏消息队列，仅带 `__studioScript: true` 标记的剧本 Toast 放行上屏                           |
| #7 锚点定位器             | §4.3       | 基于 `articleToc` 标题文本匹配 + DOM 区间扫描定位代码块；无需修改 `useArticleInfo.ts` 的 `slugify`                                                                 |
| #8 烘焙后端衔接与降级     | §6         | 新增 `/api/studio` 蓝图，仅允许本机回环访问；`lyric_fetcher` 改用 `requests` 同步实现（避免在 Flask 内桥接 `aiohttp` 事件循环）；`winsdk` 动态导入，缺失时自动降级 |
| #9 页面缩放 `video.zoom`  | §3.4       | 采用整数视口 `1920×1080` + 根容器 CSS `zoom: 1.1`，规避 `1920 / 1.1` 非整除导致的 1px 截帧误差；预览与渲染完全同构                                                 |
| #10 隔离用户设置与主题    | §5.4       | 演播室启动时通过内存快照覆写 `useSettingsStore`，并屏蔽 `persistGroup` 落盘；接管全局亮暗主题状态                                                                  |
| #11 粒子层确定性          | §3.5       | 使用 `mulberry32` 固定种子伪随机数生成器（PRNG）初始化粒子，位置与透明度改为基于 $t$ 的解析公式 $p(t) = p_0 + v \cdot t \pmod L$                                   |

---

## 1. 总体架构与目录骨架

### 1.1 系统分层与数据流总览

系统划分为四个逻辑域：**资产与配置层（`studio/`）**、**演播室前端引擎（`frontend/src/studio/`）**、**音乐烘焙后端（`backend/studio/`）**、**离线渲染管线（`frontend/scripts/studio-render.mjs`）**。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           studio/ （本地资产与数据契约）                          │
│  schema/*.schema.json  │  scripts/*.script.json  │  music/*.json  │  output/    │
└───────────┬─────────────────────────┬────────────────────┬──────────────────────┘
            │ 校验规则                 │ 读取剧本            │ 写入/读取预烘焙歌词
            ▼                         ▼                    ▼
┌───────────────────────┐   ┌──────────────────────────────────────┐   ┌──────────┐
│  backend/studio/      │   │        frontend/src/studio/          │   │ Vite     │
│  Flask Blueprint      │──▶│  ScriptLoader & Validator            │◀──│ Static   │
│  /api/studio/*        │   │         │                            │   │ Middleware│
│  - lyric_parser.py    │   │         ▼                            │   └──────────┘
│  - lyric_baker.py     │   │  TimelineCompiler (顺序 → 绝对时间码) │
│  - smtc_helper.py     │   │         │                            │
└───────────────────────┘   │         ▼                            │
                            │  FrameClock (t) ──▶ StateDeriver(t)  │
                            │                         │            │
                            │     ┌───────────┬───────┼───────┐    │
                            │     ▼           ▼       ▼       ▼    │
                            │  PageStage  StudioPet LyricBar Toast │
                            │  (Scroll/   (640px    (TopBar  Gate  │
                            │   Type/Code) 字幕框)   单行词)        │
                            └─────────────────┬────────────────────┘
                                              │ window.__studio.seek(t)
                                              ▼
                            ┌──────────────────────────────────────┐
                            │  frontend/scripts/studio-render.mjs  │
                            │  Playwright Headless ──pipe──▶ FFmpeg│
                            │  输出: <seq>-<segId>.mp4 + manifest  │
                            └──────────────────────────────────────┘
```

### 1.2 演播室资源加载通道设计

根据 PRD §6.2.1，**渲染与预览期间前端仅读取本地文件，不发起外部网络请求**。由于 `studio/` 目录位于仓库根目录（`frontend/` 之外），通过一个轻量级 Vite 插件 `vite-plugin-studio-fs` 将 `../studio` 挂载到开发/预览服务器的静态路由下：

- `GET /__studio_fs/scripts/<id>.script.json` → 读取 `studio/scripts/<id>.script.json`
- `GET /__studio_fs/music/<ref>.json` → 读取 `studio/music/<ref>.json`
- `GET /__studio_fs/schema/<name>.schema.json` → 读取 `studio/schema/<name>.schema.json`
- `WS  /__studio_ws`（P1 热重载） → 监听 `studio/scripts/*.json` 文件变更，推送重载通知

该插件仅在本地 `vite dev` / `vite preview` 下生效，不参与生产构建（`apply: 'serve'`），因此不污染打包产物。

### 1.3 目录结构全景图

标注 `[NEW]` 的为 studio 新增文件，标注 `[MOD]` 的为需微改的 upstream 已有文件：

```plain
blog0fwindchan-studio/
├── .gitignore                                  [MOD] 追加 studio 隐私忽略规则
├── docs/
│   └── studio/
│       ├── PRD.md                              (已有)
│       └── ARCHITECTURE.md                     [NEW] 本文档
│
├── studio/                                     [NEW] 制片厂资产根目录
│   ├── studio.config.example.json              [NEW] 渲染配置模板（提交）
│   ├── studio.config.json                      (本地创建，.gitignore 忽略)
│   ├── schema/
│   │   ├── script.schema.json                  [NEW] 剧本 JSON Schema Draft-07
│   │   └── music.schema.json                   [NEW] 音乐烘焙 JSON Schema Draft-07
│   ├── scripts/
│   │   ├── example.script.json                 [NEW] 示例剧本（提交）
│   │   └── *.script.json                       (.gitignore 忽略其余剧本)
│   ├── music/
│   │   ├── example-song.json                   [NEW] 示例烘焙歌词（提交）
│   │   └── *.json                              (.gitignore 忽略其余歌词)
│   └── output/                                 (.gitignore 忽略全部输出)
│       └── <script-id>/
│           ├── 01-intro.mp4
│           ├── 02-install.mp4
│           └── manifest.json
│
├── backend/
│   ├── app.py                                  (不修改)
│   ├── routes/
│   │   └── __init__.py                         [MOD] 末尾条件挂载 studio_bp（仅 3 行）
│   ├── requirements.txt                        (不修改，保持与 upstream 一致)
│   ├── requirements-studio.txt                 [NEW] studio 专属依赖 (requests, winsdk; sys_platform=="win32")
│   └── studio/                                 [NEW] 制片厂后端模块
│       ├── __init__.py                         [NEW] 导出 studio_bp 蓝图与 localhost 守卫
│       ├── routes.py                           [NEW] /api/studio/* 烘焙与查询接口
│       ├── lyric_parser.py                     [NEW] 迁入自 ncm-lyrics-streamer（标准库）
│       ├── lyric_baker.py                      [NEW] 搜歌、抓词、写盘（基于 requests 同步实现）
│       └── smtc_helper.py                      [NEW] 迁入自 media_listener.py（winsdk 可选降级）
│
└── frontend/
    ├── package.json                            [MOD] 增加 render 脚本与 ajv 校验依赖
    ├── vite.config.ts                          [MOD] 注册 studioFsPlugin()（仅 2 行）
    ├── scripts/
    │   └── studio-render.mjs                   [NEW] 分段离线渲染 CLI + manifest 生成器
    └── src/
        ├── main.ts                             [MOD] 注册 studio Pinia 插件（仅 2 行）
        ├── App.vue                             [MOD] 挂载 <StudioRoot /> 与根容器 zoom 样式
        ├── composables/
        │   ├── useArticleContent.ts            [MOD] 暴露 setStudioDarkTheme 覆盖接口
        │   └── useTheme.ts                     [MOD] 演播室模式下委托主题状态并静默存储
        ├── components/
        │   ├── layout/
        │   │   ├── MainLayout.vue              [MOD] 顶栏 .center-group 切换歌词条 + 清场 class
        │   │   └── ParticleLayer.vue           [MOD] 演播室模式下切换确定性粒子步进函数
        │   └── common/
        │       ├── ContentTypeWriter.vue       [MOD] 演播室模式下暴露按进度揭示方法
        │       └── ArticleTocPet.vue           [MOD] 演播室模式下让位给 StudioTocPet
        └── studio/                             [NEW] 演播室前端核心引擎（全部新增代码集中于此）
            ├── index.ts                        [NEW] 模块统一入口与 window.__studio 桥接
            ├── vitePluginStudioFs.ts           [NEW] Vite 本地静态资源与热重载插件
            ├── types/
            │   ├── script.ts                   [NEW] 剧本原始结构与编译后时间线类型
            │   ├── music.ts                    [NEW] 烘焙歌词结构与匹配结果类型
            │   └── state.ts                    [NEW] StudioFrameState 逐帧完整状态快照类型
            ├── engine/
            │   ├── frameClock.ts               [NEW] 全局帧时钟（play/pause/seek/step）
            │   ├── scriptValidator.ts          [NEW] JSON Schema 校验 + 精确路径定位 + 语义校验
            │   ├── timelineCompiler.ts         [NEW] 剧本编译器（顺序时长 → 绝对时间轴 + 歌单排期）
            │   ├── stateDeriver.ts             [NEW] 状态推导纯函数 state = derive(timeline, t)
            │   ├── locatorResolver.ts          [NEW] 标题原文与代码块 DOM 定位器解析
            │   ├── lyricMatcher.ts             [NEW] TS 版 match_sentence（与 Python 严格同构）
            │   ├── seededRandom.ts             [NEW] mulberry32 固定种子伪随机数生成器
            │   └── easing.ts                   [NEW] 标准缓动函数库（linear/easeInOut/easeOut）
            ├── bridge/
            │   ├── studioPiniaPlugin.ts        [NEW] 拦截 toastStore 与隔离 settingsStore
            │   ├── pageStageDriver.ts          [NEW] 将 StudioFrameState 施加到真实 DOM（滚动/高亮/复制）
            │   └── renderBridge.ts             [NEW] 暴露给 Playwright 的 window.__studio 控制协议
            ├── stores/
            │   └── useStudioStore.ts           [NEW] 演播室主状态仓（当前剧本、编译产物、被拦截 Toast 等）
            ├── styles/
            │   └── studioStage.css             [NEW] 演播室清场规则、动画冻结、高亮框与字幕样式
            └── components/
                ├── StudioRoot.vue              [NEW] 演播室顶层挂载点（调度 TocPet、剧本 Toast、控制栏）
                ├── StudioLyricBar.vue          [NEW] 顶栏单行歌词组件（含歌间渐变与 outro）
                ├── StudioTocPet.vue            [NEW] 640px 演播室专用字幕框与步骤条组件
                ├── StudioToastLayer.vue        [NEW] 帧时钟驱动的剧本 Toast 渲染层
                ├── DirectorBar.vue             [NEW] 导演预览控制栏（?director=1 时激活）
                └── MusicBakePanel.vue          [NEW] 控制栏内的音乐烘焙浮动面板
```

---

## 2. 仓库单向合并与低侵入集成规范（回应 PRD §2.1 & §10 #5）

### 2.1 修改边界原则

为确保定期执行 `git merge upstream/main` 时冲突最小、定位最快，对 upstream 已有文件的修改遵循以下三条铁律：

1. **不动内部主干逻辑**：不在 upstream 函数内部穿插复杂的 `if (isStudio) ... else ...` 分支，改为在入口处短路或通过插件拦截。
2. **UI 替换优于组件改造**：对于形态差异极大的组件（如 `ArticleTocPet.vue` 400px 闲聊桌宠 vs 演播室 640px 双行字幕框；`ToastItem.vue` `setTimeout` 计时器 vs 帧时钟进度条），直接新建 `StudioTocPet.vue` 和 `StudioToastLayer.vue`，原组件仅加一行 `v-if="!isStudioMode"` 让位。
3. **样式清场走全局 CSS 作用域**：PRD §7.0 要求隐藏的侧栏、返回按钮、文章信息行、底栏导航、滚动提示等元素，**一律不改对应 Vue 模板**，而是当进入演播室模式时在 `<html>` 根节点挂载 `data-studio-mode="true"` 属性，由 `studioStage.css` 通过后代选择器统一 `display: none !important` 清场。

### 2.2 Upstream 已有文件触碰清单（全量穷举）

除下表列出的 **10 个文件**外，禁止修改任何其他 upstream 既有文件：

| 序号 | 文件路径                                                                     | 修改目的                                                                                  |    预计改动行数    | 冲突风险与化解方式                              |
| :--- | :--------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- | :----------------: | :---------------------------------------------- |
| 1    | `.gitignore`                                                                 | 追加 `studio/` 隐私目录忽略规则                                                           | +12 行（文件末尾） | 极低；放在文件最末尾独立区块                    |
| 2    | `backend/routes/__init__.py`                                                 | 注册 `studio_bp` 蓝图                                                                     | +4 行（函数末尾）  | 极低；置于 `register_routes` 尾部               |
| 3    | `frontend/package.json`                                                      | 新增 `ajv` 依赖与 `studio:render` 脚本                                                    |       +3 行        | 低；常规依赖合并                                |
| 4    | `frontend/vite.config.ts`                                                    | 在 `plugins` 数组加入 `studioFsPlugin()`                                                  |       +2 行        | 极低                                            |
| 5    | `frontend/src/main.ts`                                                       | 给 `pinia` 实例注册 `studioPiniaPlugin`                                                   |       +2 行        | 极低                                            |
| 6    | `frontend/src/App.vue`                                                       | 挂载 `<StudioRoot />`，绑定根容器 `zoom`                                                  |       +4 行        | 极低；`App.vue` 极少变动                        |
| 7    | `frontend/src/composables/useArticleContent.ts` & `useTheme.ts`              | 统一全局主题状态源，支持演播室强制覆写亮暗主题且不写 `localStorage`                       |       ~15 行       | 低；详见 §5.4                                   |
| 8    | `frontend/src/components/layout/MainLayout.vue`                              | `.center-group` 内用 `v-if="isStudioMode"` 切换 `<StudioLyricBar />` 与原 `.time-display` |       +4 行        | 极低                                            |
| 9    | `frontend/src/components/layout/ParticleLayer.vue`                           | 暴露或接入基于帧时钟 $t$ 的确定性粒子渲染分支                                             |       ~20 行       | 低；仅替换 `initParticles` 与 `render` 入口钩子 |
| 10   | `frontend/src/components/common/ContentTypeWriter.vue` & `ArticleTocPet.vue` | `ArticleTocPet` 在演播室模式下隐藏；`ContentTypeWriter` 支持按字符比例静态揭示            |       ~25 行       | 低；在 `watch` 入口处分支                       |

### 2.3 CSS 选择器零侵入清场方案（实现 PRD §7.0）

在 `frontend/src/studio/styles/studioStage.css` 中统一声明演播室视觉清场规则。退出演播室模式时移除 `html[data-studio-mode]` 属性即可全量恢复，无需修改各个业务组件：

```css
/* === 1. 隐藏非舞台 UI 元素 (PRD §7.0) === */
html[data-studio-mode="true"] .nav-panel,
html[data-studio-mode="true"] .reflection-mask.nav-mask,
html[data-studio-mode="true"] .title-bar .left-group,
html[data-studio-mode="true"] .title-bar .right-group,
html[data-studio-mode="true"] .page-header .back-area,
html[data-studio-mode="true"] .story-view .article-info,
html[data-studio-mode="true"] .article-navigation,
html[data-studio-mode="true"] .scroll-indicator,
html[data-studio-mode="true"] .toast-container {
  display: none !important;
}

/* === 2. 冻结鼠标交互与文本选中 (PRD 原则 3) === */
html[data-studio-mode="true"] .main-layout {
  pointer-events: none !important;
  user-select: none !important;
}

/* === 3. 侧栏隐藏后文章容器居中与留白调整 === */
html[data-studio-mode="true"] .main-content {
  justify-content: center;
}
html[data-studio-mode="true"] .content-view {
  max-width: 1160px;
  width: 100%;
  margin: 0 auto;
  /* 底部预留空间，保证文末内容可滚动至字幕框上方可视区 */
  padding-bottom: 360px !important;
}
```

---

## 3. 帧时钟与确定性引擎（回应 PRD §10 #1, #9, #11）

### 3.1 不确定性源排查与接管矩阵（PRD §10 #1）

浏览器中任何依赖真实流逝时间（Wall Clock）或硬件事件的逻辑都会破坏逐帧复现。下表穷举了现有代码中全部非确定性来源及其在演播室模式下的接管策略：

| 不确定性源                                | 涉及的现有模块                                                      | 演播室接管策略                                                                                                                                                                                       |
| :---------------------------------------- | :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IntersectionObserver`                    | `ArticleTocPet.vue` 计算 `activeHeadingId`                          | `ArticleTocPet` 在演播室模式下不挂载（`v-if="!isStudioMode"`）；替换组件 `StudioTocPet` 的高亮标题完全由 `StudioFrameState.toc.activeHeadingId` 驱动                                                 |
| `window.scrollTo({ behavior: 'smooth' })` | `ArticleTocPet.vue`、`ArticleDetailView.vue`                        | 演播室模式下所有页面滚动均由 `pageStageDriver.ts` 调用 `window.scrollTo({ top: y, behavior: 'instant' })` 完成，$y$ 由 `scroll` 动作插值公式直接算出                                                 |
| `requestAnimationFrame` + `setTimeout`    | `ContentTypeWriter.vue` 打字循环                                    | 演播室模式下禁止启动 rAF 循环，改为暴露 `revealByProgress(charCount)` 同步方法，根据 $t$ 直接切分 DOM 节点可见性（见 §4.4）                                                                          |
| `setInterval` / `setTimeout`              | `useClock.ts`、`usePetIdle.ts`、`usePetMessage.ts`、`ToastItem.vue` | 顶栏时钟被 `<StudioLyricBar />` 替换；`useTocPet` 与原 `ToastContainer` 不挂载，定时器从源头不启动                                                                                                   |
| `new Date()` / `lunar-javascript`         | `usePetGreeting.ts` 节日与时段问候                                  | 随 `useTocPet` 一并停用；演播室所有文案严格来自剧本 JSON                                                                                                                                             |
| `Math.random()` + 逐帧增量累加            | `ParticleLayer.vue` 背景粒子                                        | 接管为固定种子 PRNG + 基于 $t$ 的解析坐标公式（见 §3.5）                                                                                                                                             |
| CSS `transition` / `@keyframes`           | 全局主题过渡、目录高度展开、气泡进出场、复制按钮反馈                | 演播室模式下禁用不可控的自由 CSS 动画；所有过渡进度（如目录展开比例 `expandProgress`、气泡透明度 `opacity`、歌词淡入淡出）由 `stateDeriver(t)` 算出 `[0, 1]` 数值，直接绑定为行内 `style`（见 §3.3） |

### 3.2 全局帧时钟 `FrameClock` 设计

`frontend/src/studio/engine/frameClock.ts` 维护演播室唯一时间源 $t$（单位：毫秒，浮点数，范围 $[0, T_{\text{total}}]$）：

```ts
export interface FrameClock {
  /** 当前精确毫秒时间戳（响应式只读） */
  readonly currentTimeMs: Readonly<Ref<number>>;
  /** 当前帧序号：Math.floor((currentTimeMs * fps) / 1000) */
  readonly currentFrame: ComputedRef<number>;
  /** 是否处于实时预览播放中 */
  readonly isPlaying: Readonly<Ref<boolean>>;
  /** 循环区间（导演控制栏按 L 键启用当前 segment 循环） */
  readonly loopRange: Ref<{ startMs: number; endMs: number } | null>;

  /** 启动实时预览播放（仅用于导演浏览器预览，内部用 performance.now() 差值驱动） */
  play(): void;
  /** 暂停播放 */
  pause(): void;
  /**
   * 跳转到任意毫秒时刻 t，并同步完成所有 DOM 更新与重绘准备。
   * 预览拖拽与 Playwright 逐帧截屏均调用此方法。
   */
  seek(timeMs: number): Promise<void>;
  /** 按帧步进：deltaFrames 可为 +1 / -1 / +fps / -fps */
  stepFrames(deltaFrames: number): Promise<void>;
}
```

**`seek(t)` 的确定性执行序列**：

1. 将输入裁剪至合法区间：$t \leftarrow \text{clamp}(t, 0, T_{\text{total}})$。
2. 更新 `currentTimeMs.value = t`。
3. 同步调用纯函数 `const state = deriveStudioFrameState(compiledTimeline, domMetrics, t)`。
4. 同步调用 `applyPageStageState(state)`：设置 `window.scrollTo(0, state.scrollY)`、更新打字机揭示位置、设置高亮框与代码块 `copied` 类名、重绘粒子画布 `renderParticlesAt(t)`、触发 `ReflectionLayer` 遮罩坐标同步。
5. `await nextTick()` 等待 Vue 组件（`StudioTocPet`、`StudioLyricBar`、`StudioToastLayer`）响应 DOM 更新。
6. 在双层 `requestAnimationFrame` 后 resolve，确保浏览器合成器已完成光栅化提交，Playwright 紧接着调用 `page.screenshot()` 即可拿到稳定帧。

### 3.3 动画与过渡的“去 CSS 自走化”原则

若使用常规 CSS `transition: height 0.4s` 或 `@keyframes`，当 Playwright 以 ~300ms/帧的速度步进调用 `seek(t)` 时，真实世界已过去 300ms，而视频帧时间只前进了 $1000 / 30 \approx 33.33\text{ms}$，CSS 动画会以错误的速度播放甚至直接跳到终点。

因此，演播室模式下采用**纯数据插值驱动行内样式**：

1. **全局冻结自走动画**：在 `studioStage.css` 中关闭业务容器上非受控的 CSS `transition-duration`（将原本依赖 CSS 过渡的属性改由 JS 逐帧赋值）。
2. **由 `stateDeriver(t)` 输出归一化进度 $\alpha \in [0, 1]$**：
   - **台词气泡切换**（PRD §7.1：旧句向上淡出 150ms，新句自下淡入 200ms）：
     - 新句入场阶段 $\tau = t - t_{\text{lineStart}} \in [0, 200]$：$\alpha = \text{easeOut}(\tau / 200)$，绑定 `opacity: α; transform: translateY(${(1 - α) * 10}px)`。
     - 旧句退场阶段 $\tau = t - (t_{\text{lineEnd}} - 150) \in [0, 150]$：$\alpha = 1 - \text{easeIn}(\tau / 150)$，绑定 `opacity: α; transform: translateY(${-(1 - α) * 8}px)`。
   - **目录展开/收起**（PRD §7.1：400ms `cubic-bezier(0.25, 0.8, 0.25, 1)`）：
     - 记录最近一次 `toc.expand` 切换时刻 $t_{\text{toggle}}$，计算 $\alpha = \text{bezier}_{(0.25,0.8,0.25,1)}(\text{clamp}((t - t_{\text{toggle}}) / 400, 0, 1))$，目录容器绑定 `max-height: ${α * 260}px; opacity: ${α}`。
   - **顶栏歌词淡入淡出**（PRD §7.2：旧行淡出 300ms、新行淡入 300ms）与**前奏 `♪` 呼吸**（$\text{opacity} = 0.45 + 0.35 \cdot \sin(2\pi t / 2400)$）：全部为 $t$ 的初等函数。
   - **新增教学情绪动效**（PRD §5.6）：
     - `warning`：图标单次下压 $\Delta y(t) = 6 \cdot \sin(\pi \cdot \text{clamp}((t - t_0)/300, 0, 1))\text{px}$。
     - `cheer`：7 颗星星粒子的极坐标 $(r_i, \theta_i)$ 由固定种子生成，在 $\tau \in [0, 1200]\text{ms}$ 内按抛物线扩散并淡出。
     - `thinking`：前 $450\text{ms}$ 内三点 `…` 依次按 $\lfloor \tau / 150 \rfloor$ 点亮，随后显示正文。
     - `proud`：图标浮动 $\Delta y(t) = 3 \cdot \sin(2\pi (t - t_0) / 1600)\text{px}$，气泡高光伪元素 `left` 在前 $600\text{ms}$ 内从 `-30%` 扫至 `130%`。
     - `success`：边框绿色光晕在 $\tau \in [0, 500]\text{ms}$ 内按 $\sin(\pi \tau / 500)$ 闪动一次。

### 3.4 页面缩放 `video.zoom` 精确对齐方案（PRD §10 #9）

**问题分析**：
当输出分辨率为 `1920×1080`、`video.zoom = 1.1` 时，若使用 Playwright 的 `viewport: { width: Math.round(1920 / 1.1), height: Math.round(1080 / 1.1) }` + `deviceScaleFactor: 1.1`：

- $1920 / 1.1 = 1745.4545\dots \rightarrow 1745$，$1745 \times 1.1 = 1919.5 \rightarrow 1920\text{px}$（存在亚像素拉伸）；
- $1080 / 1.1 = 981.8181\dots \rightarrow 982$，$982 \times 1.1 = 1080.2 \rightarrow 1080\text{px}$；
- 更严重的是，导演在普通桌面浏览器里打开 `http://localhost:5173/...?studio=xxx&director=1` 时，无法自动修改浏览器自身的 `deviceScaleFactor`，会导致**导演预览与最终成片的折行位置不一致**。

**架构决策：整数视口 + CSS `zoom` + 固定元素反向补偿**

1. **视口始终为整数输出尺寸**：Playwright 启动时固定 `viewport: { width: video.width, height: video.height }`（默认 `1920×1080`），`deviceScaleFactor: 1`。截出的 PNG 严格为 `1920×1080`，零亚像素取整误差。
2. **对内容流容器施加 CSS `zoom`**：
   Chromium 原生支持标准化的 CSS `zoom` 属性，其排版折行效果与浏览器 `Ctrl + '+'` 调整到 `110%` 完全一致。在演播室模式下，将 `--studio-zoom: 1.1` 注入 `<html>`，并对 `.main-layout` 施加 `zoom: var(--studio-zoom)`。
3. **输出像素契约（PRD §7 尺寸单位约定）**：
   PRD §7 规定：“本章所有尺寸（如 TocPet 宽 640px、字号 26px、距右 40px / 距底 48px）都指**输出视频里的像素**”。
   由于 `<StudioRoot />`（挂载 `StudioTocPet`、`StudioToastLayer`、`DirectorBar`）挂在 `#app-root` 下、`.main-layout` 之外，**不继承 `.main-layout` 的 `zoom`**，因此 `StudioTocPet` 直接写 `width: 640px; font-size: 26px; right: 40px; bottom: 48px` 即严格对应 1080p 成片里的 640px、26px！省去了所有 `640 / 1.1 ≈ 582px` 的换算误差。
4. **滚动坐标换算**：
   当 `.main-layout` 设置了 `zoom: z` 时，`element.getBoundingClientRect().top` 返回的是缩放后的视口坐标，结合 `window.scrollY` 计算目标滚动位置时，在 `locatorResolver.ts` 中统一按当前 `zoom` 系数归一化并由实机集成测试校准。

### 3.5 粒子层确定性改造（PRD §10 #11）

现有 `ParticleLayer.vue` 存在两处不确定性：① `initParticles()` 使用 `Math.random()` 生成初始坐标与速度；② `render()` 在 `requestAnimationFrame` 中做 `this.x += this.vx` 状态累加。

**确定性改造方案**：

1. **固定种子 PRNG（`seededRandom.ts`）**：
   使用经典的 32-bit `mulberry32(seed)` 算法，种子由剧本 `id` 的 FNV-1a 哈希值生成（同一剧本恒定，不同剧本各有不同星空分布）。
2. **粒子状态解析公式（无状态推导）**：
   每个粒子 $i \in [0, N-1]$ 在初始化时通过 `mulberry32` 确定初始参数 $(x_{i,0}, y_{i,0}, v_{x,i}, v_{y,i}, \theta_{i,0}, \omega_i, \alpha_{i,0}, \\omega_{\alpha,i})$。
   在任意时刻 $t$（毫秒），定义等效帧步数 $k = t / (1000 / 60) = 0.06 \cdot t$（对齐 60Hz 基准速率）：
   - **环形空间折叠（Wrap-around）**：设包裹跨度 $W' = w + 2B, H' = h + 2B$（其中 $B = 50\text{px}$ 为缓冲区），则：
     $$x_i(t) = \left( (x_{i,0} + B + v_{x,i} \cdot k) \bmod W' + W' \right) \bmod W' - B$$
     $$y_i(t) = \left( (y_{i,0} + B + v_{y,i} \cdot k) \bmod H' + H' \right) \bmod H' - B$$
   - **旋转角度**：$\theta_i(t) = \theta_{i,0} + \omega_i \cdot k$。
   - **呼吸透明度（三角波折叠）**：暗色模式下透明度在 $[0.4, 1.0]$ 之间往返反弹（区间长度 $D = 0.6$），利用周期为 $2D$ 的三角波函数 $\text{tri}(u) = D - |u \bmod (2D) - D|$，直接算出：
     $$\alpha_i(t) = 0.4 + \text{tri}\big((\alpha_{i,0} - 0.4) + |\omega_{\alpha,i}| \cdot k\big)$$
3. **与 `ParticleLayer.vue` 的低侵入衔接**：
   在 `ParticleLayer.vue` 中仅增加一个 `watch(() => studioStore.currentTimeMs, (t) => renderDeterministic(t))` 分支：当 `studioStore.isStudioMode` 为 `true` 时，停止原有的 `requestAnimationFrame(render)` 循环，每次帧时钟变化时按上述解析公式重绘一帧 Canvas。

---

## 4. 剧本编译器与状态推导模型（回应 PRD §5, §6.3, §10 #2, #7）

### 4.1 两阶段架构：先编译，后推导

为了在拖拽时间轴时实现 $< 1\text{ms}$ 的状态计算（远低于 PRD US2 要求的 200ms），剧本处理分为两个阶段：

1. **编译阶段（Load Time，剧本加载或热重载时执行一次）**：
   `timelineCompiler.ts` 将手写的相对时间剧本 `ScriptJson` 加上预烘焙的音乐文件数组 `MusicBakeJson[]`，编译为扁平的绝对时间线结构 `CompiledTimeline`。
2. **推导阶段（Frame Time，每次 `seek(t)` 时执行）**：
   `stateDeriver.ts` 在 `CompiledTimeline` 上通过二分查找定位当前分段与台词，并扫描动作区间，纯函数产出 `StudioFrameState`。

```
ScriptJson + MusicBakeJson[] + ArticleDOM
        │
        ▼  compileTimeline()  [加载时执行 1 次]
CompiledTimeline (绝对时间码、已解析的 DOM 锚点、预排期的歌单与自动署名 Toast)
        │
        ▼  deriveFrameState(timeline, t)  [每帧执行，纯函数 O(log N + M)]
StudioFrameState (scrollY / charCount / pet / lyric / toasts / highlight / theme)
```

### 4.2 编译产物 `CompiledTimeline` 与推导算法

#### 4.2.1 台词与分段排期规则

设 `gapMs = script.video?.defaults?.gapMs ?? 300`，`defaultMood = script.video?.defaults?.mood ?? 'reading'`。
按顺序遍历 `segments[s].lines[l]`，维护全局游标 `cursorMs = 0` 与情绪游标 `lastMood = defaultMood`：

1. **单句时长计算（PRD §5.4 F13）**：
   - 若 `line.duration` 已手写，则 `speakDurationMs = line.duration`，标记 `durationSource = 'manual'`；
   - 若未写，剥离 `**` 与 `` ` `` 标记后统计中文字数 $C_{\text{zh}}$ 与英文单词数 $C_{\text{en}}$，按公式推算：
     $$\text{speakDurationMs} = \text{clamp}(600 + 220 \cdot C_{\text{zh}} + 300 \cdot C_{\text{en}}, 1500, 8000)$$
     标记 `durationSource = 'auto'`。
2. **`wait` 动作展平**：
   若该句 `actions` 中含 `{ type: 'wait', durationMs: W }`，则本句占用的时间槽总长度为：
   - 气泡显示区间：$[t_{\text{start}}, t_{\text{speakEnd}}]$，其中 $t_{\text{start}} = \text{cursorMs}$，$t_{\text{speakEnd}} = t_{\text{start}} + \text{speakDurationMs}$；
   - 纯画面等待区间（气泡隐藏）：$[t_{\text{speakEnd}}, t_{\text{speakEnd}} + W]$；
   - 句间空白（`gapMs`，气泡保持高度但文字为空）：紧随其后（全片最后一句不加 `gapMs`）。
   - 推进游标：`cursorMs = t_speakEnd + W + (isLastLineOfScript ? 0 : gapMs)`。
3. **情绪继承**：
   `resolvedMood = line.mood ?? lastMood`，随后更新 `lastMood = resolvedMood`。
4. **分段起止边界**：
   每个 `CompiledSegment` 的 `startMs` 为其首句的 $t_{\text{start}}$，`endMs` 为其末句结束（含该句末尾 `wait` 与 `gapMs`）的时刻。这保证所有分段无缝拼接：$\text{seg}[k].\text{endMs} == \text{seg}[k+1].\text{startMs}$，全片总时长 $T_{\text{total}} = \text{seg}[\text{last}].\text{endMs}$。

#### 4.2.2 动作（Actions）编译为绝对时间事件

遍历每句台词下的 `action`，设触发绝对时刻 $t_{\text{act}} = t_{\text{lineStart}} + (\text{action.at} ?? 0)$：

| 动作类型     | 编译后的绝对事件结构                                                                 | 在时刻 $t$ 的状态推导规则                                                                                                                                                                                                                                                                                                                                        |
| :----------- | :----------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scroll`     | `{ startMs: t_act, endMs: t_act + durationMs, targetLocator, offset, easing }`       | 若 $t$ 落在某个 `scroll` 区间 $[t_0, t_1]$ 内，起点 $y_{\text{from}}$ 取**该动作之前最近一次 `scroll` 的终点**（首动作前为 $0$），终点 $y_{\text{to}}$ 由定位器实时查表，返回 $y_{\text{from}} + (y_{\text{to}} - y_{\text{from}}) \cdot \text{ease}((t - t_0)/(t_1 - t_0))$；若不在任何区间内，取 $t_{\text{act}} \le t$ 的最后一个 `scroll` 的 $y_{\text{to}}$ |
| `toc`        | `{ atMs: t_act, expand?: boolean, highlightHeadingId?: string }`                     | 展开状态 = $t_{\text{act}} \le t$ 的最后一次显式设定 `expand` 的事件值（初始 `false`）；高亮标题 = 最后一次设定 `highlight`（含进入 segment 时的 `tocAnchor`）的标题 ID                                                                                                                                                                                          |
| `highlight`  | `{ startMs: t_act, endMs: untilLineEnd ? t_speakEnd : T_total, targetRect, style }`  | 过滤出所有满足 $\text{startMs} \le t < \text{endMs}$ 的高亮项                                                                                                                                                                                                                                                                                                    |
| `copy`       | `{ startMs: t_act, endMs: t_act + 2000, targetButtonSelector }`                      | 当 $\text{startMs} \le t < \text{endMs}$ 时，目标代码块的 `.code-copy-btn` 带有 `.copied` 类名（与日常点击后 2 秒恢复的行为完全一致，但不调用 `navigator.clipboard` 且不弹系统 Toast）                                                                                                                                                                           |
| `theme`      | `{ startMs: t_act, endMs: t_act + (durationMs ?? 0), to: 'light' \| 'dark' }`        | 取 $\text{startMs} \le t$ 的最后一次 `theme` 事件的 `to` 值（初始为 `script.video.theme ?? 'dark'`）                                                                                                                                                                                                                                                             |
| `toast`      | `{ startMs: t_act, endMs: t_act + (durationMs ?? 4000), toastType, text, position }` | 过滤出所有满足 $\text{startMs} \le t < \text{endMs}$ 的活跃 Toast，并计算剩余进度 `1 - (t - startMs) / durationMs`                                                                                                                                                                                                                                               |
| `typewriter` | `{ startMs: t_act, endMs: t_act + durationMs, untilHeadingId: string \| 'end' }`     | 见 §4.4 打字机可跳转模型                                                                                                                                                                                                                                                                                                                                         |

#### 4.2.3 歌单时间线与自动署名编译（实现 PRD §6.3）

编译期同时将 `script.music` 与预烘焙数据组装成 `CompiledMusicTimeline`：

1. **逐首排期**：
   设游标 $m = 0$。对 `music.tracks[k]`（对应烘焙数据 `bake_k`）：
   - 歌曲起点裁剪：`trackStartOffsetMs = track.startAtMs ?? 0`；
   - 歌曲有效播放时长：`playDurationMs = Math.max(0, bake_k.meta.duration_ms - trackStartOffsetMs)`；
   - 视频内区间：`videoStartMs = m`，`videoEndMs = m + playDurationMs`，更新 $m \leftarrow \text{videoEndMs}$。
   - **自动投放署名 Toast（PRD §6.3, F14）**：若 `script.music.announce !== false`，自动向编译后的 Toast 事件池注入一条：
     ```ts
     {
       id: `music-announce-${k}`,
       startMs: videoStartMs,
       endMs: videoStartMs + 4000,
       toastType: 'success',
       text: `♪ ${bake_k.meta.title} - ${bake_k.meta.artist}`,
       position: 'top-right',
     }
     ```
2. **歌间渐变与片尾 Outro 推导（任意时刻 $t$）**：
   设最后一首歌结束时刻为 $M_{\text{end}}$，全片结束时刻为 $T_{\text{total}}$：
   - **情况 A（$t < M_{\text{end}}$，仍在歌单播放期内）**：
     找到满足 $\text{videoStartMs} \le t < \text{videoEndMs}$ 的第 $k$ 首歌，换算歌曲内部进度：
     $$t_{\text{song}} = (t - \text{videoStartMs}) + \text{trackStartOffsetMs}$$
     调用 `matchSentence(bake_k.lyrics.lines, t_song)` 得到当前歌词行。
     若 $k < N_{\text{tracks}} - 1$ 且距离本首结束不足 `crossfadeMs`（默认 `1500ms`），则按剩余时间比例对当前歌词与下一首歌的首行做透明度交叉渐变（**绝不显示 outro**）。
   - **情况 B（$t \ge M_{\text{end}}$，歌单已播完但视频未结束）**：
     令歌单结束后的静默流逝时间 $\Delta t_{\text{after}} = t - M_{\text{end}}$，以及最后一首歌结束后的剩余片长 $R = T_{\text{total}} - M_{\text{end}}$：
     - 若 $R \le 15000\text{ms}$（最后一首结束 15 秒内视频也结束）：全程显示 `♪` 慢闪，不显示 outro；
     - 若 $R > 15000\text{ms}$：
       - 当 $0 \le \Delta t_{\text{after}} < 15000\text{ms}$ 时，显示 `♪` 慢闪；
       - 当 $\Delta t_{\text{after}} \ge 15000\text{ms}$ 时，以 300ms 淡入显示 `outroText = script.music?.outro?.text || '感谢收看～我们下期再见 awa'`，并保持到片尾。

### 4.3 锚点定位器解析器 `locatorResolver.ts`（回应 PRD §5.5.1 & §10 #7）

**现状确认**：
经核查 `ArticleDetailView.vue`（第 317~338 行）与 `useArticleInfo.ts`（第 23~34 行）：

- `articleToc` 从 Markdown 源码按正则提取所有 `h1~h6`，保留原始文本 `item.text` 并生成 `item.id`；
- `ArticleDetailView.vue` 在 DOM 渲染后按顺序将 `articleToc[i].id` 写入 `.markdown-content` 下的第 $i$ 个 `h1~h6` 元素；
- 代码块由 `useCodeHighlight.ts` 渲染为 `<div class="code-block-wrapper">...</div>`。

因此，**完全不需要修改 `useArticleInfo.ts` 的 `slugify` 算法**，定位器直接在 `.markdown-content` 的真实 DOM 树上按标题原文精准解析：

```ts
export type StudioLocator =
  | string // "#dom-id"
  | { heading: string; nth?: number; codeBlock?: number };

/**
 * 将剧本定位器解析为真实 DOM 元素。
 * 在文章 DOM 渲染就绪后执行；找不到目标时返回 null 并记录校验错误路径。
 */
export function resolveLocator(
  locator: StudioLocator,
  contentRoot: HTMLElement,
): HTMLElement | null {
  // 1. 字符串简写：直接按 #id 查找
  if (typeof locator === "string") {
    const id = locator.startsWith("#") ? locator.slice(1) : locator;
    return contentRoot.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
  }

  // 2. 按标题原文查找第 nth 个匹配标题（忽略首尾空白）
  const targetText = locator.heading.trim();
  const nth = locator.nth ?? 1;
  const headings = Array.from(
    contentRoot.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  );
  const matchedHeadings = headings.filter(
    (h) => (h.textContent || "").trim() === targetText,
  );
  const anchorHeading = matchedHeadings[nth - 1];
  if (!anchorHeading) return null;

  // 若未指定 codeBlock，目标就是该标题本身
  if (locator.codeBlock === undefined) {
    return anchorHeading;
  }

  // 3. 查找“该标题到下一个同级或更高级标题之间”的第 codeBlock 个代码块 (PRD §5.5.1)
  const anchorLevel = Number(anchorHeading.tagName.slice(1)); // h2 -> 2
  const anchorIndex = headings.indexOf(anchorHeading);
  let boundaryHeading: HTMLElement | null = null;
  for (let i = anchorIndex + 1; i < headings.length; i++) {
    const level = Number(headings[i].tagName.slice(1));
    if (level <= anchorLevel) {
      boundaryHeading = headings[i];
      break;
    }
  }

  // 扫描位于 anchorHeading 之后、boundaryHeading 之前的所有 .code-block-wrapper
  const allCodeBlocks = Array.from(
    contentRoot.querySelectorAll<HTMLElement>(".code-block-wrapper"),
  );
  const sectionCodeBlocks = allCodeBlocks.filter((cb) => {
    const afterAnchor = Boolean(
      anchorHeading.compareDocumentPosition(cb) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const beforeBoundary = boundaryHeading
      ? Boolean(
          cb.compareDocumentPosition(boundaryHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        )
      : true;
    return afterAnchor && beforeBoundary;
  });

  return sectionCodeBlocks[locator.codeBlock - 1] ?? null;
}
```

该实现利用 DOM 标准 API `Node.compareDocumentPosition`，无论代码块是直接子元素还是嵌套在列表/引用块内部，都能精确判定其是否落在该标题章节区间内；且当文章其他章节增删代码块时，本章节内的局部序号 `codeBlock: 1` 不受任何影响。

### 4.4 打字机组件可跳转改造（回应 PRD §5.5 & §10 #1, #2）

**现状分析**：
`ContentTypeWriter.vue` 在挂载后通过 `TreeWalker` 遍历 DOM 构建 `actions: ActionItem[]` 数组（每个条目为 `{ type: 'reveal', node: HTMLElement }` 或 `{ type: 'text', node: Text, text: string }`），随后用 `requestAnimationFrame` 逐步推进 `actionIndex` 和 `charIndex`。

**演播室可跳转改造方案**：

1. **静态快照表构建（DOM 挂载后执行一次）**：
   复用现有的 `TreeWalker` 产出的 `actions` 数组，额外计算一张前缀和索引表 `cumulativeChars: number[]`：
   - 每个 `text` 节点权重为其字符长度 `text.length`；
   - 每个 `reveal` 块级元素权重设为 `1`（避免空块无法解锁）；
   - 同时记录每个标题元素 `h1~h6` 对应的累计进度值 `headingCharOffsetMap: Map<string, number>`，以及全文总权重 `totalUnits`。
2. **剧本无 `typewriter` 动作时的默认行为（PRD §5.5）**：
   若编译期发现全片没有任何 `typewriter` 动作，则固定 `revealedUnits(t) = totalUnits`，文章从 $t = 0$ 起即全量显示，所有 TOC 标题全部解锁，`isTypingMode = false`。
3. **剧本含 `typewriter` 动作时的进度函数 `revealedUnits(t)`**：
   每个 `typewriter` 动作编译为区间 $[t_0, t_1]$，起点进度 $u_{\text{from}}$ 为上一个 `typewriter` 动作的终点（首动作前为 $0$），终点进度 $u_{\text{to}}$ 为 `until` 指向的标题在 `headingCharOffsetMap` 中的偏移量（若 `until === 'end'` 则为 `totalUnits`）。
   任意时刻 $t$ 的目标揭示量 $U(t)$ 通过线性插值算出，随后调用幂等函数 `applyTypewriterSnapshot(U(t))`：
   - 对序号 $\le U(t)$ 的 `ActionItem`：块级元素设为 `.typing-reveal-block`，文本节点设为完整字符串（分界点处的文本节点设为 `item.text.slice(0, remainChars)` 并挂载 `.typing-cursor`），沿途经过的标题写入 `unlockedHeadingIds`；
   - 对序号 $> U(t)$ 的 `ActionItem`：块级元素恢复 `.typing-hidden-block`，文本节点设为 `''`。
     因为 `applyTypewriterSnapshot(U)` 对全量 `actions` 做确定性赋值，所以无论是从头播放到 $t$、向后跳还是向前往回拖时间轴，DOM 状态都严格一致。

---

## 5. 演播室前端子系统设计（回应 PRD §7 & §10 #4, #6, #10）

### 5.1 `StudioTocPet.vue`：演播室专用字幕框与步骤导航（PRD §5.6, §7.1）

现有的 `ArticleTocPet.vue` 耦合了鼠标逃跑、核爆、闲聊轮播、让位偏移与 400px 窄布局。为遵守 §2.1“UI 替换优于组件改造”原则，演播室模式下 `ArticleTocPet.vue` 通过 `v-if="!studioStore.isStudioMode"` 卸载，改由 `<StudioRoot />` 渲染独立的 `<StudioTocPet />`。

#### 5.1.1 布局与尺寸契约

- **外框定位**：`position: fixed; right: 40px; bottom: 48px; width: 640px; z-index: 9990;`（挂在 `.main-layout` 之外，直接对应 1920×1080 成片像素，彻底关闭 `finalDodgeOffset` 让位逻辑）。
- **三段式垂直结构**：
  1. **顶部台词气泡区（固定最小高度 `104px`）**：
     - 左侧 `4px` 情绪色条（`warning`: `#f59e0b`，`success`: `#10b981`，`thinking`: `#3b82f6`，`cheer`: `#ec4899`，`proud`: `#a855f7`，其余默认主题色）。
     - 情绪图标区：映射 `StudioMood` 至 Font Awesome 图标（含新增 `warning` → `fa-exclamation-triangle`、`cheer` → `fa-star`、`thinking` → `fa-lightbulb`、`proud` → `fa-crown`、`success` → `fa-check-circle`），图标位移/缩放由 `state.pet.iconTransform` 行内样式直接驱动。
     - 台词文本区：`font-size: 26px; line-height: 1.5; max-height: 78px`（2 行）。支持轻量标记解析函数 `renderSubtitleTokens(text)`：仅用正则将 `**bold**` 转为 `<strong>`、将 `` `code` `` 转为 `<code class="studio-inline-code">`，其余字符全部走 HTML 实体转义，杜绝 XSS。`gapMs` 期间渲染空占位符 `&nbsp;`，保持气泡高度恒定不跳动。
  2. **中部 TOC 折叠抽屉（展开时显示）**：
     - 高度与透明度由 `state.pet.expandProgress`（$\in [0, 1]$）通过行内样式 `height: ${expandProgress * tocBodyHeight}px; opacity: ${expandProgress}` 控制。
     - 内部复用 `PetTocBody` 的列表视觉样式，高亮项由 `state.toc.activeHeadingId` 驱动。
  3. **底部步骤条与进度条（常驻）**：
     - 当 TOC 收起时，横向展示 `segments` 级教学步骤（`① 开场  ② 安装依赖 ...`），索引 `< currentSegmentIndex` 的步骤前缀打勾 `✓`，`=== currentSegmentIndex` 的步骤加粗高亮。
     - 底部节点进度条：`progress = (currentSegmentIndex + segmentInternalProgress) / segments.length * 100%`。

### 5.2 顶栏歌词条与 TS 版 `lyricMatcher.ts`（回应 PRD §6, §7.2 & §10 #4）

#### 5.2.1 TS 版 `matchSentence` 算法（与 Python `LyricParser.match_sentence` 逐行对齐）

为确保前端歌词匹配与 `ncm-lyrics-streamer` 的 `core/lyric_parser.py` 行为 100% 一致，`frontend/src/studio/engine/lyricMatcher.ts` 严格按照 Python 版（第 164~261 行）移植：

```ts
export interface BakedLyricLine {
  time_ms: number;
  duration_ms: number;
  text: string;
  translation: string;
  romaji: string;
}

export interface MatchedSentenceResult {
  index: number;
  current_line:
    | (BakedLyricLine & { index: number; line_progress: number })
    | null;
  line_progress: number;
  is_prelude: boolean;
  is_ended: boolean;
}

/**
 * 与 backend/studio/lyric_parser.py 中 LyricParser.match_sentence 严格等价的 TS 实现。
 */
export function matchSentence(
  lyrics: BakedLyricLine[],
  currentTimeMs: number,
): MatchedSentenceResult {
  // 0. 纯音乐或空歌词兜底 (PRD §6.2.1)
  if (!lyrics || lyrics.length === 0) {
    return {
      index: -1,
      current_line: null,
      line_progress: 0.0,
      is_prelude: true,
      is_ended: false,
    };
  }

  const totalLines = lyrics.length;

  // 1. 第一句歌词之前（前奏 Prelude）
  if (currentTimeMs < lyrics[0].time_ms) {
    const firstLineTime = lyrics[0].time_ms;
    const preludeProgress = Math.min(
      1.0,
      Math.max(0.0, currentTimeMs / Math.max(1, firstLineTime)),
    );
    return {
      index: -1,
      current_line: {
        index: -1,
        time_ms: 0,
        duration_ms: firstLineTime,
        text: "♪",
        translation: "",
        romaji: "",
        line_progress: preludeProgress,
      },
      line_progress: preludeProgress,
      is_prelude: true,
      is_ended: false,
    };
  }

  // 2. 二分查找满足 lyrics[i].time_ms <= currentTimeMs 的最大索引 activeIdx
  let activeIdx = 0;
  let low = 0;
  let high = totalLines - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lyrics[mid].time_ms <= currentTimeMs) {
      activeIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const currentItem = lyrics[activeIdx];
  const elapsedInLine = currentTimeMs - currentItem.time_ms;
  const lineProgress = Math.min(
    1.0,
    Math.max(0.0, elapsedInLine / Math.max(1, currentItem.duration_ms)),
  );
  const isEnded =
    activeIdx === totalLines - 1 && elapsedInLine > currentItem.duration_ms;

  return {
    index: activeIdx,
    current_line: {
      ...currentItem,
      index: activeIdx,
      line_progress: lineProgress,
    },
    line_progress: lineProgress,
    is_prelude: false,
    is_ended: isEnded,
  };
}
```

**跨语言对拍测试（回应 PRD §10 #4）**：
在单元测试 `frontend/src/studio/__tests__/lyricMatcher.spec.ts` 中，使用 `studio/music/example-song.json` 以及覆盖边界时刻（`t = 0`、前奏末帧 `time_ms - 1`、句首精确命中 `time_ms`、句间中点、末句结束后 `time_ms + duration_ms + 1`、空歌词数组）的固定向量表，与 Python 端输出的基准快照做断言比对，确保两端零偏差。

#### 5.2.2 `<StudioLyricBar />` 换行动效与视觉规则（PRD §3.2.2, §7.2）

- **挂载位置**：在 `MainLayout.vue` 的 `.center-group` 中：
  ```html
  <StudioLyricBar v-if="studioStore.isStudioMode" />
  <div v-else class="time-display">...</div>
  ```
- **换行淡入淡出计算**：
  设当前行区间为 $[t_{\text{lineStart}}, t_{\text{lineEnd}}]$：
  - 入场前 $300\text{ms}$：$\alpha_{\text{in}} = \text{clamp}((t_{\text{song}} - t_{\text{lineStart}}) / 300, 0, 1)$；
  - 退场前 $300\text{ms}$（当且仅当下一行文本与当前行不同）：$\alpha_{\text{out}} = \text{clamp}((t_{\text{lineEnd}} - t_{\text{song}}) / 300, 0, 1)$；
  - 综合透明度：$\alpha = \min(\alpha_{\text{in}}, \alpha_{\text{out}}) \times 0.85$（PRD §7.2 要求基准透明度 85%）。
- **可读性加固（回应 PRD §3.2.2）**：
  演播室模式下，`.title-bar` 内部 `.center-group` 采用居中小胶囊底衬，暗色主题下附加 `text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55)`，单行超出 `max-width: 960px` 时 `text-overflow: ellipsis` 截断。

### 5.3 Toast 按来源拦截与帧时钟驱动（回应 PRD §7.0 & §10 #6）

#### 5.3.1 为什么博客自发 Toast 不能进画面

现有代码中，`router/index.ts`（路由跃迁提示）、`useTheme.ts`（切换亮暗主题提示）、`ArticleTocPet.vue`（找不到标题 ID 警告）都会调用 `useToastStore().add(...)` 或 `useToast().notify(...)`。演播室模式下这些系统级 Toast 若出现在画面中会污染成片。

#### 5.3.2 Pinia 拦截插件 + 独立渲染层方案

1. **拦截博客自发 Toast（`studioPiniaPlugin.ts`）**：
   在 `main.ts` 注册 Pinia 插件，对 `toast` Store 的 `add` Action 进行 AOP 包装，**无需修改 `toastStore.ts` 或任何调用方**：
   ```ts
   export function studioPiniaPlugin({ store }: PiniaPluginContext) {
     if (store.$id === "toast") {
       const originalAdd = store.add;
       store.add = (options: ToastOptions) => {
         const studioStore = useStudioStore();
         if (studioStore.isStudioMode) {
           // 演播室模式下，所有经由 useToastStore.add 发起的博客原生 Toast
           // 一律拦截并转入导演控制栏的「🔔 系统消息列表」，返回虚拟 id
           return studioStore.captureSystemToast(options);
         }
         return originalAdd(options);
       };
     }
   }
   ```
2. **剧本 Toast 独立渲染层（`<StudioToastLayer />`）**：
   剧本中定义的 `toast` 动作以及歌单自动投放的「`♪ 歌名 - 歌手`」署名 Toast，**不经过 `useToastStore`**，而是直接由 `stateDeriver(t)` 算出当前时刻活跃的 `ActiveStudioToast[]` 数组（含入场/退场透明度、位置 `top-right`、剩余进度百分比 `progressPercent`），由 `<StudioToastLayer />` 按 `ToastItem.vue` 相同的视觉样式渲染，底部进度条直接绑定 `transform: scaleX(${toast.progressPercent})`（不使用 CSS `animation: progress-shrink`）。

### 5.4 用户个人设置与主题隔离（回应 PRD §7.0 & §10 #10）

#### 5.4.1 `useSettingsStore` 隔离策略（零侵入 upstream Store 内部）

`useSettingsStore.ts` 在初始化时从 `localStorage.getItem('blog_settings')` 读取配置，并监听 `window` 的 `storage` 事件。
为遵守 PRD §10 #10“隔离逻辑放在 studio 自己的开关里，不改 upstream 的 store 内部”：

1. **进入演播室模式时**：
   `studioPiniaPlugin` 备份当前 `settingsStore.$state` 的深拷贝快照 `userSettingsSnapshot`，随后将内存中的 `settingsStore.particles`、`settingsStore.toast`、`settingsStore.typeWriter` 重置为 Studio 标准默认值（如 `particles: { enabled: true, count: 80, baseSpeed: 0.5 }`，`toast: { position: 'top-right', duration: 4000 }`），并包装其所有 `set*` / `reset*` / `saveToLocalStorage` 方法为空操作（不写回 `localStorage`）。
2. **屏蔽跨标签页 `storage` 污染**：
   在进入演播室模式期间，在 `window` 捕获阶段注册 `window.addEventListener('storage', stopImmediatePropagationIfStudio, true)`，阻断其他标签页修改设置时触发 `useSettingsStore` 的 `onStorageChange`。
3. **退出演播室模式时**：
   将 `userSettingsSnapshot` 还原回 `settingsStore`，移除捕获监听器，用户的个人设置完好如初。

#### 5.4.2 亮暗主题统一与隔离（微改 `useTheme.ts` 与 `useArticleContent.ts`）

**现状发现**：
经排查代码，`MainLayout.vue` 使用 `useTheme.ts` 的局部 `ref`（默认 `false`，`onMounted` 读 `localStorage.getItem('theme')`），而 `App.vue` 和 `ArticleDetailView.vue` 使用 `useArticleContent.ts` 里的模块级 `isDarkTheme = ref(localStorage.getItem('theme') === 'dark')`。两者在日常模式下靠 `localStorage` 同步。

**演播室接管方案**：
在 `useTheme.ts` 和 `useArticleContent.ts` 中共享同一个模块级响应式引用 `globalDarkTheme`，并提供演播室覆写钩子 `setStudioThemeOverride(theme: 'light' | 'dark' | null)`：

- 当 `override !== null`（演播室模式）时，`isDarkTheme` 恒等于 `override === 'dark'`（由 `StudioFrameState.theme` 随帧时钟 $t$ 实时驱动，初始为 `script.video.theme ?? 'dark'`），且不读写 `localStorage`、不弹主题切换 Toast；
- 当 `override === null`（普通模式）时，完全恢复原有的 `localStorage` 读写与 Toast 提示逻辑。

### 5.5 剧本校验器 `scriptValidator.ts`（回应 PRD §3.1 F3, §5.5, §7.0）

校验器分为**静态 Schema 校验**与**运行时语义/DOM 校验**两层，所有错误与警告均标准化为结构化路径（如 `segments[1].lines[2].actions[0].target`），供导演控制栏标红悬停展示及渲染 CLI 拦截：

| 校验层级            | 校验项                                                                                                                                | 严重级别  | 错误路径示例与处理行为                                                                                                |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------ | :-------: | :-------------------------------------------------------------------------------------------------------------------- |
| L1 语法与 Schema    | JSON 语法错误、`version !== 1`、必填字段缺失、枚举越界（如非法 `mood` 或 `overlay` 动作）                                             |  `error`  | 借助 `ajv` 校验 `studio/schema/script.schema.json`，将 `instancePath` 转为 `segments[2].lines[4].mood` 格式；拒绝编译 |
| L2 时间线冲突       | 同一时间段内两个 `scroll` 动作区间 $[t_{a0}, t_{a1}]$ 与 $[t_{b0}, t_{b1}]$ 重叠                                                      |  `error`  | 定位到后一个冲突的 `segments[s].lines[l].actions[a]`；拒绝渲染                                                        |
| L2 跨句动作提示     | 动作的 `at` 超出本句 `duration`                                                                                                       | `warning` | 允许执行（支持跨句动作），在控制栏刻度上标黄提示                                                                      |
| L2 Toast 位置冲突   | `toast` 动作的 `position === 'bottom-right'`                                                                                          | `warning` | 提示会与右下角 `StudioTocPet` 字幕框重叠                                                                              |
| L2 音乐引用存在性   | `music.tracks[k].ref` 对应的 `studio/music/<ref>.json` 不存在                                                                         |  `error`  | 定位到 `music.tracks[k].ref`；提示先在烘焙面板烤制该曲目                                                              |
| L3 DOM 定位器存在性 | `scroll.to` / `highlight.target` / `copy.target` / `toc.highlight` / `typewriter.until` / `tocAnchor` 在当前文章 DOM 中找不到目标元素 |  `error`  | 文章加载完成后遍历校验；预览时控制栏标红该句，离线渲染时直接报错退出（Exit Code 1）                                   |
| L3 字幕行数超限     | 台词在 640px 宽度、26px 字号下折行超过 2 行                                                                                           | `warning` | 利用项目中已有的 `@chenglou/pretext` 预测量折行数 $> 2$ 时警告拆句（PRD §7.1）                                        |
| L3 字幕框遮挡检测   | `highlight` / `copy` 目标元素在对应时刻滚动到位后，其 BoundingBox 与右下角 `640×220` 字幕安全区相交                                   | `warning` | 编译期结合各标题/代码块的静态 `offsetTop` 与当时生效的 `scrollY` 计算视口坐标，相交时给出警告（PRD §7.0）             |

### 5.6 导演预览控制栏 `DirectorBar.vue` 与热重载（回应 PRD §7.3, §7.4, F10）

- **激活条件**：仅当 URL 同时包含 `?studio=<id>&director=1` 时挂载 `<DirectorBar />`。离线渲染脚本访问 `?studio=<id>`（不带 `director`），因此控制栏天然不进成片画面。
- **鼠标事件局部豁免**：`studioStage.css` 对 `.main-layout` 设置了 `pointer-events: none`，而 `<DirectorBar />` 与 `<MusicBakePanel />` 挂在 `<StudioRoot />` 下，设置 `pointer-events: auto; z-index: 10000;`，保证导演可自由拖拽时间轴、点击按钮，但不会误触底层博客文章。
- **快捷键绑定**（当焦点不在烘焙面板的输入框内时生效）：
  - `Space`：播放/暂停；
  - `ArrowLeft` / `ArrowRight`：步进 `-1` / `+1` 帧；配合 `Shift` 步进 `-1000ms` / `+1000ms`；
  - `[` / `]`：跳转到上一句 / 下一句台词起点；
  - `1`~`9`：跳转到第 1~9 个 `segment` 起点；
  - `L`：切换当前 `segment` 循环播放；
  - `H`：折叠/展开底部控制栏。
- **剧本热重载（F10）**：
  `vitePluginStudioFs.ts` 利用 Vite 内置的 `server.watcher` 监听 `studio/scripts/*.script.json` 与 `studio/music/*.json`。文件保存时通过 `server.ws.send({ type: 'custom', event: 'studio:script-update' })` 通知前端；`useStudioStore` 收到事件后重新拉取 JSON、重跑 `compileTimeline()`，并调用 `frameClock.seek(currentTimeMs)` 原地刷新到当前时刻 $t$。

---

## 6. 音乐预烘焙后端子系统（回应 PRD §6, §7.4 & §10 #8）

### 6.1 同步/异步衔接决策：`requests` 替代 `aiohttp`，局部 `asyncio.run` 调用 SMTC

**问题背景（PRD §10 #8）**：
`ncm-lyrics-streamer` 原项目基于异步循环运行，`lyric_fetcher.py` 使用 `aiohttp`，`media_listener.py` 使用 `winsdk` 的 `await SMTCManager.request_async()`；而博客后端是同步的 Flask WSGI 应用。

**权衡与选型**：

- **针对网易云 HTTP 请求（`lyric_baker.py`）**：
  烘焙是导演在面板中低频触发的操作（一次烤 1~10 首歌）。原 `lyric_fetcher.py` 仅有 2 个 HTTP GET 接口（搜歌 `api/search/get/web` 与抓词 `api/song/lyric`，外加补充单曲详情 `api/song/detail` 以支持直接按歌曲 ID 烘焙时获取歌名/歌手/时长）。
  将这 3 个请求改为使用 `requests.Session` 同步调用，**不仅省去了在 Flask 路由中维护后台 `asyncio` 事件循环与跨线程 `ClientSession` 的复杂度，还直接减少了 `aiohttp` 这一重度依赖**。
- **针对 Windows SMTC 识别（`smtc_helper.py`）**：
  `winsdk` 的 WinRT 异步方法（`request_async()`、`try_get_media_properties_async()`）是单次协程，无连接池状态。在 Flask 同步路由中直接通过 `asyncio.run(get_current_smtc_track())` 一次性执行并返回字典即可，耗时 $< 30\text{ms}$。

### 6.2 依赖隔离与平台優雅降级

新建 `backend/requirements-studio.txt`（不修改 `backend/requirements.txt`）：

```txt
requests>=2.31.0
winsdk>=1.0.0b10; sys_platform == "win32"
```

在 `backend/studio/smtc_helper.py` 中保留 `media_listener.py` 原有的三层降级链：

1. 尝试导入 `winsdk` / `winrt`：成功则 `HAS_SMTC = True`；
2. 若在 Windows 上未安装 `winsdk`，但存在 `ctypes.windll.user32`，回退至窗口标题扫描 `_get_window_title_fallback()`（扫描 `cloudmusic.exe` 窗口标题 `"歌名 - 歌手"`）；
3. 若在非 Windows 平台，则 `HAS_SMTC = False`，`/api/studio/music/capabilities` 返回 `{ "smtc_available": false }`，前端 `<MusicBakePanel />` 自动隐藏「🎧 识别当前播放」按钮（PRD §6.1.1）。

### 6.3 本机回环安全守卫（回应 PRD §6.1.1）

虽然 `backend/app.py` 默认 `host="0.0.0.0"`，但制片厂烘焙接口具有写本地磁盘的能力，且无需 JWT 登录。为此，在 `studio_bp` 的 `before_request` 钩子中强制校验客户端来源 IP，且免除 `Flask-Limiter` 的全局限流误伤：

```python
# backend/studio/__init__.py
from flask import Blueprint, request, abort

studio_bp = Blueprint("studio", __name__)

ALLOWED_LOCAL_IPS = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

@studio_bp.before_request
def restrict_to_localhost():
    # 注意：不读取 X-Forwarded-For，直接检查底层 socket 对端地址或 loopback
    remote = request.remote_addr or ""
    if remote not in ALLOWED_LOCAL_IPS:
        abort(403, description="Studio API is restricted to localhost only.")
```

并在 `backend/routes/__init__.py` 末尾以可选方式挂载（若未安装 studio 依赖也不影响主站启动）：

```python
    # Studio 制片厂本地扩展路由（仅 studio 分支存在）
    try:
        from studio import studio_bp
        app.register_blueprint(studio_bp, url_prefix='/api/studio')
    except ImportError:
        pass
```

### 6.4 `/api/studio/*` 接口契约（支撑 PRD §7.4 烘焙面板）

| 方法与路径                           | 用途                                                                        | 请求参数 / Body                                          | 响应结构                                                                                                                                                                               |
| :----------------------------------- | :-------------------------------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/studio/music/capabilities` | 查询环境能力与已烘焙曲库列表                                                | 无                                                       | `{ smtc_available: boolean, tracks: BakedMetaSummary[] }`                                                                                                                              |
| `GET /api/studio/music/smtc`         | 读取当前系统正在播放的曲目（SMTC / 窗口标题）                               | 无                                                       | `{ status: 'playing'\|'paused'\|'stopped', title, artist, album, duration_ms }`                                                                                                        |
| `POST /api/studio/music/search`      | 按关键词搜歌，返回候选列表供用户手动挑选（PRD §7.4 禁止盲选第一首）         | `{ query: string, limit?: 8 }`                           | `{ candidates: Array<{ song_id, title, artist, album, duration_ms }> }`                                                                                                                |
| `POST /api/studio/music/bake`        | 按确定的网易云 `song_id` 抓取歌词、解析双语并写入 `studio/music/<ref>.json` | `{ song_id: number, ref?: string, overwrite?: boolean }` | 若文件已存在且 `overwrite !== true`，返回 `409 { status: 'exists', ref, existing_meta }` 供前端弹出「覆盖 / 跳过」确认；成功后返回 `200 { status: 'baked', ref, data: MusicBakeJson }` |
| `GET /api/studio/music/<ref>`        | 预览指定已烘焙歌曲的完整 JSON（供面板滚动预览歌词时间戳）                   | 路径参数 `ref`                                           | `MusicBakeJson`                                                                                                                                                                        |

> **按 ID 直接烘焙的元数据补全说明**：
> 原 `lyric_fetcher.py` 只有 `search_song` 会返回歌名、歌手和时长，`fetch_lyrics_by_id` 只返回 LRC 文本。当用户在面板直接输入数字歌曲 ID（如 `1234567`）时，`lyric_baker.py` 会先调用网易云单曲详情接口 `https://music.163.com/api/song/detail/?id={song_id}&ids=[{song_id}]` 提取 `title`、`artist`、`album`、`duration_ms`，若未指定自定义 `ref`，默认生成 `ncm-<song_id>`（或规范化文件名），再合并 `LyricParser.parse_full_lyrics` 的结果落盘为符合 PRD §6.2 的 JSON 文件。

---

## 7. 分段离线渲染管线与清单生成（回应 PRD §3.1 F9, F9.1, F12 & §10 #3）

### 7.1 命令行接口设计（`frontend/scripts/studio-render.mjs`）

在 `frontend/package.json` 中注册 `"studio:render": "node scripts/studio-render.mjs"`，支持以下参数：

```bash
# 渲染指定剧本的全部切分段落（若启用 --incremental 则跳过 hash 未变的分段）
npm run studio:render -- --script ncm-lyrics-tutorial

# 仅重渲某一个或几个指定分段（回应 PRD US3：改一句台词只重渲对应段）
npm run studio:render -- --script ncm-lyrics-tutorial --segment install,config

# 覆盖编码器或帧率（默认读取 studio/studio.config.json）
npm run studio:render -- --script ncm-lyrics-tutorial --codec h264_nvenc --fps 30
```

### 7.2 零临时文件：Playwright 内存截帧 → FFmpeg `image2pipe` 管道流

在基准脚本 `studio-bench.mjs` 中，截图先写成磁盘上的 `frame_%05d.png` 再调 FFmpeg，5 分钟视频（9000 帧）会产生近 10GB 临时 PNG 读写。
正式渲染管线改为**内存 Buffer 直通 FFmpeg `stdin` 管道（Zero Disk Intermediate）**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        studio-render.mjs (Node.js)                          │
│                                                                             │
│  1. 读取 studio.config.json + 剧本 JSON + 关联的 music/*.json                 │
│  2. 运行 L1/L2 静态校验；计算每个 segment 的输入 Hash                         │
│  3. 启动 Chromium Headless (1920×1080, deviceScaleFactor=1, D3D11 GPU 合成)  │
│  4. 导航至 http://localhost:5173/articles/<cat>/<slug>?studio=<id>          │
│  5. 等待 window.__studio.ready() 并执行 L3 DOM 定位器校验（失败则立即中止）     │
│                                                                             │
│  6. 对每个目标分段 seg (startFrame .. endFrame - 1):                         │
│     ├─ spawn('ffmpeg', ['-f', 'image2pipe', '-vcodec', 'png',               │
│     │                   '-framerate', fps, '-i', '-', ...codecArgs, outMp4])│
│     ├─ for frameIdx = seg.startFrame to seg.endFrame - 1:                   │
│     │    ├─ const t = (frameIdx / fps) * 1000                               │
│     │    ├─ await page.evaluate((ms) => window.__studio.seek(ms), t)        │
│     │    ├─ const pngBuffer = await page.screenshot({ type: 'png' })        │
│     │    └─ await writeToStdinWithBackpressure(ffmpeg.stdin, pngBuffer)     │
│     └─ 关闭 ffmpeg.stdin，等待进程 exit 0，更新 manifest.json                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

**优势**：

1. 截帧与 H.264 编码在流水线上并行执行（Chromium 截第 $k+1$ 帧的同时，FFmpeg 正在编码第 $k$ 帧），编码耗时几乎被截帧耗时完全掩盖；
2. 零磁盘临时文件碎片，保护 SSD 寿命。

### 7.3 页面与渲染器握手协议 `window.__studio`

`frontend/src/studio/bridge/renderBridge.ts` 在演播室模式下向 `window.__studio` 暴露以下同步/异步控制接口，供 Playwright 调用：

```ts
export interface StudioRenderBridge {
  /** 等待文章 Markdown、字体、图片、剧本与音乐全部加载并完成首次排版 + L3 校验 */
  ready(): Promise<{
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    compiledTimeline: CompiledTimeline;
  }>;
  /** 跳转到精确毫秒 t，等待 Vue DOM 更新、Canvas 粒子重绘与双 rAF 光栅化稳定后 resolve */
  seek(timeMs: number): Promise<void>;
}
```

在 `ready()` 内部，会显式执行：

- `await document.fonts.ready`（确保字体加载完毕）；
- 强制将文章内所有 `<img loading="lazy">` 改为 `eager` 并等待 `img.decode()` 完成，防止滚动到下半部分时图片才开始解码闪烁。

### 7.4 渲染清单 `manifest.json` 规范与增量重渲（回应 PRD §3.1 F9.1, F12, US7）

每次渲染完成后，在 `studio/output/<script-id>/manifest.json` 生成或增量更新清单。

#### 7.4.1 分段确定性哈希（Segment Hash）算法（支撑 F12 增量重渲）

第 $k$ 个分段的文件内容是否变化，不仅取决于该分段自身的 `lines`，还取决于**前置分段的累计时长**（影响歌单播放到哪一句、粒子飞到哪个位置）以及**前置分段遗留的持续状态**（如上一分段末尾是否展开了 TOC、切换了亮暗主题）。
因此，`segmentHash` 对以下规范化 JSON 计算 SHA-256（取前 16 位 hex）：

```json
{
  "videoConfig": { "width": 1920, "height": 1080, "fps": 30, "zoom": 1.1 },
  "articleContentHash": "<文章 Markdown 正文 sha256>",
  "segmentStartMs": 12400,
  "enteredState": { "theme": "dark", "tocExpanded": false, "activeHeadingId": "intro", "mood": "reading" },
  "segmentDefinition": { "...本段原始 JSON..." },
  "musicSlice": [ "...本段时间内命中的烘焙音乐片段与哈希..." ]
}
```

若仅修改了最后一段的某句台词时长，前面所有分段的 `segmentHash` 均保持不变，`--incremental` 模式下直接毫秒级跳过！

#### 7.4.2 `manifest.json` 完整结构示例（支撑 PR 音轨对齐 US7）

```json
{
  "version": 1,
  "script_id": "ncm-lyrics-tutorial",
  "title": "网易云实时歌词服务 · 安装与使用",
  "rendered_at": "2026-11-07T21:30:00+08:00",
  "video": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "zoom": 1.1,
    "codec": "h264_nvenc",
    "total_duration_ms": 48500,
    "total_frames": 1455
  },
  "music_timeline": [
    {
      "track_index": 0,
      "ref": "example-song",
      "title": "示例歌曲",
      "artist": "示例歌手",
      "video_start_ms": 0,
      "video_end_ms": 30000,
      "song_start_at_ms": 42000,
      "song_end_at_ms": 72000
    },
    {
      "track_index": 1,
      "ref": "example-song-2",
      "title": "第二首示例",
      "artist": "示例歌手",
      "video_start_ms": 30000,
      "video_end_ms": 48500,
      "song_start_at_ms": 0,
      "song_end_at_ms": 18500
    }
  ],
  "segments": [
    {
      "index": 1,
      "id": "intro",
      "title": "开场",
      "file": "01-intro.mp4",
      "hash": "a94f8c2103e7b1d4",
      "start_ms": 0,
      "end_ms": 12400,
      "duration_ms": 12400,
      "start_frame": 0,
      "end_frame": 372,
      "frame_count": 372,
      "music_cues": [
        {
          "ref": "example-song",
          "title": "示例歌曲",
          "in_segment_start_ms": 0,
          "in_segment_end_ms": 12400,
          "in_video_start_ms": 0,
          "in_song_start_ms": 42000
        }
      ]
    },
    {
      "index": 2,
      "id": "install",
      "title": "第一步：安装依赖",
      "file": "02-install.mp4",
      "hash": "7c02e5b91180fa32",
      "start_ms": 12400,
      "end_ms": 35000,
      "duration_ms": 22600,
      "start_frame": 372,
      "end_frame": 1050,
      "frame_count": 678,
      "music_cues": [
        {
          "ref": "example-song",
          "title": "示例歌曲",
          "in_segment_start_ms": 0,
          "in_segment_end_ms": 17600,
          "in_video_start_ms": 12400,
          "in_song_start_ms": 54400
        },
        {
          "ref": "example-song-2",
          "title": "第二首示例",
          "in_segment_start_ms": 17600,
          "in_segment_end_ms": 22600,
          "in_video_start_ms": 30000,
          "in_song_start_ms": 0
        }
      ]
    }
  ]
}
```

---

## 8. 工程初始化与分阶段施工路线（交接主力开发）

### 8.1 前置依赖安装步骤（交由用户在终端执行）

制片厂仅需补充极少量本地开发依赖：

1. **前端补充 JSON Schema 校验器 `ajv`**：
   ```powershell
   cd C:\Users\windchan\Documents\blog0fwindchan-studio\frontend
   npm install ajv
   ```
2. **后端安装制片厂专属依赖 `requirements-studio.txt`（待文件创建后执行）**：
   ```powershell
   cd C:\Users\windchan\Documents\blog0fwindchan-studio\backend
   .\venv\Scripts\activate
   pip install -r requirements-studio.txt
   ```

### 8.2 主力开发分步施工里程碑（Milestone 1 ~ 5）

为便于逐步验证与单元测试，建议主力开发按以下 **5 个里程碑** 顺序推进：

| 里程碑                           | 施工范围                                                                                                                                                                                                                                               | 可验证的交付标准                                                                                                                                                 |
| :------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1：契约与底座初始化**         | 1. 更新 `.gitignore`<br>2. 创建 `studio/schema/*.schema.json`、`studio/scripts/example.script.json`、`studio/music/example-song.json`、`studio/studio.config.example.json`<br>3. 实现 `vitePluginStudioFs.ts` 并在 `vite.config.ts` 挂载               | 访问 `http://localhost:5173/__studio_fs/scripts/example.script.json` 能正确返回 JSON；`git status` 不出现被忽略的私人文件                                        |
| **M2：纯函数引擎层（含单测）**   | 实现 `frontend/src/studio/engine/` 下全部纯 TS 模块：<br>- `seededRandom.ts`、`easing.ts`<br>- `lyricMatcher.ts`（對拍测试）<br>- `scriptValidator.ts`<br>- `timelineCompiler.ts` & `stateDeriver.ts`                                                  | 运行 `npm run test:unit` 全部通过：验证任意时刻 $t$ 的台词/情绪/滚动/歌单连播/15s outro 推导结果与手算预期一致，Schema 错误能精确给出路径                        |
| **M3：演播室舞台与 UI 组件**     | 1. 实现 `studioPiniaPlugin.ts`（Toast 拦截 + 设置隔离）与主题覆写<br>2. 实现 `locatorResolver.ts`、`pageStageDriver.ts`、打字机快照揭示、粒子确定性步进<br>3. 实现 `StudioTocPet.vue`、`StudioLyricBar.vue`、`StudioToastLayer.vue`、`studioStage.css` | 浏览器访问文章页带 `?studio=example`，画面完成清场，640px 字幕框、顶栏歌词条、自动署名 Toast 正常运作，控制台调用 `__studio.seek(15000)` 画面在 200ms 内精确就位 |
| **M4：音乐烘焙后端与导演控制栏** | 1. 实现 `backend/studio/`（`lyric_parser.py`、`lyric_baker.py`、`smtc_helper.py`、`routes.py`）并挂载蓝图<br>2. 实现 `DirectorBar.vue` 与 `MusicBakePanel.vue`                                                                                         | 访问 `?studio=example&director=1`，支持时间轴拖拽、快捷键跳段/跳句、查看被拦截的系统 Toast，且能在烘焙面板搜歌/SMTC 识别并生成 `studio/music/<id>.json`          |
| **M5：分段离线渲染与清单**       | 实现 `frontend/scripts/studio-render.mjs` 与 `renderBridge.ts`                                                                                                                                                                                         | 执行 `npm run studio:render -- --script example`，在 `studio/output/example/` 下产出各分段 `.mp4` 与 `manifest.json`；同一分段连续渲染两次帧画面一致             |
