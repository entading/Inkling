import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import chokidar, { type FSWatcher } from 'chokidar'
import { BOARD_LABELS, BOARDS, type Board, type Note, type NoteWithBody } from './types.js'

export const NOTES_DIR = path.resolve(import.meta.dirname, '../../notes')

/** 内存索引：板块 -> slug -> 词条 */
const index = new Map<Board, Map<string, Note>>()

/** 统一按 UTC 组件输出 YYYY-MM-DD（YAML 裸日期解析为 UTC 午夜 Date） */
function dateOf(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function boardOf(filePath: string): Board | null {
  const rel = path.relative(NOTES_DIR, filePath)
  const relBoard = rel.split(path.sep)[0]
  return BOARDS.includes(relBoard as Board) ? (relBoard as Board) : null
}

/** 解析一个 md 文件：gray-matter + 无 frontmatter 兜底 */
function parseNote(filePath: string): Note | null {
  const board = boardOf(filePath)
  if (!board) return null

  const raw = fs.readFileSync(filePath, 'utf-8')
  const stat = fs.statSync(filePath)
  const data = matter(raw)
  const slug = path.basename(filePath, '.md')

  const created: Date =
    stat.birthtime.getTime() > 0 ? stat.birthtime : stat.mtime
  const updated: Date = stat.mtime

  const note: Note = {
    board,
    slug,
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
  if (d && !Number.isNaN(d.getTime())) return dateOf(d)
  return dateOf(fallback)
}

function upsert(filePath: string): void {
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

/** 启动时全量扫描 */
export function scanAll(): void {
  for (const board of BOARDS) {
    const dir = path.join(NOTES_DIR, board)
    if (!fs.existsSync(dir)) {
      index.set(board, new Map())
      continue
    }
    const slugMap = new Map<string, Note>()
    index.set(board, slugMap)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const note = parseNote(filePath)
        if (note) slugMap.set(note.slug, note)
      }
    }
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

export function getNote(board: Board, slug: string): NoteWithBody | null {
  const note = index.get(board)?.get(slug)
  if (!note) return null
  const filePath = path.join(NOTES_DIR, board, `${slug}.md`)
  const raw = fs.readFileSync(filePath, 'utf-8')
  return { ...note, body: matter(raw).content }
}

export function listNotes(board: Board): Note[] {
  return [...(index.get(board)?.values() ?? [])]
}

export function boardCounts(): Array<{ board: Board; label: string; count: number }> {
  return BOARDS.map((board) => ({
    board,
    label: BOARD_LABELS[board],
    count: index.get(board)?.size ?? 0,
  }))
}

export function allNotes(): Note[] {
  return BOARDS.flatMap((board) => [...(index.get(board)?.values() ?? [])])
}
