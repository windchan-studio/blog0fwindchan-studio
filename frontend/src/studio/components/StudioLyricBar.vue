<!-- frontend/src/studio/components/StudioLyricBar.vue -->
<template>
  <div
    v-if="lyricState && lyricState.enabled"
    class="studio-lyric-bar"
    :class="[`mode-${lyricState.mode}`, { 'is-dark': isDarkTheme }]"
  >
    <div class="lyric-pill">
      <!-- 主歌词行 -->
      <span
        class="lyric-line primary-line"
        :style="{ opacity: lyricState.opacity }"
      >
        {{ lyricState.text }}
      </span>

      <!-- 歌间交叉渐变时叠加的下一首首句 -->
      <span
        v-if="lyricState.crossfadeNextText"
        class="lyric-line crossfade-line"
        :style="{ opacity: lyricState.crossfadeNextOpacity }"
      >
        {{ lyricState.crossfadeNextText }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 演播室顶栏单行歌词播放器组件（StudioLyricBar）。
 *
 * 替换日常模式下的 `.time-display`，仅展示一行原文歌词（或前奏 ♪ / 片尾结束语），
 * 所有淡入淡出、音符呼吸与歌间交叉渐变透明度均由帧时钟 `StudioFrameState.lyric` 驱动。
 */
import { computed } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useStudioStore } from '../stores/useStudioStore'

const studioStore = useStudioStore()
const { isDarkTheme } = useTheme()

const lyricState = computed(() => studioStore.currentFrameState?.lyric ?? null)
</script>

<style scoped>
.studio-lyric-bar {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}

.lyric-pill {
  position: relative;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-width: 260px;
  max-width: 920px;
  padding: 4px 22px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.38);
  backdrop-filter: blur(8px);
}

.studio-lyric-bar.is-dark .lyric-pill {
  background: rgba(15, 23, 42, 0.48);
}

.lyric-line {
  display: block;
  max-width: 880px;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(15, 23, 42, 0.92);
}

.studio-lyric-bar.is-dark .lyric-line {
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
}

.crossfade-line {
  position: absolute;
  left: 22px;
  right: 22px;
  text-align: center;
}
</style>
