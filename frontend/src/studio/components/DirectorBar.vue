<!-- frontend/src/studio/components/DirectorBar.vue -->
<template>
  <div class="director-layer">
    <!-- 浮动面板：音乐预烘焙 -->
    <MusicBakePanel v-if="showBakePanel" @close="showBakePanel = false" />

    <!-- 浮动面板：被拦截的系统 Toast 列表 -->
    <div v-if="showSystemToastPanel" class="system-toast-panel" @keydown.stop>
      <div class="panel-header">
        <span>🔔 已拦截的博客系统消息 ({{ studioStore.capturedSystemToasts.length }})</span>
        <div class="panel-header-actions">
          <button class="mini-action-btn" @click="studioStore.clearCapturedToasts()">
            清空
          </button>
          <button class="mini-action-btn" @click="showSystemToastPanel = false">
            关闭
          </button>
        </div>
      </div>
      <div v-if="studioStore.capturedSystemToasts.length === 0" class="empty-msg">
        演播室模式下暂未拦截到任何系统自发 Toast
      </div>
      <div v-else class="captured-toast-list">
        <div
          v-for="item in studioStore.capturedSystemToasts"
          :key="item.id"
          class="captured-toast-row"
          :class="item.type"
        >
          <span class="cap-time">[{{ formatTimeMs(item.capturedAtTimeMs) }}]</span>
          <span class="cap-type">{{ item.type.toUpperCase() }}</span>
          <span class="cap-text">{{ item.message }}</span>
        </div>
      </div>
    </div>

    <!-- 折叠态迷你唤醒条 -->
    <div v-if="isCollapsed" class="director-collapsed-pill">
      <button class="ctrl-btn" @click="clock.togglePlay()" title="空格：播放/暂停">
        <i class="fas" :class="clock.isPlaying.value ? 'fa-pause' : 'fa-play'"></i>
      </button>
      <span class="time-readout">{{ formatTimeMs(currentTimeMs) }}</span>
      <button class="ctrl-btn" @click="isCollapsed = false" title="按 H 展开导演栏">
        展开导演栏 [H]
      </button>
    </div>

    <!-- 完整底部导演预览控制栏 -->
    <div v-else class="director-bar">
      <!-- 校验错误横幅 -->
      <div v-if="studioStore.loadError || studioStore.allIssues.length > 0" class="issues-strip">
        <span v-if="studioStore.loadError" class="issue-chip error">
          ❌ {{ studioStore.loadError }}
        </span>
        <span
          v-for="(iss, idx) in studioStore.allIssues.slice(0, 4)"
          :key="idx"
          class="issue-chip"
          :class="iss.level"
          :title="`${iss.path}: ${iss.message}`"
        >
          {{ iss.level === 'error' ? '❌' : '⚠️' }} [{{ iss.layer }}] {{ iss.path }}:
          {{ iss.message }}
        </span>
      </div>

      <!-- 第 1 行：控制按钮与读数 -->
      <div class="bar-top-row">
        <div class="left-controls">
          <button
            class="ctrl-btn primary"
            @click="clock.togglePlay()"
            title="播放 / 暂停 (Space)"
          >
            <i class="fas" :class="clock.isPlaying.value ? 'fa-pause' : 'fa-play'"></i>
          </button>
          <button
            class="ctrl-btn"
            @click="clock.stepFrames(-1)"
            title="退后 1 帧 (←)"
          >
            <i class="fas fa-step-backward"></i>
          </button>
          <button
            class="ctrl-btn"
            @click="clock.stepFrames(1)"
            title="前进 1 帧 (→)"
          >
            <i class="fas fa-step-forward"></i>
          </button>

          <span class="time-readout">
            {{ formatTimeMs(currentTimeMs) }} / {{ formatTimeMs(totalDurationMs) }}
          </span>

          <span class="frame-readout">
            第 {{ clock.currentFrame.value }} 帧
          </span>

          <span class="fps-badge">{{ clock.fps.value }}fps</span>

          <button
            class="ctrl-btn"
            :class="{ active: isLoopingSegment }"
            @click="toggleSegmentLoop"
            title="在当前分段内循环播放 (L)"
          >
            <i class="fas fa-retweet"></i>
            <span>本段循环 [L]</span>
          </button>
        </div>

        <div class="right-controls">
          <button
            class="ctrl-btn"
            :class="{ active: showBakePanel }"
            @click="showBakePanel = !showBakePanel"
            title="打开音乐预烘焙工坊"
          >
            🎵 烘焙
          </button>

          <button
            class="ctrl-btn"
            :class="{ active: showSystemToastPanel }"
            @click="showSystemToastPanel = !showSystemToastPanel"
            title="查看被演播室拦截的系统 Toast"
          >
            🔔 {{ studioStore.capturedSystemToasts.length }}
          </button>

          <button
            class="ctrl-btn"
            @click="handleReloadScript"
            title="重新读取并编译剧本 JSON"
          >
            ⟳ 重载剧本
          </button>

          <button
            class="ctrl-btn"
            @click="isCollapsed = true"
            title="折叠控制栏 (H)"
          >
            隐藏 [H]
          </button>
        </div>
      </div>

      <!-- 第 2 行：分段色块与台词刻度条 -->
      <div v-if="timeline" class="timeline-tracks">
        <!-- 分段色块 -->
        <div class="segments-track">
          <div
            v-for="seg in timeline.segments"
            :key="seg.id"
            class="segment-block"
            :class="{ active: currentLine?.segmentIndex === seg.index }"
            :style="{
              left: `${(seg.startMs / Math.max(1, totalDurationMs)) * 100}%`,
              width: `${(seg.durationMs / Math.max(1, totalDurationMs)) * 100}%`,
            }"
            @click="clock.seek(seg.startMs)"
            :title="`点击跳至分段 #${seg.index + 1}: ${seg.title} (${formatTimeMs(seg.startMs)})`"
          >
            <span class="seg-block-label">{{ seg.index + 1 }}. {{ seg.id }}</span>
          </div>
        </div>

        <!-- 台词刻度 -->
        <div class="lines-tick-track">
          <div
            v-for="ln in timeline.lines"
            :key="ln.globalLineIndex"
            class="line-tick"
            :class="[
              getLineIssueClass(ln.globalLineIndex),
              { current: currentLine?.globalLineIndex === ln.globalLineIndex },
            ]"
            :style="{
              left: `${(ln.startMs / Math.max(1, totalDurationMs)) * 100}%`,
              width: `${Math.max(0.4, (ln.speakDurationMs / Math.max(1, totalDurationMs)) * 100)}%`,
            }"
            :title="getLineTooltip(ln)"
            @click="clock.seek(ln.startMs)"
          ></div>
        </div>

        <!-- 可拖拽播放头滑块 -->
        <input
          type="range"
          class="playhead-slider"
          min="0"
          :max="Math.max(1, totalDurationMs)"
          step="10"
          :value="currentTimeMs"
          @input="handleSliderInput"
        />
      </div>

      <!-- 第 3 行：当前台词元信息与导演备注 -->
      <div class="bar-bottom-info">
        <template v-if="currentLine && currentSegment">
          <span class="info-item">
            当前：<strong>{{ currentSegment.id }}</strong> / 第
            {{ currentLine.lineIndex + 1 }} 句
          </span>
          <span class="info-item">
            mood=<code>{{ currentLine.mood }}</code>
          </span>
          <span class="info-item">
            duration=<code>{{ currentLine.speakDurationMs }}ms</code>
            ({{ currentLine.durationSource === 'manual' ? '手写' : '推算' }})
          </span>
          <span v-if="currentLine.note" class="info-note">
            💡 备注：{{ currentLine.note }}
          </span>
        </template>
        <span v-else class="info-item">等待剧本就绪…</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 导演实时预览控制栏（DirectorBar）。
 *
 * 仅在 `?studio=<id>&director=1` 时激活（离线渲染不带 `director` 参数，控制栏不进成片）。
 * 支持时间轴拖拽、分段/单句跳转、快捷键控制、L1~L3 校验错误悬停定位、系统消息拦截箱与音乐烘焙面板。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { studioFrameClock } from '../engine/frameClock'
