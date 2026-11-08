/**
 * 演播室剧本三层校验器（ScriptValidator）。
 *
 * - L1：JSON Schema 结构、必填字段、枚举范围与定位器格式校验（输出精确路径如 `segments[2].lines[4].mood`）
 * - L2：编译期语义校验（滚动动作区间重叠、跨句动作提示、Toast 位置重叠、预烘焙音乐文件存在性）
 * - L3：运行时 DOM 校验（定位器目标元素存在性、台词双行折行超限、右下角字幕框遮挡检测）
 */

import type { MusicBakeJson } from '../types/music'
import type {
  CompiledTimeline,
  ScriptJson,
  StudioLocator,
  StudioMood,
  ValidationIssue,
} from '../types/script'
import { resolveLocator } from './locatorResolver'
import { estimateLineDurationMs, stripSubtitleMarkup } from './timelineCompiler'

const VALID_MOODS = new Set<StudioMood>([
  'typing',
  'reading',
  'sleepy',
  'dizzy',
  'shocked',
  'warning',
  'cheer',
  'thinking',
  'proud',
  'success',
])

const VALID_EASINGS = new Set(['linear', 'easeInOut', 'easeOut'])
const VALID_THEMES = new Set(['light', 'dark'])
const VALID_TOAST_TYPES = new Set(['success', 'info', 'warning', 'error'])
const VALID_TOAST_POSITIONS = new Set([
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'top-center',
])
const ID_PATTERN = /^[a-z0-9-]+$/

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * 校验定位器结构是否合法。
 */
function validateLocatorField(
  val: unknown,
  path: string,
  issues: ValidationIssue[],
  ctx?: { segmentIndex?: number; lineIndex?: number; globalLineIndex?: number },
): boolean {
  if (typeof val === 'string') {
    if (val.trim().length === 0) {
      issues.push({
        level: 'error',
        layer: 'L1',
        path,
        message: '定位器字符串不能为空',
        ...ctx,
      })
      return false
    }
    return true
  }

  if (isPlainObject(val)) {
    if (typeof val.heading !== 'string' || val.heading.trim().length === 0) {
      issues.push({
        level: 'error',
        layer: 'L1',
        path: `${path}.heading`,
        message: '定位器必须包含非空的 heading 标题字符串',
        ...ctx,
      })
      return false
    }
    if (
      val.nth !== undefined &&
      (typeof val.nth !== 'number' || !Number.isInteger(val.nth) || val.nth < 1)
    ) {
      issues.push({
        level: 'error',
        layer: 'L1',
        path: `${path}.nth`,
        message: '定位器 nth 必须为大于等于 1 的整数',
        ...ctx,
      })
      return false
    }
    if (
      val.codeBlock !== undefined &&
      (typeof val.codeBlock !== 'number' ||
        !Number.isInteger(val.codeBlock) ||
        val.codeBlock < 1)
    ) {
      issues.push({
        level: 'error',
        layer: 'L1',
        path: `${path}.codeBlock`,
        message: '定位器 codeBlock 必须为大于等于 1 的整数',
        ...ctx,
      })
      return false
    }
    return true
  }

  issues.push({
    level: 'error',
    layer: 'L1',
    path,
    message: '定位器格式非法，应为 "#id" 字符串或 { heading, nth?, codeBlock? } 对象',
    ...ctx,
  })
  return false
}

/**
 * 执行 L1（Schema 与语法结构）与 L2（时间线语义与音乐引用）静态校验。
 *
 * @param raw 待校验的剧本未知对象
 * @param availableMusicRefs 已加载或存在的预烘焙音乐字典/集合（可选）
 * @returns 校验结果，含是否通过、错误列表与警告列表
 */
