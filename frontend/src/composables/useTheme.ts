// frontend\src\composables\useTheme.ts
import { ref, computed, onMounted } from 'vue'
import { useToast } from '@/composables/useToast'

/** 模块级共享的日常暗色主题状态 */
const sharedDarkTheme = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'dark',
)

/** 演播室强制覆写的主题状态（null 表示未处于演播室模式，使用用户日常主题） */
const studioThemeOverride = ref<'light' | 'dark' | null>(null)

/**
 * 演播室模式专用的主题覆写入口（不读写 localStorage，不弹 Toast）。
 *
 * @param mode 强制指定的主题（'light' | 'dark'），退出时传 null 恢复用户主题
 */
export function setStudioThemeOverride(mode: 'light' | 'dark' | null): void {
  studioThemeOverride.value = mode
}

/**
 * 获取当前演播室主题覆写值。
 */
export function getStudioThemeOverride(): 'light' | 'dark' | null {
  return studioThemeOverride.value
}

/**
 * 主题管理 composable
 * 负责深色/浅色主题的切换与持久化
 */
export function useTheme() {
  const { notify } = useToast()

  const isDarkTheme = computed<boolean>({
    get() {
      if (studioThemeOverride.value !== null) {
        return studioThemeOverride.value === 'dark'
      }
      return sharedDarkTheme.value
    },
    set(val: boolean) {
      if (studioThemeOverride.value !== null) {
        studioThemeOverride.value = val ? 'dark' : 'light'
        return
      }
      sharedDarkTheme.value = val
    },
  })

  const lightWallpaper = '/assets/images/wallpaper.webp'
  const darkWallpaper = '/assets/images/dark-theme-wallpaper.webp'

  const wallpaperStyle = computed(() => ({
    backgroundImage: `url(${isDarkTheme.value ? darkWallpaper : lightWallpaper})`,
    transform: 'translate3d(0,0,0)',
    backfaceVisibility: 'hidden' as const,
    willChange: 'transform',
  }))

  const toggleTheme = () => {
    if (studioThemeOverride.value !== null) {
      return
    }
    sharedDarkTheme.value = !sharedDarkTheme.value
    localStorage.setItem('theme', sharedDarkTheme.value ? 'dark' : 'light')
    notify({
      message: `已切换到${sharedDarkTheme.value ? '暗色' : '亮色'}主题了哦(/≧▽≦)/`,
      type: 'success',
    })
  }

  onMounted(() => {
    if (studioThemeOverride.value === null) {
      const savedTheme = localStorage.getItem('theme')
      sharedDarkTheme.value = savedTheme === 'dark'
    }
  })

  return { isDarkTheme, wallpaperStyle, toggleTheme }
}
