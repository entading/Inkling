import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  BOARD_LABELS,
  BOARDS,
  type Board,
  type Note,
  type NotePublic,
  type NoteWithBody,
  type NoteWithRaw,
} from './types.js'

export const NOTES_DIR = path.resolve(import.meta.dirname, '../../notes')

/** 内存索引：板块 -> slug -> 词条 */
const index = new Map<Board, Map<string, Note>>()

/** 日期值（YAML 裸日期是 UTC 午夜 Date）按 UTC 组件输出，还原用户所写日期 */
function dateOfUtc(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 文件系统时间（本地时刻）按本地组件输出，避免 UTC+8 凌晨回退偏一天 */
export function dateOfLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function boardOf(filePath: string): Board | null {
  const rel = path.relative(NOTES_DIR, filePath)
  const relBoard = rel.split(path.sep)[0]
  return BOARDS.includes(relBoard as Board) ? (relBoard as Board) : null
}

/**
 * 解析 frontmatter；YAML 语法错误时按「无 frontmatter」兜底（title=文件名、
 * 正文=全文原文，坏 FM 行以文本可见，用户可读可改），仅 warn 不中断服务。
 */
function parseFrontmatter(raw: string, filePath: string): { data: Record<string, unknown>; content: string } {
  try {
    return matter(raw)
  } catch (err) {
    console.warn(
      `frontmatter YAML 解析失败（已按无 frontmatter 兜底）：${filePath} —— ${err instanceof Error ? err.message : String(err)}`,
    )
    return { data: {}, content: raw }
  }
}

/** 解析一个 md 文件：gray-matter + 无 frontmatter 兜底 */
function parseNote(filePath: string): Note | null {
  const board = boardOf(filePath)
  if (!board) return null

  let raw: string
  let stat: fs.Stats
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
    stat = fs.statSync(filePath)
  } catch {
    return null // 读盘竞态：文件已被删除
  }
  const data = parseFrontmatter(raw, filePath)
  const slug = path.basename(filePath, '.md')

  const created: Date =
    stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime
  const updated: Date = stat.mtime

  const note: Note = {
    board,
    slug,
    filePath: path.relative(NOTES_DIR, filePath),
    title: typeof data.data.title === 'string' && data.data.title.trim() ? data.data.title.trim() : slug,
    tags: Array.isArray(data.data.tags) ? data.data.tags.map(String) : [],
    created: createDateStr(data.data.created, created),
    updated: createDateStr(data.data.updated, updated),
  }
  if (typeof data.data.ipa === 'string' && data.data.ipa.trim()) note.ipa = data.data.ipa.trim()
  if (typeof data.data.source === 'string' && data.data.source.trim()) note.source = data.data.source.trim()
  return note
}

/** 取 frontmatter 中的日期（字符串或 YAML 解析出的 Date），非法则回退到文件时间 */
function createDateStr(value: unknown, fallback: Date): string {
  const d =
    typeof value === 'string' ? new Date(value) : value instanceof Date ? value : null
  if (d && !Number.isNaN(d.getTime())) return dateOfUtc(d)
  return dateOfLocal(fallback)
}

function upsert(filePath: string): void {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch {
    return // 事件竞态：文件已被删除
  }
  if (!stat.isFile() || !filePath.endsWith('.md')) return
  const note = parseNote(filePath)
  if (!note) return
  let slugMap = index.get(note.board)
  if (!slugMap) {
    slugMap = new Map()
    index.set(note.board, slugMap)
  }
  slugMap.set(note.slug, note)
}

function remove(filePath: string): void {
  const board = boardOf(filePath)
  if (!board) return
  const slugMap = index.get(board)
  if (!slugMap) return
  const slug = path.basename(filePath, '.md')
  // 仅当文件确实不存在时才删除，避免误删临时写入的中间态
  if (!fs.existsSync(filePath)) slugMap.delete(slug)
}

/** 递归收集板块目录下所有 .md（与 chokidar 的递归监听行为一致） */
function scanDir(dir: string, slugMap: Map<string, Note>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanDir(filePath, slugMap)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const note = parseNote(filePath)
      if (note) slugMap.set(note.slug, note)
    }
  }
}

/** 启动时全量扫描 */
export function scanAll(): void {
  for (const board of BOARDS) {
    const dir = path.join(NOTES_DIR, board)
    const slugMap = new Map<string, Note>()
    index.set(board, slugMap)
    if (fs.existsSync(dir)) scanDir(dir, slugMap)
  }
}

