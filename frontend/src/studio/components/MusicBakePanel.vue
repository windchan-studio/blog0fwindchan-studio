<!-- frontend/src/studio/components/MusicBakePanel.vue -->
<template>
  <div class="music-bake-panel" @keydown.stop>
    <div class="bake-header">
      <div class="bake-title">
        <i class="fas fa-music"></i>
        <span>🎵 音乐预烘焙工坊</span>
      </div>
      <button class="bake-close-btn" @click="$emit('close')" title="关闭面板">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <!-- 输入与操作区 -->
    <div class="bake-input-section">
      <label class="input-label">
        输入网易云歌曲 ID 或「歌名 歌手」（每行一首）：
      </label>
      <textarea
        v-model="rawInput"
        class="bake-textarea"
        rows="3"
        placeholder="例如：&#10;1974443814&#10;群青 YOASOBI"
      ></textarea>

      <div class="bake-action-bar">
        <button
          class="bake-btn primary"
          :disabled="isSubmitting || !rawInput.trim()"
          @click="handleBatchSubmit"
        >
          <i class="fas" :class="isSubmitting ? 'fa-spinner fa-spin' : 'fa-fire'"></i>
          <span>{{ isSubmitting ? '处理中…' : '开始烘焙' }}</span>
        </button>

        <button
          v-if="smtcAvailable"
          class="bake-btn secondary"
          :disabled="isDetectingSmtc"
          @click="handleDetectSmtc"
        >
          <i class="fas fa-headphones"></i>
          <span>{{ isDetectingSmtc ? '识别中…' : '🎧 识别当前播放' }}</span>
        </button>

        <button class="bake-btn ghost" @click="fetchCapabilities">
          <i class="fas fa-sync-alt"></i>
          <span>刷新曲库</span>
        </button>
      </div>

      <div v-if="smtcMessage" class="smtc-banner">
        {{ smtcMessage }}
      </div>
    </div>

    <!-- 任务队列（搜索候选选择 / 覆盖确认 / 进行中状态） -->
    <div v-if="tasks.length > 0" class="bake-tasks-section">
      <div class="section-subtitle">当前烘焙任务</div>
      <div v-for="task in tasks" :key="task.uid" class="task-card">
        <div class="task-row">
          <span class="task-status-icon">
            <template v-if="task.status === 'pending'">⏳</template>
            <template v-else-if="task.status === 'choose'">🔍</template>
            <template v-else-if="task.status === 'confirm-overwrite'">⚠️</template>
            <template v-else-if="task.status === 'success'">✅</template>
            <template v-else-if="task.status === 'skipped'">⏭️</template>
            <template v-else>❌</template>
          </span>
          <span class="task-query">{{ task.query }}</span>
          <span class="task-msg">{{ task.message }}</span>
        </div>

        <!-- 歌名搜索候选列表（禁止自动盲选第一个，需用户手动点击确认） -->
        <div
          v-if="task.status === 'choose' && task.candidates && task.candidates.length > 0"
          class="candidate-list"
        >
          <div
            v-for="cand in task.candidates"
            :key="cand.song_id"
            class="candidate-item"
          >
            <div class="cand-info">
              <span class="cand-title">{{ cand.title }}</span>
              <span class="cand-artist">- {{ cand.artist }}</span>
              <span v-if="cand.album" class="cand-album">《{{ cand.album }}》</span>
              <span class="cand-dur">{{ formatDuration(cand.duration_ms) }}</span>
              <span class="cand-id">ID: {{ cand.song_id }}</span>
            </div>
            <button
              class="cand-select-btn"
              @click="bakeBySongId(task, cand.song_id, false)"
            >
              选这首烤制
            </button>
          </div>
        </div>

        <!-- 重复烘焙时的「覆盖 / 跳过」确认 -->
        <div
          v-if="task.status === 'confirm-overwrite' && task.songId"
          class="overwrite-actions"
        >
          <span>文件 <code>{{ task.ref }}.json</code> 已存在：</span>
          <button
            class="mini-btn warn"
            @click="bakeBySongId(task, task.songId!, true)"
          >
            覆盖
          </button>
          <button class="mini-btn" @click="skipTask(task)">跳过</button>
        </div>
      </div>
    </div>

    <!-- 已烘焙本地曲库列表 -->
    <div class="baked-library-section">
      <div class="section-subtitle">
        已烘焙本地曲库（点击 ref 复制到剧本 <code>music.tracks</code>）
      </div>
      <div v-if="bakedTracks.length === 0" class="empty-hint">
        暂无已烘焙歌曲
      </div>
      <div v-else class="baked-list">
        <div
          v-for="item in bakedTracks"
          :key="item.id"
          class="baked-item"
        >
          <div class="baked-main">
            <span class="status-check">✅</span>
            <button
              class="ref-badge"
              @click="copyRef(item.id)"
              title="点击复制 ref"
            >
              {{ item.id }}
              <i class="fas" :class="copiedRef === item.id ? 'fa-check' : 'fa-copy'"></i>
            </button>
            <span class="song-meta">
              {{ item.title }} - {{ item.artist }}
            </span>
            <span class="trans-tag" :class="{ 'has-trans': item.has_translation }">
              {{ item.has_translation ? '有译文' : '原文/纯音' }}
            </span>
          </div>
          <button class="preview-btn" @click="openPreview(item.id)">
            预览
          </button>
        </div>
      </div>
    </div>

    <!-- 歌词时间戳滚动预览弹窗 -->
    <div v-if="previewData" class="lyric-preview-drawer">
      <div class="preview-header">
        <span>
          📖 歌词预览：{{ previewData.meta.title }} - {{ previewData.meta.artist }}
          （共 {{ previewData.lyrics.lines.length }} 行）
        </span>
        <button class="mini-btn" @click="previewData = null">关闭预览</button>
      </div>
      <div class="preview-lines">
        <div v-if="previewData.lyrics.lines.length === 0" class="empty-hint">
          ♪ 纯音乐 / 无歌词时间戳 ♪
        </div>
        <div
          v-for="(ln, idx) in previewData.lyrics.lines"
          :key="idx"
          class="preview-line-row"
        >
          <span class="ln-time">[{{ formatTimestamp(ln.time_ms) }}]</span>
          <span class="ln-text">{{ ln.text }}</span>
          <span v-if="ln.translation" class="ln-trans">{{ ln.translation }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 导演控制栏内的「🎵 音乐烘焙」浮动面板组件（MusicBakePanel）。
 *
 * 对接 `/api/studio/music/*` 后端接口，支持：
 * - 批量输入歌曲 ID 或歌名关键词
 * - 歌名搜索展示候选列表供用户手动挑选（禁止自动盲选第一首，遵循 PRD §7.4）
 * - Windows SMTC 一键识别当前播放曲目（非 Windows 或未安装 winsdk 时自动隐藏按钮）
 * - 重复烘焙时提示「覆盖 / 跳过」
 * - 整首歌词与时间戳滚动预览
 */
import { onMounted, ref } from 'vue'
import type { MusicBakeJson } from '../types/music'

defineEmits<{
  (e: 'close'): void
}>()

interface SearchCandidate {
  song_id: number
  title: string
  artist: string
  album: string
  duration_ms: number
}

interface BakedTrackSummary {
  id: string
  title: string
  artist: string
  duration_ms: number
  has_translation: boolean
}

interface BakeTaskItem {
  uid: number
  query: string
  songId?: number
  ref?: string
  status:
    | 'pending'
    | 'choose'
    | 'confirm-overwrite'
    | 'success'
    | 'skipped'
    | 'error'
  message: string
  candidates?: SearchCandidate[]
}

const rawInput = ref('')
const isSubmitting = ref(false)
const isDetectingSmtc = ref(false)
const smtcAvailable = ref(false)
const smtcMessage = ref('')
const bakedTracks = ref<BakedTrackSummary[]>([])
const tasks = ref<BakeTaskItem[]>([])
const previewData = ref<MusicBakeJson | null>(null)
const copiedRef = ref('')
let nextTaskUid = 1

async function fetchCapabilities() {
  try {
    const resp = await fetch('/api/studio/music/capabilities')
    if (!resp.ok) return
    const data = await resp.json()
    smtcAvailable.value = Boolean(data.smtc_available)
    bakedTracks.value = Array.isArray(data.tracks) ? data.tracks : []
  } catch {
    smtcAvailable.value = false
  }
}

async function handleBatchSubmit() {
  const lines = rawInput.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length === 0) return

  isSubmitting.value = true
  try {
    for (const line of lines) {
      const task: BakeTaskItem = {
        uid: nextTaskUid++,
        query: line,
        status: 'pending',
        message: '处理中…',
      }
      tasks.value.unshift(task)

      if (/^\d+$/.test(line)) {
        await bakeBySongId(task, Number(line), false)
      } else {
        await searchCandidatesForTask(task, line)
      }
    }
    rawInput.value = ''
  } finally {
    isSubmitting.value = false
  }
}