import { useStudioStore } from '../stores/useStudioStore'
import type { CompiledLine } from '../types/script'
import MusicBakePanel from './MusicBakePanel.vue'

const studioStore = useStudioStore()
const clock = studioFrameClock

const isCollapsed = ref(false)
const showBakePanel = ref(false)
const showSystemToastPanel = ref(false)

const timeline = computed(() => studioStore.compiledTimeline)
const currentTimeMs = computed(() => clock.currentTimeMs.value)
const totalDurationMs = computed(() => timeline.value?.totalDurationMs ?? 0)

const currentLine = computed<CompiledLine | null>(() => {
  if (!timeline.value) return null
  const idx =
    studioStore.currentFrameState?.pet.currentGlobalLineIndex ?? 0
  return timeline.value.lines[idx] ?? null
})

const currentSegment = computed(() => {
  if (!timeline.value || !currentLine.value) return null
  return timeline.value.segments[currentLine.value.segmentIndex] ?? null
})

const isLoopingSegment = computed(() => clock.loopRange.value !== null)

function handleSliderInput(e: Event) {
  const target = e.target as HTMLInputElement
  const ms = Number(target.value)
  clock.pause()
  clock.seek(ms)
}

function toggleSegmentLoop() {
  if (clock.loopRange.value) {
    clock.loopRange.value = null
  } else if (currentSegment.value) {
    clock.loopRange.value = {
      startMs: currentSegment.value.startMs,
      endMs: currentSegment.value.endMs,
    }
  }
}

