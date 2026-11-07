/**
 * 演播室动画缓动函数库（去 CSS 自走化纯数学插值）。
 *
 * 所有缓动函数均将归一化时间进度 $x \in [0, 1]$ 映射为插值进度 $y \in [0, 1]$。
 */

import type { StudioEasingName } from '../types/script'

/**
 * 将数值裁剪到 $[min, max]$ 闭区间内。
 *
 * @param val 输入值
 * @param min 下界
 * @param max 上界
 * @returns 裁剪后的数值
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

/**
 * 线性缓动。
 *
 * @param t 归一化进度 $[0, 1]$
 * @returns 插值结果
 */
export function easeLinear(t: number): number {
  return clamp(t, 0, 1)
}

/**
 * 三次方加速缓动（Ease-In Cubic），用于旧台词退场等场景。
 *
 * @param t 归一化进度 $[0, 1]$
 * @returns 插值结果
 */
export function easeInCubic(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * x
}

/**
 * 三次方减速缓动（Ease-Out Cubic），用于新台词入场与减速滚动。
 *
 * @param t 归一化进度 $[0, 1]$
 * @returns 插值结果
 */
export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1)
  return 1 - Math.pow(1 - x, 3)
}

/**
 * 三次方对称加减速缓动（Ease-In-Out Cubic），页面滚动的默认缓动曲线。
 *
 * @param t 归一化进度 $[0, 1]$
 * @returns 插值结果
 */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/**
 * 根据剧本配置的缓动名称计算插值进度。
 *
 * @param name 缓动类型名称
 * @param progress 归一化时间进度 $[0, 1]$
 * @returns 缓动后的进度 $[0, 1]$
 */
export function evaluateEasing(
  name: StudioEasingName | undefined,
  progress: number,
): number {
  switch (name) {
    case 'linear':
      return easeLinear(progress)
    case 'easeOut':
      return easeOutCubic(progress)
    case 'easeInOut':
    default:
      return easeInOutCubic(progress)
  }
}

/**
 * 构造与 CSS `cubic-bezier(x1, y1, x2, y2)` 完全一致的缓动求值函数。
 *
 * 采用牛顿-拉夫逊迭代结合二分法回退求解参数曲线 $X(s) = x$，再代入 $Y(s)$。
 *
 * @param x1 控制点 P1 横坐标 $[0, 1]$
 * @param y1 控制点 P1 纵坐标
 * @param x2 控制点 P2 横坐标 $[0, 1]$
 * @param y2 控制点 P2 纵坐标
 * @returns 接收 $x \in [0, 1]$ 返回 $y$ 的缓动函数
 */
export function createCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const sampleCurveX = (s: number): number =>
    ((1 - 3 * x2 + 3 * x1) * s * s * s) +
    ((3 * x2 - 6 * x1) * s * s) +
    (3 * x1 * s)

  const sampleCurveY = (s: number): number =>
    ((1 - 3 * y2 + 3 * y1) * s * s * s) +
    ((3 * y2 - 6 * y1) * s * s) +
    (3 * y1 * s)

  const sampleCurveDerivativeX = (s: number): number =>
    (3 * (1 - 3 * x2 + 3 * x1) * s * s) +
    (2 * (3 * x2 - 6 * x1) * s) +
    (3 * x1)

  return (inputX: number): number => {
    const x = clamp(inputX, 0, 1)
    if (x === 0 || x === 1) return x

    // 牛顿迭代求解 s
    let s = x
    for (let i = 0; i < 8; i++) {
      const currentX = sampleCurveX(s) - x
      if (Math.abs(currentX) < 1e-6) {
        return clamp(sampleCurveY(s), 0, 1)
      }
      const derivative = sampleCurveDerivativeX(s)
      if (Math.abs(derivative) < 1e-6) break
      s -= currentX / derivative
    }

    // 二分回退保证单调收敛
    let low = 0
    let high = 1
    s = x
    for (let i = 0; i < 12; i++) {
      const currentX = sampleCurveX(s)
      if (Math.abs(currentX - x) < 1e-6) break
      if (x > currentX) {
        low = s
      } else {
        high = s
      }
      s = (high + low) * 0.5
    }

    return clamp(sampleCurveY(s), 0, 1)
  }
}

/**
 * TOC 目录展开/收起专用缓动函数：`cubic-bezier(0.25, 0.8, 0.25, 1)`（PRD §7.1）。
 */
export const easeTocExpand = createCubicBezier(0.25, 0.8, 0.25, 1)