async function searchCandidatesForTask(task: BakeTaskItem, query: string) {
  try {
    const resp = await fetch('/api/studio/music/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 6 }),
    })
    if (!resp.ok) {
      task.status = 'error'
      task.message = `搜索请求失败 (HTTP ${resp.status})`
      return
    }
    const data = await resp.json()
    const candidates: SearchCandidate[] = data.candidates || []
    if (candidates.length === 0) {
      task.status = 'error'
      task.message = '搜索不到匹配歌曲，请改用网易云数字歌曲 ID'
      return
    }
    task.candidates = candidates
    task.status = 'choose'
    task.message = `找到 ${candidates.length} 首候选，请手动选择正确版本：`
  } catch (err) {
    task.status = 'error'
    task.message = `网络异常: ${(err as Error).message}`
  }
}

async function bakeBySongId(
  task: BakeTaskItem,
  songId: number,
  overwrite: boolean,
) {
  task.songId = songId
  task.status = 'pending'
  task.message = '烘焙中…'

  try {
    const resp = await fetch('/api/studio/music/bake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: songId, overwrite }),
    })

    const data = await resp.json()
    if (resp.status === 409 && data.status === 'exists') {
      task.ref = data.ref
      task.status = 'confirm-overwrite'
      task.message = `已存在同名烘焙文件 (${data.ref})，是否覆盖？`
      return
    }

    if (!resp.ok) {
      task.status = 'error'
      task.message = data.error || `烘焙失败 (HTTP ${resp.status})`
      return
    }

    task.ref = data.ref
    task.status = 'success'
    task.candidates = undefined
    task.message = `烘焙完成 → studio/music/${data.ref}.json`
    await fetchCapabilities()
  } catch (err) {
    task.status = 'error'
    task.message = `烘焙异常: ${(err as Error).message}`
  }
}

