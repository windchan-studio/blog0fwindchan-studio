/**
 * 演播室 Pinia 插件（StudioPiniaPlugin）。
 *
 * 零侵入拦截两个 upstream 核心 Store：
 * 1. `toast` Store：演播室模式下拦截所有博客自发 Toast，转入导演控制栏系统消息列表（PRD §7.0 & §10 #6）。
 * 2. `settings` Store：演播室模式下备份用户个人设置、应用 Studio 标准确定性默认值，并屏蔽 `localStorage` 读写与跨标签页 `storage` 事件（PRD §7.0 & §10 #10）。
 */

import { watch } from 'vue'
import type { PiniaPluginContext } from 'pinia'
import type { ToastOptions } from '@/stores/toastStore'
import type {
  PaginationSettings,
  ParticleSettings,
  ToastSettings,
  TypeWriterSettings,
} from '@/stores/useSettingsStore'
import { useStudioStore } from '../stores/useStudioStore'

const STUDIO_DEFAULT_TYPEWRITER: TypeWriterSettings = {
  speed: 15,
  initialDelay: 600,
  chunkSize: 3,
  enabled: true,
}

const STUDIO_DEFAULT_PARTICLES: ParticleSettings = {
  enabled: true,
  count: 80,
  baseSpeed: 0.5,
}

const STUDIO_DEFAULT_TOAST: ToastSettings = {
  position: 'top-right',
  duration: 4000,
}

export function studioPiniaPlugin({ store }: PiniaPluginContext): void {
  // 1. 拦截 toast store 的 add 方法
  if (store.$id === 'toast') {
    const originalAdd = store.add.bind(store) as (
      options: ToastOptions,
    ) => number

    store.add = (options: ToastOptions): number => {
      const studioStore = useStudioStore()
      if (studioStore.isStudioMode) {
        return studioStore.captureSystemToast(options)
      }
      return originalAdd(options)
    }
  }

  // 2. 隔离 settings store 的内存状态与 localStorage 持久化
  if (store.$id === 'settings') {
    let userSnapshot: {
      typeWriter: TypeWriterSettings
      particles: ParticleSettings
      pagination: PaginationSettings
      toast: ToastSettings
    } | null = null

    const blockStorageEventInStudio = (e: StorageEvent) => {
      const studioStore = useStudioStore()
      if (studioStore.isStudioMode && e.key === 'blog_settings') {
        e.stopImmediatePropagation()
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', blockStorageEventInStudio, true)
    }

    // 包装所有写 localStorage 的 action，在演播室模式下仅更新内存（或不落盘）
    const wrapPersistAction = <Args extends unknown[], R>(
      originalFn: (...args: Args) => R,
      inStudioHandler: (...args: Args) => R,
    ): ((...args: Args) => R) => {
      return (...args: Args): R => {
        const studioStore = useStudioStore()
        if (studioStore.isStudioMode) {
          return inStudioHandler(...args)
        }
        return originalFn(...args)
      }
    }

    store.setTypeWriterSettings = wrapPersistAction(
      store.setTypeWriterSettings.bind(store),
      (partial: Partial<TypeWriterSettings>) => {
        store.typeWriter = { ...store.typeWriter, ...partial }
        return true
      },
    )

    store.resetTypeWriterSettings = wrapPersistAction(
      store.resetTypeWriterSettings.bind(store),
      () => {
        store.typeWriter = { ...STUDIO_DEFAULT_TYPEWRITER }
        return true
      },
    )

    store.setParticleSettings = wrapPersistAction(
      store.setParticleSettings.bind(store),
      (partial: Partial<ParticleSettings>) => {
        store.particles = { ...store.particles, ...partial }
        return true
      },
    )

    store.resetParticleSettings = wrapPersistAction(
      store.resetParticleSettings.bind(store),
      () => {
        store.particles = { ...STUDIO_DEFAULT_PARTICLES }
        return true
      },
    )

    store.setToastSettings = wrapPersistAction(
      store.setToastSettings.bind(store),
      (partial: Partial<ToastSettings>) => {
        store.toast = { ...store.toast, ...partial }
        return true
      },
    )

    store.resetToastSettings = wrapPersistAction(
      store.resetToastSettings.bind(store),
      () => {
        store.toast = { ...STUDIO_DEFAULT_TOAST }
        return true
      },
    )

    store.saveToLocalStorage = wrapPersistAction(
      store.saveToLocalStorage.bind(store),
      () => undefined,
    )

    store.loadSettings = wrapPersistAction(
      store.loadSettings.bind(store),
      () => undefined,
    )

    // 监听演播室模式开关，自动备份与还原用户设置
    queueMicrotask(() => {
      const studioStore = useStudioStore()
      watch(
        () => studioStore.isStudioMode,
        (inStudio) => {
          if (inStudio) {
            userSnapshot = {
              typeWriter: { ...store.typeWriter },
              particles: { ...store.particles },
              pagination: { ...store.pagination },
              toast: { ...store.toast },
            }
            store.typeWriter = { ...STUDIO_DEFAULT_TYPEWRITER }
            store.particles = { ...STUDIO_DEFAULT_PARTICLES }
            store.toast = { ...STUDIO_DEFAULT_TOAST }
          } else if (userSnapshot) {
            store.typeWriter = { ...userSnapshot.typeWriter }
            store.particles = { ...userSnapshot.particles }
            store.pagination = { ...userSnapshot.pagination }
            store.toast = { ...userSnapshot.toast }
            userSnapshot = null
          }
        },
        { immediate: true },
      )
    })
  }
}
