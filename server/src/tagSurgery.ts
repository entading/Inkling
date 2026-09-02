import fs from 'node:fs'
import { reindexNote } from './scanner.js'

/**
 * frontmatter 标签手术（v1.1 T2）：深度删除与重命名共用的「只动 tags 项」机制。
 * 红线级规范：
 * - 只动 frontmatter 围栏内的 tags 项，正文与其余 frontmatter 内容逐字节保持原样——
 *   严禁 gray-matter parse → dump 回写（会重排用户日期/引号/键序）；
 * - 精确整项匹配：解析后的标量值做 NFC 规范化后整项相等才算命中（防「动」误伤「动词」
 *   子串；目标值来自服务端索引的 YAML 解析语义，匹配方向无假阳性路径）；
 * - 支持 flow（`tags: [a, b]`，单行）与 block list（`- a`）两种形态、裸项与引号项；
 * - 无法安全定位（无围栏/未闭合/跨行 flow/嵌套结构/空项/重复 tags 键/缩进歧义）一律
 *   返回 not-ok，由路由层跳过并计入 warnings（部分成功如实上报），绝不整块重排；
 * - tags 项删空 → 移除整个 tags 键行（含该行行尾注释）；
 * - 改写由本模块落盘并 fs.utimesSync 恢复原 mtime（mtime 保护：无显式 updated 的
 *   词条其 updated 兜底排序不被污染）。
 *
 * 实现方式：全文按行切段（行尾 \r\n/\n 原样保留），仅对 tags 构造所在的行做替换/删除，
 * 其余段落原样回拼——围栏外逐字节不变由构造保证。
 */

export type SurgeryResult = { ok: true; content: string } | { ok: false; reason: string }

export type SurgeryMode = 'remove' | 'rename'

interface Line {
  seg: string // 原始行段（含行尾）
  bare: string // 去行尾后的内容
}

function splitLines(raw: string): Line[] {
  return raw.split(/(?<=\n)/).map((seg) => {
    const m = /(?:\r?\n)$/.exec(seg)
    return { seg, bare: m ? seg.slice(0, seg.length - m[0].length) : seg }
  })
}

function joinLines(lines: Line[]): string {
  return lines.map((l) => l.seg).join('')
}

/** YAML 标量解析（裸/单引号/双引号）：无法确信解析时返回 null（该项按不匹配处理） */
function parseScalar(text: string): string | null {
  const t = text.trim()
  if (t.startsWith('"')) {
    if (t.length < 2 || !t.endsWith('"')) return null
    const body = t.slice(1, -1)
    const escapes: Record<string, string> = {
      '\\': '\\', '"': '"', 'n': '\n', 't': '\t', 'r': '\r',
      '0': '\0', 'b': '\b', 'f': '\f', '/': '/', ' ': ' ',
    }
    let out = ''
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c !== '\\') {
        out += c
        continue
      }
      const n = body[++i]
      if (n === undefined || !(n in escapes)) return null
      out += escapes[n]
    }
    return out
  }
  if (t.startsWith("'")) {
    if (t.length < 2 || !t.endsWith("'")) return null
    return t.slice(1, -1).replace(/''/g, "'")
  }
  return t
}

const BARE_UNSAFE_RE = /["'`,[\]{}#&*!|>%@:\\]/
const BOOL_LIKE_RE = /^(?:true|false|null|~|yes|no|on|off)$/i
const NUM_LIKE_RE = /^(?:[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|0[xX][0-9a-fA-F]+)$/
const DATE_LIKE_RE = /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ].*)?$/

/**
 * 重命名新条目的序列化：bare-safe（非指示符开头、无结构字符/冒号/引号、首尾无空白、
 * 非布尔/数字/日期形——裸写会被 YAML 解析成别的类型）→ 裸值；否则双引号 + 转义。
 * 新条目是手术点本位，不继承旧项的引号风格。
 */
