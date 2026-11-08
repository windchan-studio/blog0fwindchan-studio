<!-- frontend/src/studio/components/StudioToastLayer.vue -->
<template>
  <div v-if="activeToasts.length > 0" class="studio-toast-layer" aria-live="polite">
    <div
      v-for="(group, pos) in groupedToasts"
      :key="pos"
      class="studio-toast-group"
      :class="`pos-${pos}`"
    >
      <div
        v-for="item in group"
        :key="item.id"
        class="studio-toast-item"
        :class="item.toastType"
        :style="{
          opacity: item.opacity,
          transform: `translateY(${item.translateY}px)`,
        }"
      >
        <div class="toast-icon">
          <i class="fas" :class="getIconClass(item.toastType)"></i>
        </div>
        <div class="toast-content-wrapper">
          <div class="toast-content">
            <div class="toast-message">{{ item.text }}</div>
          </div>
        </div>
        <div class="progress-bar-bg">
          <div
            class="progress-bar"
            :style="{ transform: `scaleX(${item.remainingRatio})` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 演播室剧本 Toast 独立渲染层（StudioToastLayer）。
 *
 * 复刻 `ToastItem.vue` 的视觉质感，但完全脱离 `setTimeout` 与 CSS `@keyframes`，
 * 入场/退场透明度与底部倒计时进度条均由帧时钟 `StudioFrameState.toasts` 逐帧直接绑定。
 */
import { computed } from 'vue'
import type { StudioToastPosition, StudioToastType } from '../types/script'
import type { ActiveStudioToastState } from '../types/state'
import { useStudioStore } from '../stores/useStudioStore'

const studioStore = useStudioStore()

const activeToasts = computed<ActiveStudioToastState[]>(
  () => studioStore.currentFrameState?.toasts ?? [],
)

const groupedToasts = computed(() => {
  const groups: Partial<Record<StudioToastPosition, ActiveStudioToastState[]>> = {}
  for (const t of activeToasts.value) {
    if (!groups[t.position]) {
      groups[t.position] = []
    }
    groups[t.position]!.push(t)
  }
  return groups
})

function getIconClass(type: StudioToastType): string {
  switch (type) {
    case 'success':
      return 'fa-check-circle'
    case 'warning':
      return 'fa-exclamation-triangle'
    case 'error':
      return 'fa-times-circle'
    case 'info':
    default:
      return 'fa-info-circle'
  }
}
</script>

<style scoped>
.studio-toast-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9995;
}

.studio-toast-group {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.studio-toast-group.pos-top-right {
  top: 76px;
  right: 40px;
}

.studio-toast-group.pos-top-left {
  top: 76px;
  left: 40px;
}

.studio-toast-group.pos-top-center {
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
}

.studio-toast-group.pos-bottom-left {
  bottom: 48px;
  left: 40px;
}

.studio-toast-group.pos-bottom-right {
  bottom: 48px;
  right: 40px;
}

.studio-toast-item {
  position: relative;
  width: 420px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
  background-color: var(--dark-text, #1e293b);
  border-radius: 4px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}

.studio-toast-item.success .toast-icon {
  color: #10b981;
}
.studio-toast-item.warning .toast-icon {
  color: #f59e0b;
}
.studio-toast-item.error .toast-icon {
  color: #ef4444;
}
.studio-toast-item.info .toast-icon {
  color: #3b82f6;
}

.toast-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.toast-content-wrapper {
  flex: 1;
  min-width: 0;
}

.toast-message {
  color: var(--light-text, #f8fafc);
  font-size: 16px;
  font-weight: 500;
  line-height: 1.45;
  word-break: break-word;
}

.progress-bar-bg {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
}

.progress-bar {
  height: 100%;
  width: 100%;
  transform-origin: left center;
}

.studio-toast-item.success .progress-bar {
  background: #10b981;
}
.studio-toast-item.warning .progress-bar {
  background: #f59e0b;
}
.studio-toast-item.error .progress-bar {
  background: #ef4444;
}
.studio-toast-item.info .progress-bar {
  background: #3b82f6;
}
</style>
