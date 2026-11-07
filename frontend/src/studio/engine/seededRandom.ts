/**
 * 确定性伪随机数生成器（PRNG）与周期折叠数学工具。
 *
 * 用于背景粒子层（ParticleLayer）与桌宠 Cheer 撒花粒子的逐帧确定性坐标推导，
 * 保证同一剧本在任意时刻 $t$ 渲染出的粒子位置与透明度完全一致。
 */

/**
 * 将任意字符串通过 FNV-1a (32-bit) 算法哈希为无符号 32 位整数种子。
 *
 * @param input 输入字符串（如剧本 `id`）
 * @returns 32 位无符号整数种子
 */
export function hashStringToSeed(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * 创建基于 `mulberry32` 算法的固定种子伪随机数生成器。
 *
 * 每次调用返回 $[0, 1)$ 区间内均匀分布的浮点数。
 *
 * @param seed 32 位整数种子
 * @returns 生成 $[0, 1)$ 浮点数的无参函数
 */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 正模运算（始终返回 $[0, \text{mod})$ 之间的非负余数）。
 *
 * 解决 JavaScript 原生 `%` 运算符对负数返回负余数的问题。
 *
 * @param value 被除数
 * @param mod 模数（需大于 0）
 * @returns 非负余数
 */
export function positiveMod(value: number, mod: number): number {
  if (mod <= 0) return 0
  return ((value % mod) + mod) % mod
}

/**
 * 周期为 $2D$ 的对称三角波折叠函数 $\text{tri}(u, D) = D - |u \bmod (2D) - D|$。
 *
 * 用于将随时间线性增长的相位映射为在 $[0, D]$ 区间内平滑往返反弹的数值（如呼吸透明度）。
 *
 * @param u 累计相位值
 * @param span 往返区间跨度 $D$（需大于 0）
 * @returns 落在 $[0, D]$ 内的当前值
 */
export function triangleWave(u: number, span: number): number {
  if (span <= 0) return 0
  const period = 2 * span
  const wrapped = positiveMod(u, period)
  return span - Math.abs(wrapped - span)
}
