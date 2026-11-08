<!-- frontend/src/studio/components/StudioTocPet.vue -->
<template>
  <div
    v-if="petState && timeline"
    class="studio-toc-pet"
    :class="[`mood-${petState.mood}`]"
    :style="wrapperDynamicStyle"
  >
    <!-- 左侧 4px 情绪色条 -->
    <div class="mood-accent-bar" :style="{ backgroundColor: moodAccentColor }"></div>

    <!-- Proud 情绪气泡高光扫过层 -->
    <div
      v-if="petState.proudShineLeftPercent !== null"
      class="proud-shine-sweep"
      :style="{ left: `${petState.proudShineLeftPercent}%` }"
    ></div>

    <!-- 1. 顶部台词气泡区（wait 期间隐藏，gapMs 期间保留高度但文字为空） -->
    <div v-show="petState.bubbleVisible" class="subtitle-bubble-area">
      <!-- 情绪图标与 Cheer 星星粒子容器 -->
      <div class="mood-icon-box">
        <i
          class="fas mood-icon"
          :class="moodIconClass"
          :style="{ transform: `translateY(${petState.iconOffsetY}px)` }"
        ></i>

        <!-- Cheer 撒花星星粒子 -->
        <div v-if="petState.cheerParticles.length > 0" class="cheer-particles-layer">
          <i
            v-for="star in petState.cheerParticles"
            :key="star.id"
            class="fas fa-star cheer-star"
            :style="{
              opacity: star.opacity,
              transform: `translate(${star.x}px, ${star.y}px) scale(${star.scale}) rotate(${star.rotationDeg}deg)`,
            }"
          ></i>
        </div>
      </div>

      <!-- 台词正文（26px，最多 2 行，支持 **加粗** 与 `行内代码`） -->
      <div class="subtitle-text-box">
        <div
          class="subtitle-text-inner"
          :class="{ 'is-warning-bold': petState.mood === 'warning' }"
          :style="{
            opacity: petState.isInGap ? 0 : petState.textOpacity,
            transform: `translateY(${petState.textTranslateY}px)`,
          }"
          v-html="formattedSubtitleHtml"
        ></div>
      </div>
    </div>

    <!-- 2. 中部 TOC 目录折叠抽屉（由 tocExpandProgress [0, 1] 驱动） -->
    <div
      v-if="petState.tocExpandProgress > 0.005"
      class="studio-toc-drawer"
      :style="{
        maxHeight: `${Math.round(petState.tocExpandProgress * 260)}px`,
        opacity: petState.tocExpandProgress,
      }"
    >
      <div class="toc-drawer-title">
        <i class="fas fa-list-ul"></i>
        <span>章节导航</span>
      </div>
      <ul class="toc-list">
        <li
          v-for="item in tocItems"
          :key="item.id"
          class="toc-list-item"
          :class="[
            `level-${item.level}`,
            { 'is-active': item.id === petState.activeHeadingId },
          ]"
        >
          <span class="active-indicator"></span>
          <span class="toc-item-text">{{ item.text }}</span>
        </li>
      </ul>
    </div>

    <!-- 3. 底部教学步骤条与全局进度条 -->
    <div class="studio-steps-footer">
      <div class="steps-row">
        <div
          v-for="(seg, idx) in timeline.segments"
          :key="seg.id"
          class="step-chip"
          :class="{
            'is-done': idx < petState.currentSegmentIndex,
            'is-current': idx === petState.currentSegmentIndex,
          }"
        >
          <span class="step-badge">
            <template v-if="idx < petState.currentSegmentIndex">✓</template>
            <template v-else>{{ getCircledNumber(idx + 1) }}</template>
          </span>
          <span class="step-title">{{ seg.title }}</span>
        </div>
      </div>

      <div class="steps-progress-track">
        <div
          class="steps-progress-fill"
          :style="{
            width: `${Math.round(petState.totalStepProgress * 1000) / 10}%`,
            backgroundColor: moodAccentColor,
          }"
        ></div>
        <div
          v-for="(seg, idx) in timeline.segments"
          :key="`dot-${seg.id}`"
          class="step-node-dot"
          :class="{
            'is-reached': idx <= petState.currentSegmentIndex,
          }"
          :style="{
            left: `${(idx / Math.max(1, timeline.segments.length)) * 100}%`,
          }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 演播室专用 640px 字幕框与教学步骤导航组件（StudioTocPet）。
 *
 * 严格遵循 PRD §5.6 & §7.1 与 ARCHITECTURE §5.1：
 * - 输出画面固定宽 640px，距右 40px、距底 48px，字号 26px，行高 1.5；
 * - 支持轻量标记 `**加粗**` 与 `` `代码` ``，其余字符转义防 XSS；
 * - 全部过渡与情绪动效均由 `StudioFrameState.pet` 行内样式直接驱动。
 */
import { computed } from 'vue'
import { useStudioStore } from '../stores/useStudioStore'
import type { StudioMood } from '../types/script'

const studioStore = useStudioStore()

const timeline = computed(() => studioStore.compiledTimeline)
const petState = computed(() => studioStore.currentFrameState?.pet ?? null)
const tocItems = computed(() => studioStore.articleTocItems)

const MOOD_COLORS: Record<StudioMood, string> = {
  warning: '#f59e0b',
  success: '#10b981',
  thinking: '#3b82f6',
  cheer: '#ec4899',
  proud: '#a855f7',
  typing: '#06b6d4',
  reading: '#60a5fa',
  sleepy: '#94a3b8',
  dizzy: '#fb7185',
  shocked: '#ef4444',
}

