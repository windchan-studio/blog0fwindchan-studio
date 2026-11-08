/**
 * 风风博客·制片厂（Studio）前端模块统一导出入口。
 */

export * from './types/script'
export * from './types/music'
export * from './types/state'

export * from './engine/seededRandom'
export * from './engine/easing'
export * from './engine/lyricMatcher'
export * from './engine/locatorResolver'
export * from './engine/scriptValidator'
export * from './engine/timelineCompiler'
export * from './engine/stateDeriver'
export * from './engine/frameClock'

export * from './bridge/studioPiniaPlugin'
export * from './bridge/pageStageDriver'
export * from './bridge/renderBridge'

export * from './stores/useStudioStore'
export { default as StudioRoot } from './components/StudioRoot.vue'
export { default as StudioLyricBar } from './components/StudioLyricBar.vue'
export { default as StudioTocPet } from './components/StudioTocPet.vue'
export { default as StudioToastLayer } from './components/StudioToastLayer.vue'
export { default as DirectorBar } from './components/DirectorBar.vue'
export { default as MusicBakePanel } from './components/MusicBakePanel.vue'
