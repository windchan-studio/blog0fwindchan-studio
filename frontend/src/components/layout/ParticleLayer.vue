<template>
  <!-- 当设置启用时才渲染 Canvas 容器，节省 DOM 资源 -->
  <div v-if="settingsStore.particles.enabled" class="particle-layer" aria-hidden="true">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useStudioStore } from '@/studio/stores/useStudioStore'
import { studioFrameClock } from '@/studio/engine/frameClock'
import {
  createMulberry32,
  hashStringToSeed,
  positiveMod,
  triangleWave,
} from '@/studio/engine/seededRandom'

const props = defineProps<{
  isDarkTheme: boolean
}>()

const settingsStore = useSettingsStore()
const studioStore = useStudioStore()

/** 画布引用 */
const canvasRef = ref<HTMLCanvasElement | null>(null)
/** Canvas 上下文 */
let ctx: CanvasRenderingContext2D | null = null
/** 动画帧 ID */
let animationFrameId: number | null = null
/** 粒子数组 */
let particles: Particle[] = []

/**
 * 粒子形状枚举
 */
type ShapeType = 'triangle' | 'square' | 'hexagon' | 'diamond' | 'shard' | 'circle' | 'star'

/**
 * 粒子类
 * 负责单个粒子的状态管理与绘制
 */
class Particle {
  x: number
  y: number
  x0: number
  y0: number
  vx: number
  vy: number
  size: number
  color: string
  shape: ShapeType
  rotation: number
  rotation0: number
  rotationSpeed: number
  opacity: number
  opacity0: number
  opacitySpeed: number

  /**
   * 初始化粒子状态
   * @param w 画布宽度
   * @param h 画布高度
   * @param colors 当前主题颜色数组
   * @param isDark 是否为暗色模式
   * @param baseSpeed 基础速度配置
   * @param rand 随机数生成函数（默认 Math.random，演播室模式传入 mulberry32）
   */
  constructor(
    w: number,
    h: number,
    colors: string[],
    isDark: boolean,
    baseSpeed: number,
    rand: () => number = Math.random,
  ) {
    this.x0 = rand() * w
    this.y0 = rand() * h
    this.x = this.x0
    this.y = this.y0

    // 根据主题设定粒子大小范围
    this.size = isDark ? rand() * 4 + 3 : rand() * 6 + 4

    // 根据主题设定粒子速度，并应用全局速度配置
    const speed = isDark ? baseSpeed * 0.6 : baseSpeed
    const angle = rand() * Math.PI * 2
    this.vx = Math.cos(angle) * speed
    this.vy = Math.sin(angle) * speed

    // 暗色主题统一使用白色，亮色使用主题颜色
    this.color = isDark
      ? 'rgba(255,255,255,0.4)'
      : colors[Math.floor(rand() * colors.length)]

    // 根据主题分配形状
    const shapes: ShapeType[] = isDark
      ? ['circle', 'star']
      : ['triangle', 'shard', 'diamond', 'hexagon', 'square']
    this.shape = shapes[Math.floor(rand() * shapes.length)]

    // 设定旋转属性
    this.rotation0 = rand() * Math.PI * 2
    this.rotation = this.rotation0
    this.rotationSpeed = (rand() - 0.5) * 0.02

    // 设定透明度及呼吸效果
    this.opacity0 = isDark ? rand() * 0.4 + 0.6 : 0.8
    this.opacity = this.opacity0
    this.opacitySpeed = isDark ? (rand() - 0.5) * 0.02 : 0
  }

  /**
   * 演播室模式：根据帧时钟毫秒数 t 直接解析计算位置、旋转与呼吸透明度（ARCHITECTURE §3.5）
   */
  evaluateAtTime(w: number, h: number, timeMs: number) {
    const buffer = 50
    const spanW = Math.max(1, w + buffer * 2)
    const spanH = Math.max(1, h + buffer * 2)
    const k = timeMs * 0.06 // 对齐 60Hz 帧步数

    this.x = positiveMod(this.x0 + buffer + this.vx * k, spanW) - buffer
    this.y = positiveMod(this.y0 + buffer + this.vy * k, spanH) - buffer
    this.rotation = this.rotation0 + this.rotationSpeed * k

    if (this.opacitySpeed !== 0) {
      this.opacity =
        0.4 +
        triangleWave(
          this.opacity0 - 0.4 + Math.abs(this.opacitySpeed) * k,
          0.6,
        )
    } else {
      this.opacity = this.opacity0
    }
  }