async function handleReloadScript() {
  if (studioStore.scriptId) {
    await studioStore.loadStudioScript(studioStore.scriptId, true)
  }
}

function jumpToLineDelta(delta: number) {
  if (!timeline.value || !currentLine.value) return
  const nextIdx = Math.max(
    0,
    Math.min(
      timeline.value.lines.length - 1,
      currentLine.value.globalLineIndex + delta,
    ),
  )
  const targetLine = timeline.value.lines[nextIdx]
  if (targetLine) {
    clock.pause()
    clock.seek(targetLine.startMs)
  }
}

function getLineIssueClass(globalLineIndex: number): string {
  const matching = studioStore.allIssues.filter(
    (i) => i.globalLineIndex === globalLineIndex,
  )
  if (matching.some((i) => i.level === 'error')) return 'has-error'
  if (matching.some((i) => i.level === 'warning')) return 'has-warning'
  return ''
}

function getLineTooltip(ln: CompiledLine): string {
  const matching = studioStore.allIssues.filter(
    (i) => i.globalLineIndex === ln.globalLineIndex,
  )
  const base = `[#${ln.globalLineIndex + 1}] ${ln.text} (${ln.speakDurationMs}ms)`
  if (matching.length === 0) return base
  return (
    base +
    '\n' +
    matching.map((m) => `${m.level.toUpperCase()}: ${m.path} - ${m.message}`).join('\n')
  )
}