const MOOD_ICONS: Record<StudioMood, string> = {
  warning: 'fa-exclamation-triangle',
  cheer: 'fa-star',
  thinking: 'fa-lightbulb',
  proud: 'fa-crown',
  success: 'fa-check-circle',
  typing: 'fa-keyboard',
  reading: 'fa-book-open',
  sleepy: 'fa-moon',
  dizzy: 'fa-compass',
  shocked: 'fa-bolt',
}

const moodAccentColor = computed(() => {
  const m = petState.value?.mood ?? 'reading'
  return MOOD_COLORS[m] ?? '#60a5fa'
})

const moodIconClass = computed(() => {
  const m = petState.value?.mood ?? 'reading'
  return MOOD_ICONS[m] ?? 'fa-book-open'
})

const wrapperDynamicStyle = computed(() => {
  const glow = petState.value?.successGlowIntensity ?? 0
  if (glow > 0.01) {
    return {
      boxShadow: `0 8px 28px rgba(0, 0, 0, 0.35), 0 0 ${Math.round(glow * 24)}px rgba(16, 185, 129, ${Math.round(glow * 85) / 100})`,
      borderColor: `rgba(16, 185, 129, ${0.35 + glow * 0.65})`,
    }
  }
  return {}
})

/**
 * 将台词中的 `**加粗**` 与 `` `代码` `` 转换为安全 HTML，其余字符做实体转义。
 */
function renderSubtitleTokens(raw: string): string {
  if (!raw) return '&nbsp;'
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong class="studio-sub-bold">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="studio-sub-code">$1</code>')
}

const formattedSubtitleHtml = computed(() => {
  if (!petState.value || petState.value.isInGap) {
    return '&nbsp;'
  }
  return renderSubtitleTokens(petState.value.displayText)
})

const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
function getCircledNumber(n: number): string {
  return CIRCLED_NUMS[n - 1] ?? `${n}.`
}
</script>

<style scoped>
.studio-toc-pet {
  position: fixed;
  right: 40px;
  bottom: 48px;
  width: 640px;
  z-index: 9990;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.92);
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(14px);
  pointer-events: none;
  user-select: none;
}

.mood-accent-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  z-index: 3;
}

.proud-shine-sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 28%;
  background: linear-gradient(
    105deg,
    transparent 0%,
    rgba(255, 255, 255, 0.18) 50%,
    transparent 100%
  );
  pointer-events: none;
  z-index: 2;
}

/* 1. 顶部台词气泡区 */
.subtitle-bubble-area {
  position: relative;
  min-height: 108px;
  padding: 16px 22px 16px 24px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.mood-icon-box {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.mood-icon {
  font-size: 24px;
  color: #f8fafc;
}

.mood-warning .mood-icon {
  color: #f59e0b;
}
.mood-cheer .mood-icon {
  color: #f472b6;
}
.mood-thinking .mood-icon {
  color: #60a5fa;
}
.mood-proud .mood-icon {
  color: #c084fc;
}
.mood-success .mood-icon {
  color: #34d399;
}

.cheer-particles-layer {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
}

.cheer-star {
  position: absolute;
  top: -7px;
  left: -7px;
  font-size: 14px;
  color: #fbbf24;
  filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.7));
}

.subtitle-text-box {
  flex: 1;
  min-width: 0;
  min-height: 78px;
  max-height: 78px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.subtitle-text-inner {
  width: 100%;
  font-size: 26px;
  line-height: 1.5;
  font-weight: 500;
  color: #f8fafc;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.subtitle-text-inner.is-warning-bold {
  font-weight: 700;
  color: #fef3c7;
}

.subtitle-text-inner :deep(.studio-sub-bold) {
  font-weight: 800;
  color: #fde047;
}

.subtitle-text-inner :deep(.studio-sub-code) {
  padding: 2px 8px;
  margin: 0 2px;
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  font-size: 0.88em;
  background: rgba(56, 189, 248, 0.18);
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 5px;
}

/* 2. 中部 TOC 目录折叠抽屉 */
.studio-toc-drawer {
  overflow: hidden;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(9, 14, 28, 0.65);
  padding: 0 22px 0 24px;
}

.toc-drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(148, 163, 184, 0.9);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0 0 10px;
  max-height: 210px;
  overflow: hidden;
}

.toc-list-item {
  position: relative;
  display: flex;
  align-items: center;
  padding: 5px 8px 5px 12px;
  font-size: 15px;
  line-height: 1.4;
  color: rgba(203, 213, 225, 0.8);
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-list-item.level-3 {
  padding-left: 26px;
  font-size: 14px;
}

.toc-list-item.is-active {
  color: #ffffff;
  font-weight: 600;
  background: rgba(59, 130, 246, 0.18);
}

.active-indicator {
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  border-radius: 2px;
  background: transparent;
}

.toc-list-item.is-active .active-indicator {
  background: #38bdf8;
}

/* 3. 底部步骤条与进度条 */
.studio-steps-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(15, 23, 42, 0.96);
  padding: 10px 22px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.steps-row {
  display: flex;
  align-items: center;
  gap: 14px;
  overflow: hidden;
  white-space: nowrap;
}

.step-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  color: rgba(148, 163, 184, 0.78);
  flex-shrink: 0;
}

.step-chip.is-done {
  color: #34d399;
}

.step-chip.is-current {
  color: #ffffff;
  font-weight: 700;
}

.step-badge {
  font-size: 14px;
}

.steps-progress-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  overflow: visible;
}

.steps-progress-fill {
  height: 100%;
  border-radius: 2px;
}

.step-node-dot {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: rgba(148, 163, 184, 0.5);
  border: 1.5px solid #0f172a;
}

.step-node-dot.is-reached {
  background: #f8fafc;
}
</style>