  /**
   * 更新粒子位置与状态
   */
  update(w: number, h: number) {
    this.x += this.vx
    this.y += this.vy
    this.rotation += this.rotationSpeed

    const buffer = 50
    if (this.x < -buffer) this.x = w + buffer
    if (this.x > w + buffer) this.x = -buffer
    if (this.y < -buffer) this.y = h + buffer
    if (this.y > h + buffer) this.y = -buffer

    if (this.opacitySpeed !== 0) {
      this.opacity += this.opacitySpeed
      if (this.opacity > 1 || this.opacity < 0.4) {
        this.opacitySpeed = -this.opacitySpeed
      }
    }
  }

  /**
   * 在画布上绘制粒子
   */
  draw(ctx: CanvasRenderingContext2D) {
    ctx.save()
    ctx.translate(this.x, this.y)
    ctx.rotate(this.rotation)
    ctx.globalAlpha = this.opacity
    ctx.fillStyle = this.color

    if (this.shape === 'circle' || this.shape === 'star') {
      ctx.globalCompositeOperation = 'lighter'
    }

    ctx.beginPath()
    switch (this.shape) {
      case 'circle':
        this.drawCircle(ctx)
        break
      case 'star':
        this.drawStar(ctx)
        break
      case 'triangle':
        this.drawPolygon(ctx, 3)
        break
      case 'square':
        this.drawPolygon(ctx, 4)
        break
      case 'hexagon':
        this.drawPolygon(ctx, 6)
        break
      case 'diamond':
        this.drawDiamond(ctx)
        break
      case 'shard':
        this.drawShard(ctx)
        break
    }
    ctx.fill()
    ctx.restore()
  }

  drawCircle(ctx: CanvasRenderingContext2D) {
    ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2)
  }

  drawStar(ctx: CanvasRenderingContext2D) {
    const r = this.size * 0.3
    const R = this.size
    ctx.moveTo(0, -R)
    ctx.quadraticCurveTo(0, -r, R, 0)
    ctx.quadraticCurveTo(0, r, 0, R)
    ctx.quadraticCurveTo(0, r, -R, 0)
    ctx.quadraticCurveTo(0, -r, 0, -R)
    ctx.closePath()
  }

  drawPolygon(ctx: CanvasRenderingContext2D, sides: number) {
    const step = (Math.PI * 2) / sides
    const startAngle = -Math.PI / 2
    ctx.moveTo(Math.cos(startAngle) * this.size, Math.sin(startAngle) * this.size)
    for (let i = 1; i < sides; i++) {
      ctx.lineTo(
        Math.cos(startAngle + step * i) * this.size,
        Math.sin(startAngle + step * i) * this.size,
      )
    }
    ctx.closePath()
  }

  drawDiamond(ctx: CanvasRenderingContext2D) {
    ctx.moveTo(0, -this.size * 1.5)
    ctx.lineTo(this.size, 0)
    ctx.lineTo(0, this.size * 1.5)
    ctx.lineTo(-this.size, 0)
    ctx.closePath()
  }

  drawShard(ctx: CanvasRenderingContext2D) {
    ctx.moveTo(0, -this.size)
    ctx.lineTo(this.size, this.size)
    ctx.lineTo(-this.size * 0.8, this.size * 0.6)
    ctx.closePath()
  }
}

// --- 核心逻辑 ---

const getThemeColors = (): string[] => {
  const appRoot = document.getElementById('app-root') || document.body
  const style = getComputedStyle(appRoot)
  const colors: string[] = []

  for (let i = 1; i <= 7; i++) {
    let color = style.getPropertyValue(`--reflection-${i}`).trim()
    if (props.isDarkTheme && color.startsWith('rgba')) {
      color = color.replace(/,[\s\d\.]+\)$/, ', 0.8)')
    }
    if (color) colors.push(color)
  }

  // 如果没有定义主题颜色，使用默认颜色
  if (colors.length === 0) {
    return props.isDarkTheme
      ? ['rgba(20, 232, 193, 0.8)', 'rgba(24, 110, 210, 0.8)']
      : ['rgba(216, 15, 15, 0.17)', 'rgba(211, 135, 29, 0.17)']
  }
  return colors
}