export function serializeTagScalar(v: string): string {
  const bareSafe =
    v.length > 0 &&
    !/^\s|\s$/.test(v) &&
    !BARE_UNSAFE_RE.test(v) &&
    !v.includes(':') &&
    !/^[-?:]/.test(v) &&
    !BOOL_LIKE_RE.test(v) &&
    !NUM_LIKE_RE.test(v) &&
    !DATE_LIKE_RE.test(v)
  if (bareSafe) return v
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

interface FlowItem {
  /** 项的完整 span（含前导空白）——供索引参考 */
  start: number
  end: number
  /** 手术精确 span（trim 后的首/尾非空白字符边界）——分隔空格不属于项本身 */
  rawStart: number
  rawEnd: number
  raw: string
  value: string | null
}

/** flow 内层分词（引号感知）；含嵌套结构/未闭合引号/空项 → null（不安全） */
function tokenizeFlow(inner: string): FlowItem[] | null {
  const items: FlowItem[] = []
  let start = -1
  let i = 0
  const push = (end: number): boolean => {
    if (start === -1) return true
    const raw = inner.slice(start, end).trim()
    if (!raw) return false
    const lead = inner.slice(start, end).length - inner.slice(start, end).trimStart().length
    items.push({
      start,
      end,
      rawStart: start + lead,
      rawEnd: start + lead + raw.length,
      raw,
      value: parseScalar(raw),
    })
    start = -1
    return true
  }
  while (i < inner.length) {
    const c = inner[i]
    if (c === '"' || c === "'") {
      const q = c
      if (start === -1) start = i
      i++
      let closed = false
      while (i < inner.length) {
        if (q === '"' && inner[i] === '\\') {
          i += 2
          continue
        }
        if (inner[i] === q) {
          if (q === "'" && inner[i + 1] === "'") {
            i += 2
            continue
          }
          closed = true
          break
        }
        i++
      }
      if (!closed) return null
      i++
      continue
    }
    if (c === '[' || c === ']' || c === '{' || c === '}') return null
    if (c === ',') {
      if (!push(i)) return null
      i++
      continue
    }
    if (start === -1) start = i
    i++
  }
  if (!push(inner.length)) return null
  return items
}

const FLOW_KEY_RE = /^(tags[ \t]*:[ \t]*)\[(.*)\]([ \t]*(?:#.*)?)$/
const KEY_RE = /^tags[ \t]*:/

/**
 * 手术主入口：详见模块头注释。replacement 仅 rename 模式使用（NFC 形式新名）。
 * flow 分支循环重分词直到无匹配（重复项安全，杜绝索引位移错误）。
 */
export function surgicalEditTags(
  raw: string,
  targetNfc: string,
  mode: SurgeryMode,
  replacement = '',
): SurgeryResult {
  const lines = splitLines(raw)

  // 1. frontmatter 围栏：首行必须是 ---，向下找闭合（--- 或 ...）
  if ((lines[0]?.bare ?? '') !== '---') return { ok: false, reason: '无 frontmatter' }
  let fenceEnd = -1
  for (let i = 1; i < lines.length; i++) {
    const b = lines[i].bare
    if (b === '---' || b === '...') {
      fenceEnd = i
      break
    }
  }
  if (fenceEnd === -1) return { ok: false, reason: 'frontmatter 未闭合' }

  // 2. 顶层（缩进 0）tags 键行——嵌套映射里的同名键不算；重复键定位不唯一 → 不安全
  const keyIdxs: number[] = []
  for (let i = 1; i < fenceEnd; i++) {
    if (KEY_RE.test(lines[i].bare)) keyIdxs.push(i)
  }
  if (keyIdxs.length === 0) return { ok: false, reason: '未找到顶层 tags 键' }
  if (keyIdxs.length > 1) return { ok: false, reason: '存在重复的 tags 键，定位不唯一' }
  const keyIdx = keyIdxs[0]
  const keyBare = lines[keyIdx].bare

  // —— flow 与 block 共用的收尾：用改写后的行段回拼全文
  const finish = (mutate: () => void): SurgeryResult => {
    mutate()
    return { ok: true, content: joinLines(lines) }
  }
  const removeKeyLine = (): SurgeryResult =>
    finish(() => {
      lines.splice(keyIdx, 1)
    })

  // 3a. flow 形态：单行 [..]
  const flowM = FLOW_KEY_RE.exec(keyBare)
  if (flowM) {
    let cur = flowM[2]
    let changed = false
    for (let guard = 0; guard < 64; guard++) {
      if (cur.trim() === '') {
        // 删空（含仅剩空白）：移除键行；未经手术的空表文件不会成为携带者，防御性兜底
        return changed ? removeKeyLine() : { ok: false, reason: '未找到匹配的标签项' }
      }
      const items = tokenizeFlow(cur)
      if (!items) {
        return { ok: false, reason: 'flow 列表无法安全分词（嵌套结构或空项）' }
      }
      const hit = items.find((it) => it.value !== null && it.value.normalize('NFC') === targetNfc)
      if (!hit) {
        return changed
          ? finish(() => {
              const ending = /(?:\r?\n)$/.exec(lines[keyIdx].seg)?.[0] ?? ''
              const newBare = flowM[1] + '[' + cur + ']' + flowM[3]
              lines[keyIdx] = { seg: newBare + ending, bare: newBare }
            })
          : { ok: false, reason: '未找到匹配的标签项' }
      }
      if (mode === 'rename') {
        // 精确 span：前导分隔空白不属于项本身，重命名不得吞掉它
        cur = cur.slice(0, hit.rawStart) + serializeTagScalar(replacement) + cur.slice(hit.rawEnd)
        changed = true
        continue
      }
      // 删除：吸收邻接逗号（优先后随、其次前置），保持其余项字节原样
      const after = cur.slice(hit.rawEnd)
      const mAfter = /^[ \t]*,[ \t]?/.exec(after)
      if (mAfter) {
        cur = cur.slice(0, hit.rawStart) + after.slice(mAfter[0].length)
      } else {
        const before = cur.slice(0, hit.rawStart)
        const mBefore = /,[ \t]*$/.exec(before)
        if (mBefore) cur = cur.slice(0, hit.rawStart - mBefore[0].length) + cur.slice(hit.rawEnd)
        else cur = cur.slice(0, hit.rawStart) + cur.slice(hit.rawEnd) // 唯一项：下一轮删空 → 移除键行
      }
      changed = true
    }
    return { ok: false, reason: '匹配项过多，放弃手术' }
  }

  // 3b. block 形态：键行值必须为空/空白/纯注释，向下扫 - 项
  const valueRest = keyBare.replace(KEY_RE, '')
  if (!/^[ \t]*(?:#.*)?$/.test(valueRest)) {
    return { ok: false, reason: 'tags 值非单行 flow 或空键，无法安全处理' }
  }

  const items: Array<{ lineIdx: number; value: string | null }> = []
  const blanks: number[] = []
  for (let i = keyIdx + 1; i < fenceEnd; i++) {
    const b = lines[i].bare
    if (/^[ \t]*$/.test(b) || /^[ \t]*#/.test(b)) {
      blanks.push(i)
      continue
    }
    const m = /^[ \t]*-[ \t]+(.*?)[ \t]*$/.exec(b)
    if (m) {
      if (!m[1].trim()) return { ok: false, reason: 'tags 列表含空项，无法安全处理' }
      items.push({ lineIdx: i, value: parseScalar(m[1]) })
      continue
    }
    if (/^[ \t]*-$/.test(b)) return { ok: false, reason: 'tags 列表含空项，无法安全处理' }
    if (items.length > 0) {
      // 列表已开始后的非项行：顶格（缩进 0）= 下一个顶层键，列表正常结束；
      // 缩进 >0 可能是前一项多行标量的续行，语义无法确信 → 不安全
      const indent = /^[ \t]*/.exec(b)?.[0].length ?? 0
      if (indent > 0) {
        return { ok: false, reason: 'tags 列表含无法安全处理的行（疑似多行标量或嵌套）' }
      }
    }
    break // 列表尚未开始就遇到普通行：tags 值不是列表；或顶格新键：列表结束
  }
  if (items.length === 0) return { ok: false, reason: '未找到匹配的标签项' }

  const matches = items.filter((it) => it.value !== null && it.value.normalize('NFC') === targetNfc)
  if (matches.length === 0) return { ok: false, reason: '未找到匹配的标签项' }

  if (mode === 'rename') {
    return finish(() => {
      for (const it of matches) {
        const oldSeg = lines[it.lineIdx].seg
        const ending = /(?:\r?\n)$/.exec(oldSeg)?.[0] ?? ''
        const indent = /^[ \t]*/.exec(lines[it.lineIdx].bare)?.[0] ?? ''
        const newBare = `${indent}- ${serializeTagScalar(replacement)}`
        lines[it.lineIdx] = { seg: newBare + ending, bare: newBare }
      }
    })
  }

  // 删除：尚余其他项时只移除命中项所在行；删空则移除键行 + 键与项之间的空白/注释行 + 全部项行
  if (items.length > matches.length) {
    const doomed = new Set(matches.map((it) => it.lineIdx))
    return finish(() => {
      for (let i = lines.length - 1; i >= 0; i--) if (doomed.has(i)) lines.splice(i, 1)
    })
  }
  const lastItemIdx = Math.max(...items.map((it) => it.lineIdx))
  const doomed = new Set<number>([keyIdx, ...items.map((it) => it.lineIdx)])
  for (const i of blanks) if (i < lastItemIdx) doomed.add(i)
  return finish(() => {
    for (let i = lines.length - 1; i >= 0; i--) if (doomed.has(i)) lines.splice(i, 1)
  })
}

/**
 * 对单个词条文件执行手术并落盘：读 → 手术 → 恢复原 mtime 写回 → 立即重索引。
 * 返回 not-ok（含 reason）时文件零触碰，由路由层计入 warnings。
 */
export function surgeryNoteFile(
  absPath: string,
  targetNfc: string,
  mode: SurgeryMode,
  replacement = '',
): { ok: true } | { ok: false; reason: string } {
  let raw: string
  try {
    raw = fs.readFileSync(absPath, 'utf-8')
  } catch (err) {
    return { ok: false, reason: `读取失败：${err instanceof Error ? err.message : String(err)}` }
  }
  const res = surgicalEditTags(raw, targetNfc, mode, replacement)
  if (!res.ok) return res
  try {
    const st = fs.statSync(absPath)
    fs.writeFileSync(absPath, res.content, 'utf-8')
    fs.utimesSync(absPath, st.atime, st.mtime)
  } catch (err) {
    return { ok: false, reason: `写入失败：${err instanceof Error ? err.message : String(err)}` }
  }
  // 立即重索引（writeNote 同款「写完即刻可读」——前端收到响应即失效重拉，
  // 等 chokidar 的 awaitWriteFinish 窗口会读到 stale）；随后 chokidar change
  // 事件再 upsert 一次，幂等无害
  reindexNote(absPath)
  return { ok: true }
}
