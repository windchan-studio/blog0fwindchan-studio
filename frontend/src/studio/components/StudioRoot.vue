<!-- frontend/src/studio/components/StudioRoot.vue -->
<template>
  <div v-if="studioStore.isStudioMode" class="studio-root-overlay">
    <!-- 1. 目标元素高亮框浮层 (glow / box) -->
    <div class="studio-highlights-layer" aria-hidden="true">
      <div
        v-for="rect in studioStore.activeHighlightRects"
        :key="rect.path"
        class="studio-highlight-box"
        :class="`style-${rect.style}`"
        :style="{
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          opacity: rect.opacity,
        }"
      ></div>
    </div>

    <!-- 2. 640px 演播室字幕框与步骤导航 -->
    <StudioTocPet />

    <!-- 3. 帧时钟驱动的剧本 Toast 渲染层 -->
    <StudioToastLayer />

    <!-- 4. 导演预览控制栏（仅 ?director=1 时挂载，离线渲染不出现） -->
    <DirectorBar v-if="studioStore.isDirectorMode" />
  </div>
</template>

<script setup lang="ts">
/**
 * 演播室顶层舞台挂载根组件（StudioRoot）。
 *
 * 挂载于 `App.vue` 根部（`.main-layout` 之外），负责：
 * - 监听路由参数 `?studio=<id>&director=1` 进入/退出演播室模式；
 * - 绑定 `setupStudioStageBridge` 与 `window.__studio` 离线渲染握手协议；
 * - 监听 Vite `studio:script-update` WebSocket 事件实现保存剧本即刻原地热重载（F10）。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  getArticleContentRoot,
  setupStudioStageBridge,
} from '../bridge/pageStageDriver'
import { installStudioRenderBridge } from '../bridge/renderBridge'
import { useStudioStore } from '../stores/useStudioStore'
import DirectorBar from './DirectorBar.vue'
import StudioToastLayer from './StudioToastLayer.vue'
import StudioTocPet from './StudioTocPet.vue'
import '../styles/studioStage.css'

const route = useRoute()
const studioStore = useStudioStore()

setupStudioStageBridge()
installStudioRenderBridge()

let domCheckTimer: number | null = null

function scheduleDomValidation() {
  if (domCheckTimer) clearTimeout(domCheckTimer)
  domCheckTimer = window.setTimeout(() => {
    if (!studioStore.isStudioMode) return
    const root = getArticleContentRoot()
    if (root && root.textContent && root.textContent.trim().length > 0) {
      studioStore.runDomValidationAndRefresh(root)
    } else {
      scheduleDomValidation()
    }
  }, 150)
}

watch(
  () => [route.query.studio, route.query.director, route.fullPath] as const,
  async ([studioParam, directorParam]) => {
    const id = typeof studioParam === 'string' ? studioParam.trim() : ''
    const isDirector =
      directorParam === '1' ||
      directorParam === 'true' ||
      (Array.isArray(directorParam) && directorParam.includes('1'))

    if (id) {
      if (!studioStore.isStudioMode || studioStore.scriptId !== id) {
        await studioStore.enterStudioMode(id, isDirector)
      } else {
        studioStore.isDirectorMode = isDirector
      }
      scheduleDomValidation()
    } else if (studioStore.isStudioMode) {
      studioStore.exitStudioMode()
    }
  },
  { immediate: true },
)

onMounted(() => {
  // 监听 Vite 开发服务器推送的剧本/歌词 JSON 文件变更事件，原地热重载 (PRD F10)
  if (import.meta.hot) {
    import.meta.hot.on('studio:script-update', async () => {
      if (studioStore.isStudioMode && studioStore.scriptId) {
        await studioStore.loadStudioScript(studioStore.scriptId, true)
        scheduleDomValidation()
      }
    })
  }
})

onUnmounted(() => {
  if (domCheckTimer) clearTimeout(domCheckTimer)
})
</script>

<style scoped>
.studio-root-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9980;
}

.studio-highlights-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9985;
}

.studio-highlight-box {
  position: fixed;
  border-radius: 8px;
  pointer-events: none;
}

.studio-highlight-box.style-glow {
  border: 2px solid #38bdf8;
  box-shadow:
    0 0 22px rgba(56, 189, 248, 0.55),
    inset 0 0 14px rgba(56, 189, 248, 0.18);
  background: rgba(56, 189, 248, 0.06);
}

.studio-highlight-box.style-box {
  border: 3px solid #f59e0b;
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.05);
}
</style>