// 初始化粒子数组
const initParticles = () => {
  if (!canvasRef.value) return
  const w = canvasRef.value.width
  const h = canvasRef.value.height
  const colors = getThemeColors()

  // 从 Store 获取配置
  const { count, baseSpeed } = settingsStore.particles
  const rand = studioStore.isStudioMode
    ? createMulberry32(hashStringToSeed(`particles:${studioStore.scriptId || 'studio'}`))
    : Math.random

  particles = []
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(w, h, colors, props.isDarkTheme, baseSpeed, rand))
  }

  if (studioStore.isStudioMode) {
    renderDeterministic(studioFrameClock.currentTimeMs.value)
  }
}

const renderDeterministic = (timeMs: number) => {
  if (!ctx || !canvasRef.value) return
  const w = canvasRef.value.width
  const h = canvasRef.value.height
  ctx.clearRect(0, 0, w, h)

  particles.forEach((p) => {
    p.evaluateAtTime(w, h, timeMs)
    p.draw(ctx!)
  })
}

const handleResize = () => {
  if (!canvasRef.value) return
  canvasRef.value.width = window.innerWidth
  canvasRef.value.height = window.innerHeight
  initParticles()
}

const render = () => {
  if (studioStore.isStudioMode) {
    renderDeterministic(studioFrameClock.currentTimeMs.value)
    return
  }
  if (!ctx || !canvasRef.value) return
  const w = canvasRef.value.width
  const h = canvasRef.value.height
  ctx.clearRect(0, 0, w, h)

  particles.forEach((p) => {
    p.update(w, h)
    p.draw(ctx!)
  })

  animationFrameId = requestAnimationFrame(render)
}

// --- 生命周期与监听 ---

// 启动函数
const start = () => {
  if (!canvasRef.value) return
  canvasRef.value.width = window.innerWidth
  canvasRef.value.height = window.innerHeight
  ctx = canvasRef.value.getContext('2d')

  initParticles()
  render()
  window.addEventListener('resize', handleResize)
}

// 停止函数
const stop = () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId)
  window.removeEventListener('resize', handleResize)
  ctx = null
  // 这里不需要设 canvasRef 为 null，因为 v-if 会处理 DOM 移除
}

onMounted(() => {
  if (settingsStore.particles.enabled) {
    start()
  }
})

onUnmounted(() => {
  stop()
})

// 监听主题变化
watch(
  () => props.isDarkTheme,
  () => {
    if (settingsStore.particles.enabled) {
      if (studioStore.isStudioMode) {
        initParticles()
      } else {
        setTimeout(initParticles, 100)
      }
    }
  },
)

// 演播室模式下监听帧时钟变化与剧本切换
watch(
  () => studioFrameClock.currentTimeMs.value,
  (t) => {
    if (studioStore.isStudioMode && settingsStore.particles.enabled) {
      renderDeterministic(t)
    }
  },
)

watch(
  () => [studioStore.isStudioMode, studioStore.scriptId] as const,
  ([inStudio]) => {
    if (!settingsStore.particles.enabled) return
    if (inStudio) {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      initParticles()
    } else {
      initParticles()
      render()
    }
  },
)

// 监听 Store 中的启用状态
watch(
  () => settingsStore.particles.enabled,
  (enabled) => {
    if (enabled) {
      // 等待 v-if 渲染 DOM
      nextTick(() => {
        start()
      })
    } else {
      stop()
    }
  },
)

// 监听 Store 中的数量和速度变化
watch([() => settingsStore.particles.count, () => settingsStore.particles.baseSpeed], () => {
  if (settingsStore.particles.enabled) {
    initParticles()
  }
})
</script>

<style scoped>
.particle-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}
</style>