function formatTimeMs(ms: number): string {
  const safe = Math.max(0, Math.round(ms || 0))
  const minutes = Math.floor(safe / 60000)
  const seconds = Math.floor((safe % 60000) / 1000)
  const millis = safe % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function handleKeydown(e: KeyboardEvent) {
  const activeTag = (document.activeElement?.tagName || '').toLowerCase()
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
    if (e.target && !(e.target as HTMLElement).classList.contains('playhead-slider')) {
      return
    }
  }

  switch (e.key) {
    case ' ': {
      e.preventDefault()
      clock.togglePlay()
      break
    }
    case 'ArrowLeft': {
      e.preventDefault()
      if (e.shiftKey) {
        clock.pause()
        clock.seek(currentTimeMs.value - 1000)
      } else {
        clock.stepFrames(-1)
      }
      break
    }
    case 'ArrowRight': {
      e.preventDefault()
      if (e.shiftKey) {
        clock.pause()
        clock.seek(currentTimeMs.value + 1000)
      } else {
        clock.stepFrames(1)
      }
      break
    }
    case '[': {
      e.preventDefault()
      jumpToLineDelta(-1)
      break
    }
    case ']': {
      e.preventDefault()
      jumpToLineDelta(1)
      break
    }
    case 'l':
    case 'L': {
      e.preventDefault()
      toggleSegmentLoop()
      break
    }
    case 'h':
    case 'H': {
      e.preventDefault()
      isCollapsed.value = !isCollapsed.value
      break
    }
    default: {
      if (/^[1-9]$/.test(e.key) && timeline.value) {
        const segIdx = Number(e.key) - 1
        const seg = timeline.value.segments[segIdx]
        if (seg) {
          e.preventDefault()
          clock.pause()
          clock.seek(seg.startMs)
        }
      }
      break
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.director-layer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10000;
  pointer-events: none;
  user-select: none;
  font-family: system-ui, -apple-system, sans-serif;
}

.director-bar {
  pointer-events: auto;
  background: rgba(9, 13, 24, 0.92);
  color: #e2e8f0;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  backdrop-filter: blur(14px);
  padding: 8px 20px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 13px;
}

.director-collapsed-pill {
  pointer-events: auto;
  position: fixed;
  left: 20px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #f8fafc;
  font-size: 12px;
}

.issues-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.issue-chip {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  max-width: 480px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.issue-chip.error {
  background: rgba(239, 68, 68, 0.22);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #fca5a5;
}

.issue-chip.warning {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fcd34d;
}

.bar-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.left-controls,
.right-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 5px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(30, 41, 59, 0.75);
  color: #f1f5f9;
  font-size: 12px;
  cursor: pointer;
}

.ctrl-btn:hover {
  background: rgba(51, 65, 85, 0.9);
}

.ctrl-btn.primary {
  background: #3b82f6;
  border-color: #60a5fa;
  color: #ffffff;
}

.ctrl-btn.active {
  background: rgba(16, 185, 129, 0.25);
  border-color: #10b981;
  color: #6ee7b7;
}

.time-readout,
.frame-readout {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  color: #f8fafc;
}

.fps-badge {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.16);
  color: #7dd3fc;
  font-size: 11px;
  font-family: monospace;
}

.timeline-tracks {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.segments-track {
  position: relative;
  height: 20px;
  background: rgba(30, 41, 59, 0.6);
  border-radius: 4px;
  overflow: hidden;
}

.segment-block {
  position: absolute;
  top: 0;
  bottom: 0;
  padding: 0 6px;
  display: flex;
  align-items: center;
  border-right: 1px solid rgba(15, 23, 42, 0.9);
  background: rgba(59, 130, 246, 0.22);
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
}

.segment-block.active {
  background: rgba(59, 130, 246, 0.5);
  color: #ffffff;
  font-weight: 700;
}

.lines-tick-track {
  position: relative;
  height: 10px;
  background: rgba(15, 23, 42, 0.8);
  border-radius: 3px;
  overflow: hidden;
}

.line-tick {
  position: absolute;
  top: 1px;
  bottom: 1px;
  background: rgba(148, 163, 184, 0.45);
  border-radius: 2px;
  cursor: pointer;
}

.line-tick.current {
  background: #38bdf8;
}

.line-tick.has-warning {
  background: #f59e0b !important;
}

.line-tick.has-error {
  background: #ef4444 !important;
}

.playhead-slider {
  width: 100%;
  margin: 0;
  cursor: pointer;
  accent-color: #38bdf8;
}

.bar-bottom-info {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: #94a3b8;
}

.bar-bottom-info code {
  color: #7dd3fc;
  font-family: monospace;
}

.info-note {
  color: #fde047;
}

.system-toast-panel {
  pointer-events: auto;
  position: fixed;
  right: 28px;
  bottom: 158px;
  width: 480px;
  max-height: 320px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  padding: 12px 14px;
  color: #f8fafc;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  overflow-y: auto;
  font-size: 12px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-weight: 700;
}

.panel-header-actions {
  display: flex;
  gap: 6px;
}

.mini-action-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: transparent;
  color: #cbd5e1;
  font-size: 11px;
  cursor: pointer;
}

.captured-toast-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.captured-toast-row {
  display: flex;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  background: rgba(30, 41, 59, 0.65);
}

.cap-time {
  color: #64748b;
  font-family: monospace;
}

.cap-type {
  font-weight: 700;
  color: #38bdf8;
}

.empty-msg {
  color: #64748b;
  font-style: italic;
}
</style>