export function validateScriptStatic(
  raw: unknown,
  availableMusicRefs?: Record<string, MusicBakeJson> | Set<string>,
): {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
} {
  const issues: ValidationIssue[] = []

  if (!isPlainObject(raw)) {
    issues.push({
      level: 'error',
      layer: 'L1',
      path: 'root',
      message: '剧本根节点必须是一个 JSON 对象',
    })
    return { valid: false, errors: issues, warnings: [] }
  }

  // 1. 顶层字段校验
  if (raw.version !== 1) {
    issues.push({
      level: 'error',
      layer: 'L1',
      path: 'version',
      message: `剧本 version 必须为 1，当前为 ${String(raw.version)}`,
    })
  }

  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    issues.push({
      level: 'error',
      layer: 'L1',
      path: 'id',
      message: '剧本 id 必须为非空字符串且仅包含小写字母、数字与连字符 [a-z0-9-]',
    })
  }

  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    issues.push({
      level: 'error',
      layer: 'L1',
      path: 'title',
      message: '剧本 title 必须为非空字符串',
    })
  }

  if (
    !isPlainObject(raw.article) ||
    typeof raw.article.slug !== 'string' ||
    raw.article.slug.trim().length === 0
  ) {
    issues.push({
      level: 'error',
      layer: 'L1',
      path: 'article.slug',
      message: '必须指定背景板文章 article.slug',
    })
  }

  // 2. video 配置校验
  let gapMs = 300
  if (raw.video !== undefined) {
    if (!isPlainObject(raw.video)) {
      issues.push({
        level: 'error',
        layer: 'L1',
        path: 'video',
        message: 'video 必须为对象',
      })
    } else {
      const v = raw.video
      if (v.fps !== undefined && v.fps !== 24 && v.fps !== 30) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: 'video.fps',
          message: 'video.fps 仅支持 24 或 30',
        })
      }
      if (
        v.zoom !== undefined &&
        (typeof v.zoom !== 'number' || v.zoom < 0.5 || v.zoom > 2.5)
      ) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: 'video.zoom',
          message: 'video.zoom 必须为 0.5 到 2.5 之间的数值',
        })
      }
      if (v.theme !== undefined && !VALID_THEMES.has(String(v.theme))) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: 'video.theme',
          message: 'video.theme 仅支持 "light" 或 "dark"',
        })
      }
      if (v.defaults !== undefined && isPlainObject(v.defaults)) {
        if (
          v.defaults.mood !== undefined &&
          !VALID_MOODS.has(v.defaults.mood as StudioMood)
        ) {
          issues.push({
            level: 'error',
            layer: 'L1',
            path: 'video.defaults.mood',
            message: `未知的默认情绪 "${String(v.defaults.mood)}"`,
          })
        }
        if (typeof v.defaults.gapMs === 'number' && v.defaults.gapMs >= 0) {
          gapMs = v.defaults.gapMs
        }
      }
    }
  }

  // 3. music 配置与 L2 音乐引用存在性校验
  if (raw.music !== undefined) {
    if (!isPlainObject(raw.music)) {
      issues.push({
        level: 'error',
        layer: 'L1',
        path: 'music',
        message: 'music 字段必须为对象',
      })
    } else if (raw.music.tracks !== undefined) {
      if (!Array.isArray(raw.music.tracks)) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: 'music.tracks',
          message: 'music.tracks 必须为数组',
        })
      } else {
        raw.music.tracks.forEach((tr, idx) => {
          const tPath = `music.tracks[${idx}]`
          if (!isPlainObject(tr) || typeof tr.ref !== 'string' || !tr.ref.trim()) {
            issues.push({
              level: 'error',
              layer: 'L1',
              path: `${tPath}.ref`,
              message: '曲目必须包含非空的 ref 字符串',
            })
            return
          }
          if (
            tr.startAtMs !== undefined &&
            (typeof tr.startAtMs !== 'number' || tr.startAtMs < 0)
          ) {
            issues.push({
              level: 'error',
              layer: 'L1',
              path: `${tPath}.startAtMs`,
              message: 'startAtMs 必须为非负数值',
            })
          }
          // L2：检查烘焙音乐文件是否存在
          if (availableMusicRefs) {
            const exists =
              availableMusicRefs instanceof Set
                ? availableMusicRefs.has(tr.ref)
                : Boolean(availableMusicRefs[tr.ref])
            if (!exists) {
              issues.push({
                level: 'error',
                layer: 'L2',
                path: `${tPath}.ref`,
                message: `找不到预烘焙音乐文件 "studio/music/${tr.ref}.json"，请先在音乐烘焙面板烤制该曲目`,
              })
            }
          }
        })
      }
    }
  }

  // 4. segments 与 lines 遍历校验（L1 + L2 时间线冲突）
  if (!Array.isArray(raw.segments) || raw.segments.length === 0) {
    issues.push({
      level: 'error',
      layer: 'L1',
      path: 'segments',
      message: 'segments 必须为非空数组',
    })
  } else {
    const scrollWindows: Array<{
      startMs: number
      endMs: number
      path: string
      segmentIndex: number
      lineIndex: number
      globalLineIndex: number
    }> = []

    let cursorMs = 0
    let globalLineIndex = 0
    const totalLines = raw.segments.reduce(
      (acc, s) =>
        acc + (isPlainObject(s) && Array.isArray(s.lines) ? s.lines.length : 0),
      0,
    )

    raw.segments.forEach((seg, sIdx) => {
      const segPath = `segments[${sIdx}]`
      if (!isPlainObject(seg)) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: segPath,
          message: '分段必须为对象',
          segmentIndex: sIdx,
        })
        return
      }

      if (typeof seg.id !== 'string' || !ID_PATTERN.test(seg.id)) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: `${segPath}.id`,
          message: '分段 id 必须为非空字符串且仅含 [a-z0-9-]',
          segmentIndex: sIdx,
        })
      }

      if (typeof seg.title !== 'string' || seg.title.trim().length === 0) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: `${segPath}.title`,
          message: '分段 title 不能为空',
          segmentIndex: sIdx,
        })
      }

      if (seg.tocAnchor !== undefined) {
        validateLocatorField(seg.tocAnchor, `${segPath}.tocAnchor`, issues, {
          segmentIndex: sIdx,
        })
      }

      if (!Array.isArray(seg.lines) || seg.lines.length === 0) {
        issues.push({
          level: 'error',
          layer: 'L1',
          path: `${segPath}.lines`,
          message: '每个分段至少需要包含一句台词',
          segmentIndex: sIdx,
        })
        return
      }

      seg.lines.forEach((line, lIdx) => {
        const linePath = `${segPath}.lines[${lIdx}]`
        const ctx = {
          segmentIndex: sIdx,
          lineIndex: lIdx,
          globalLineIndex,
        }

        if (!isPlainObject(line)) {
          issues.push({
            level: 'error',
            layer: 'L1',
            path: linePath,
            message: '台词项必须为对象',
            ...ctx,
          })
          globalLineIndex++
          return
        }

        if (typeof line.text !== 'string' || line.text.trim().length === 0) {
          issues.push({
            level: 'error',
            layer: 'L1',
            path: `${linePath}.text`,
            message: '台词 text 必须为非空字符串',
            ...ctx,
          })
        }

        if (
          line.duration !== undefined &&
          (typeof line.duration !== 'number' || line.duration < 100)
        ) {
          issues.push({
            level: 'error',
            layer: 'L1',
            path: `${linePath}.duration`,
            message: '台词 duration 必须为不小于 100 的毫秒整数',
            ...ctx,
          })
        }

        if (
          line.mood !== undefined &&
          !VALID_MOODS.has(line.mood as StudioMood)
        ) {
          issues.push({
            level: 'error',
            layer: 'L1',
            path: `${linePath}.mood`,
            message: `非法的情绪值 "${String(line.mood)}"`,
            ...ctx,
          })
        }

        const speakDurationMs =
          typeof line.duration === 'number' && line.duration >= 100
            ? line.duration
            : estimateLineDurationMs(typeof line.text === 'string' ? line.text : '')

        let waitDurationMs = 0
        const lineStartMs = cursorMs

        if (line.actions !== undefined) {
          if (!Array.isArray(line.actions)) {
            issues.push({
              level: 'error',
              layer: 'L1',
              path: `${linePath}.actions`,
              message: 'actions 必须为数组',
              ...ctx,
            })
          } else {
            line.actions.forEach((act, aIdx) => {
              const actPath = `${linePath}.actions[${aIdx}]`
              if (!isPlainObject(act) || typeof act.type !== 'string') {
                issues.push({
                  level: 'error',
                  layer: 'L1',
                  path: actPath,
                  message: '动作必须包含 type 字符串字段',
                  ...ctx,
                })
                return
              }

              const at = typeof act.at === 'number' ? act.at : 0
              if (act.at !== undefined && (typeof act.at !== 'number' || act.at < 0)) {
                issues.push({
                  level: 'error',
                  layer: 'L1',
                  path: `${actPath}.at`,
                  message: '动作偏移时间 at 必须为非负数',
                  ...ctx,
                })
              }

              // L2：动作的 at 超出本句 duration 时给出 warning（允许跨句动作）
              if (at > speakDurationMs) {
                issues.push({
                  level: 'warning',
                  layer: 'L2',
                  path: `${actPath}.at`,
                  message: `动作触发时刻 (${at}ms) 超出本句时长 (${speakDurationMs}ms)，将作为跨句动作执行`,
                  ...ctx,
                })
              }

              switch (act.type) {
                case 'overlay': {
                  issues.push({
                    level: 'error',
                    layer: 'L1',
                    path: `${actPath}.type`,
                    message: 'Phase 1 暂不支持 overlay 画中画动作（预留给 Phase 3）',
                    ...ctx,
                  })
                  break
                }
                case 'scroll': {
                  if (act.to === undefined) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.to`,
                      message: 'scroll 动作必须指定 to 目标',
                      ...ctx,
                    })
                  } else if (
                    act.to !== 'top' &&
                    act.to !== 'bottom' &&
                    typeof act.to !== 'number'
                  ) {
                    validateLocatorField(act.to, `${actPath}.to`, issues, ctx)
                  }
                  if (
                    act.easing !== undefined &&
                    !VALID_EASINGS.has(String(act.easing))
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.easing`,
                      message: 'scroll.easing 仅支持 linear / easeInOut / easeOut',
                      ...ctx,
                    })
                  }
                  const dur =
                    typeof act.durationMs === 'number' ? act.durationMs : 1000
                  scrollWindows.push({
                    startMs: lineStartMs + at,
                    endMs: lineStartMs + at + dur,
                    path: actPath,
                    ...ctx,
                  })
                  break
                }
                case 'typewriter': {
                  if (act.until === undefined) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.until`,
                      message: 'typewriter 动作必须指定 until 目标',
                      ...ctx,
                    })
                  } else if (act.until !== 'end') {
                    validateLocatorField(
                      act.until,
                      `${actPath}.until`,
                      issues,
                      ctx,
                    )
                  }
                  if (
                    typeof act.durationMs !== 'number' ||
                    act.durationMs <= 0
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.durationMs`,
                      message: 'typewriter.durationMs 必须为正整数',
                      ...ctx,
                    })
                  }
                  break
                }
                case 'toc': {
                  if (act.highlight !== undefined) {
                    validateLocatorField(
                      act.highlight,
                      `${actPath}.highlight`,
                      issues,
                      ctx,
                    )
                  }
                  break
                }
                case 'highlight': {
                  validateLocatorField(
                    act.target,
                    `${actPath}.target`,
                    issues,
                    ctx,
                  )
                  if (
                    act.style !== undefined &&
                    act.style !== 'glow' &&
                    act.style !== 'box'
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.style`,
                      message: 'highlight.style 仅支持 "glow" 或 "box"',
                      ...ctx,
                    })
                  }
                  break
                }
                case 'copy': {
                  validateLocatorField(
                    act.target,
                    `${actPath}.target`,
                    issues,
                    ctx,
                  )
                  break
                }
                case 'theme': {
                  if (!VALID_THEMES.has(String(act.to))) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.to`,
                      message: 'theme.to 仅支持 "light" 或 "dark"',
                      ...ctx,
                    })
                  }
                  break
                }
                case 'toast': {
                  if (
                    typeof act.text !== 'string' ||
                    act.text.trim().length === 0
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.text`,
                      message: 'toast.text 不能为空',
                      ...ctx,
                    })
                  }
                  if (
                    act.toastType !== undefined &&
                    !VALID_TOAST_TYPES.has(String(act.toastType))
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.toastType`,
                      message: 'toastType 仅支持 success / info / warning / error',
                      ...ctx,
                    })
                  }
                  if (
                    act.position !== undefined &&
                    !VALID_TOAST_POSITIONS.has(String(act.position))
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.position`,
                      message: '非法的 toast.position',
                      ...ctx,
                    })
                  }
                  // L2：bottom-right 会与 StudioTocPet 字幕框重叠
                  if (act.position === 'bottom-right') {
                    issues.push({
                      level: 'warning',
                      layer: 'L2',
                      path: `${actPath}.position`,
                      message:
                        'toast 位置设为 bottom-right 会与右下角 TocPet 字幕框重叠，建议使用默认的 top-right',
                      ...ctx,
                    })
                  }
                  break
                }
                case 'wait': {
                  if (
                    typeof act.durationMs !== 'number' ||
                    act.durationMs <= 0
                  ) {
                    issues.push({
                      level: 'error',
                      layer: 'L1',
                      path: `${actPath}.durationMs`,
                      message: 'wait.durationMs 必须为正整数',
                      ...ctx,
                    })
                  } else {
                    waitDurationMs += act.durationMs
                  }
                  break
                }
                default: {
                  issues.push({
                    level: 'error',
                    layer: 'L1',
                    path: `${actPath}.type`,
                    message: `未知的动作类型 "${act.type}"`,
                    ...ctx,
                  })
                }
              }
            })
          }
        }

        const isLastLine = globalLineIndex === totalLines - 1
        cursorMs =
          lineStartMs +
          speakDurationMs +
          waitDurationMs +
          (isLastLine ? 0 : gapMs)
        globalLineIndex++
      })
    })

    // L2：检查两个 scroll 动作区间是否重叠
    scrollWindows.sort((a, b) => a.startMs - b.startMs)
    for (let i = 1; i < scrollWindows.length; i++) {
      const prev = scrollWindows[i - 1]!
      const curr = scrollWindows[i]!
      if (curr.startMs < prev.endMs) {
        issues.push({
          level: 'error',
          layer: 'L2',
          path: curr.path,
          message: `scroll 动作时间区间 [${curr.startMs}ms, ${curr.endMs}ms] 与前一个 scroll (${prev.path}: [${prev.startMs}ms, ${prev.endMs}ms]) 重叠`,
          segmentIndex: curr.segmentIndex,
          lineIndex: curr.lineIndex,
          globalLineIndex: curr.globalLineIndex,
        })
      }
    }
  }

  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 估算单句台词在 640px 字幕框（文本净宽约 540px，字号 26px）下是否超过 2 行（PRD §7.1）。
 *
 * 中文字符按 26px 宽度计，ASCII 字符按 14px 宽度计；单行容量约 540px，2 行上限约 1080px。
 */
export function estimateSubtitleLineCount(text: string): number {
  const plain = stripSubtitleMarkup(text).trim()
  if (!plain) return 1
  let pixelWidth = 0
  for (let i = 0; i < plain.length; i++) {
    const code = plain.charCodeAt(i)
    pixelWidth += code > 255 ? 26 : 14
  }
  return Math.max(1, Math.ceil(pixelWidth / 530))
}

/**
 * 执行 L3 运行时 DOM 校验：检查所有定位器在当前文章 DOM 中是否存在、台词行数是否超限、高亮/复制元素是否被右下角字幕框遮挡。
 *
 * @param script 剧本对象
 * @param timeline 已编译时间线
 * @param contentRoot 文章 `.markdown-content` 根元素
 * @returns L3 校验问题列表
 */
export function validateScriptAgainstDom(
  script: ScriptJson,
  timeline: CompiledTimeline,
  contentRoot: HTMLElement,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const checkLocator = (
    locator: StudioLocator,
    path: string,
    ctx: { segmentIndex: number; lineIndex?: number; globalLineIndex?: number },
  ): HTMLElement | null => {
    const el = resolveLocator(locator, contentRoot)
    if (!el) {
      const desc =
        typeof locator === 'string'
          ? locator
          : `{ heading: "${locator.heading}"${locator.nth ? `, nth: ${locator.nth}` : ''}${locator.codeBlock ? `, codeBlock: ${locator.codeBlock}` : ''} }`
      issues.push({
        level: 'error',
        layer: 'L3',
        path,
        message: `在文章 DOM 中找不到目标定位器：${desc}`,
        ...ctx,
      })
    }
    return el
  }

  let globalLineIndex = 0
  script.segments.forEach((seg, sIdx) => {
    if (seg.tocAnchor !== undefined) {
      checkLocator(seg.tocAnchor, `segments[${sIdx}].tocAnchor`, {
        segmentIndex: sIdx,
      })
    }

    seg.lines.forEach((line, lIdx) => {
      const linePath = `segments[${sIdx}].lines[${lIdx}]`
      const ctx = {
        segmentIndex: sIdx,
        lineIndex: lIdx,
        globalLineIndex,
      }

      // L3：台词超过 2 行警告
      const estimatedLines = estimateSubtitleLineCount(line.text)
      if (estimatedLines > 2) {
        issues.push({
          level: 'warning',
          layer: 'L3',
          path: `${linePath}.text`,
          message: `台词预计折行为 ${estimatedLines} 行（超过 2 行上限），建议拆分为两句以免字幕框溢出`,
          ...ctx,
        })
      }

      if (line.actions) {
        line.actions.forEach((act, aIdx) => {
          const actPath = `${linePath}.actions[${aIdx}]`
          switch (act.type) {
            case 'scroll': {
              if (
                act.to !== 'top' &&
                act.to !== 'bottom' &&
                typeof act.to !== 'number'
              ) {
                checkLocator(act.to, `${actPath}.to`, ctx)
              }
              break
            }
            case 'typewriter': {
              if (act.until !== 'end') {
                checkLocator(act.until, `${actPath}.until`, ctx)
              }
              break
            }
            case 'toc': {
              if (act.highlight !== undefined) {
                checkLocator(act.highlight, `${actPath}.highlight`, ctx)
              }
              break
            }
            case 'highlight':
            case 'copy': {
              const targetKey = 'target'
              const el = checkLocator(
                act.target,
                `${actPath}.${targetKey}`,
                ctx,
              )
              // L3：右下角字幕框安全区遮挡检测 (1920x1080 下距右 40px, 距底 48px, 640x220)
              if (el && typeof window !== 'undefined') {
                const rect = el.getBoundingClientRect()
                const vw = timeline.video.width
                const vh = timeline.video.height
                const petLeft = vw - 40 - 640
                const petTop = vh - 48 - 220
                const overlapsHorizontally =
                  rect.right > petLeft && rect.left < vw - 40
                const overlapsVertically =
                  rect.bottom > petTop && rect.top < vh - 48
                if (overlapsHorizontally && overlapsVertically) {
                  issues.push({
                    level: 'warning',
                    layer: 'L3',
                    path: `${actPath}.target`,
                    message:
                      '目标元素在当前视口位置可能与右下角 TocPet 字幕框区域发生重叠遮挡，建议微调 scroll.offset',
                    ...ctx,
                  })
                }
              }
              break
            }
            default:
              break
          }
        })
      }

      globalLineIndex++
    })
  })

  return issues
}