/** 监听 notes/ 增量更新；返回 watcher 以便关闭 */
export function watch(delayMs = 150): FSWatcher {
  const watcher = chokidar.watch(NOTES_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: delayMs,
      pollInterval: 50,
    },
  })
  watcher.on('add', upsert)
  watcher.on('change', upsert)
  watcher.on('unlink', remove)
  return watcher
}

/** 剥离内部字段（filePath），得到对外 API 形态 */
function toPublic(note: Note): NotePublic {
  const { filePath: _filePath, ...pub } = note
  return pub
}

export function getNote(board: Board, slug: string): NoteWithBody | null {
  const note = index.get(board)?.get(slug)
  if (!note) return null
  const raw = fs.readFileSync(path.join(NOTES_DIR, note.filePath), 'utf-8')
  return { ...toPublic(note), body: parseFrontmatter(raw, note.filePath).content }
}

/** 单条完整数据 + 原始文件源码（含 frontmatter），编辑页用 */
export function getNoteRaw(board: Board, slug: string): NoteWithRaw | null {
  const note = index.get(board)?.get(slug)
  if (!note) return null
  const raw = fs.readFileSync(path.join(NOTES_DIR, note.filePath), 'utf-8')
  return { ...toPublic(note), body: parseFrontmatter(raw, note.filePath).content, raw }
}

export function listNotes(board: Board): NotePublic[] {
  return [...(index.get(board)?.values() ?? [])].map(toPublic)
}

export function boardCounts(): Array<{ board: Board; label: string; count: number }> {
  return BOARDS.map((board) => ({
    board,
    label: BOARD_LABELS[board],
    count: index.get(board)?.size ?? 0,
  }))
}

export function allNotes(): NotePublic[] {
  return BOARDS.flatMap((board) => [...(index.get(board)?.values() ?? [])]).map(toPublic)
}

/** 全量词条（含正文），供前端一次性拉取建搜索索引 */
export function allNotesWithBody(): NoteWithBody[] {
  return allNotes().flatMap((n) => {
    try {
      const full = getNote(n.board, n.slug)
      return full ? [full] : []
    } catch {
      // 扫描与读盘之间的竞态（文件刚被删除），跳过该条
      return []
    }
  })
}

/**
 * 全量写入原始 md 源码（原样落盘，不改写内容），并立即 upsert 内存索引——
 * 不依赖 chokidar 的 awaitWriteFinish 窗口，写完即刻可读（读接口 / 列表零延迟一致）。
 */
export function writeNote(board: Board, slug: string, content: string): NoteWithBody {
  const dir = path.join(NOTES_DIR, board)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${slug}.md`)
  fs.writeFileSync(filePath, content, 'utf-8')
  upsert(filePath)
  const note = getNote(board, slug)
  if (!note) throw new Error(`写入后索引缺失：${board}/${slug}`)
  return note
}

/**
 * 删除词条文件并立即从内存索引移除——与 writeNote「写后立即 upsert」对称，
 * 不依赖 chokidar 的 awaitWriteFinish 窗口（读接口 / 列表零延迟一致）。
 * 用索引中的 filePath 定位：词条可能带子目录（手写 notes/<board>/sub/<slug>.md，
 * slug 只是文件名），按 board/slug 重拼会 ENOENT 500，甚至误删根目录同名文件。
 * chokidar 随后的 unlink 触发内部 remove() 时有 existsSync 守卫，幂等安全。
 */
export function removeNote(board: Board, slug: string): void {
  const note = index.get(board)?.get(slug)
  if (!note) return
  const filePath = path.join(NOTES_DIR, note.filePath)
  fs.rmSync(filePath)
  index.get(board)?.delete(slug)
}

/** 词条文件绝对路径（经索引定位，子目录词条安全）；不在索引时返回 null（v1.1 T2 标签手术用） */
export function noteFilePath(board: Board, slug: string): string | null {
  const note = index.get(board)?.get(slug)
  if (!note) return null
  return path.join(NOTES_DIR, note.filePath)
}

/** 外部（标签手术）改写词条文件后立即重索引——不等 chokidar 的 awaitWriteFinish 窗口 */
export function reindexNote(filePath: string): void {
  upsert(filePath)
}