function skipTask(task: BakeTaskItem) {
  task.status = 'skipped'
  task.message = `已跳过 (${task.ref})`
}

async function handleDetectSmtc() {
  isDetectingSmtc.value = true
  smtcMessage.value = ''
  try {
    const resp = await fetch('/api/studio/music/smtc')
    const data = await resp.json()
    if (!resp.ok || !data.title) {
      smtcMessage.value =
        data.message || '未检测到正在播放的曲目，请确认桌面播放器已打开'
      return
    }
    const query = `${data.title} ${data.artist || ''}`.trim()
    smtcMessage.value = `🎧 已识别当前播放：${query}`
    const task: BakeTaskItem = {
      uid: nextTaskUid++,
      query,
      status: 'pending',
      message: '正在搜索识别到的曲目…',
    }
    tasks.value.unshift(task)
    await searchCandidatesForTask(task, query)
  } catch (err) {
    smtcMessage.value = `SMTC 识别失败: ${(err as Error).message}`
  } finally {
    isDetectingSmtc.value = false
  }
}

async function openPreview(refId: string) {
  try {
    const resp = await fetch(
      `/__studio_fs/music/${encodeURIComponent(refId)}.json?t=${Date.now()}`,
    )
    if (resp.ok) {
      previewData.value = (await resp.json()) as MusicBakeJson
    }
  } catch {
    // 忽略预览异常
  }
}

function copyRef(refId: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(refId).catch(() => {})
  }
  copiedRef.value = refId
  setTimeout(() => {
    if (copiedRef.value === refId) copiedRef.value = ''
  }, 1500)
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor((ms || 0) / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function formatTimestamp(ms: number): string {
  const min = Math.floor(ms / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor(ms % 1000)
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

onMounted(() => {
  fetchCapabilities()
})
</script>

<style scoped>
.music-bake-panel {
  position: fixed;
  right: 28px;
  bottom: 158px;
  width: 620px;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
  background: rgba(15, 23, 42, 0.96);
  color: #f8fafc;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(16px);
  z-index: 10010;
  pointer-events: auto;
  overflow-y: auto;
  font-size: 13px;
}

.bake-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.bake-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}

.bake-close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 16px;
  cursor: pointer;
}

.bake-close-btn:hover {
  color: #f8fafc;
}

.bake-input-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-label {
  color: #cbd5e1;
  font-weight: 500;
}

.bake-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(2, 6, 23, 0.65);
  color: #f8fafc;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.bake-action-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bake-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.bake-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bake-btn.primary {
  background: #3b82f6;
  color: #ffffff;
}

.bake-btn.secondary {
  background: #8b5cf6;
  color: #ffffff;
}

.bake-btn.ghost {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.smtc-banner {
  padding: 6px 10px;
  border-radius: 5px;
  background: rgba(139, 92, 246, 0.16);
  color: #ddd6fe;
}

.section-subtitle {
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  margin-bottom: 6px;
}

.task-card {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.7);
  margin-bottom: 6px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-query {
  font-weight: 700;
  color: #e2e8f0;
}

.task-msg {
  color: #94a3b8;
}

.candidate-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.candidate-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 8px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.8);
}

.cand-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.cand-title {
  font-weight: 600;
  color: #f8fafc;
}

.cand-artist,
.cand-album,
.cand-dur,
.cand-id {
  color: #94a3b8;
  font-size: 12px;
}

.cand-select-btn,
.mini-btn,
.preview-btn {
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.5);
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.mini-btn.warn {
  border-color: rgba(245, 158, 11, 0.6);
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
}

.overwrite-actions {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.baked-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  overflow-y: auto;
}

.baked-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.55);
}

.baked-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ref-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
}

.song-meta {
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trans-tag {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
}

.trans-tag.has-trans {
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
}

.lyric-preview-drawer {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 10px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-weight: 600;
}

.preview-lines {
  max-height: 160px;
  overflow-y: auto;
  background: rgba(2, 6, 23, 0.75);
  padding: 8px;
  border-radius: 6px;
  font-size: 12px;
}

.preview-line-row {
  display: flex;
  gap: 8px;
  padding: 2px 0;
}

.ln-time {
  color: #64748b;
  font-family: monospace;
  flex-shrink: 0;
}

.ln-text {
  color: #f1f5f9;
}

.ln-trans {
  color: #94a3b8;
}

.empty-hint {
  color: #64748b;
  font-style: italic;
  padding: 6px 0;
}
</style>
