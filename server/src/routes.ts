import type { FastifyInstance } from 'fastify'
import { BOARDS, type Board } from './types.js'
import {
  boardCounts,
  getNote,
  getNoteRaw,
  listNotes,
  allNotes,
  allNotesWithBody,
  writeNote,
} from './scanner.js'
import { buildTemplate } from './templates.js'
import { LAN_STATE, buildServerInfo } from './settings.js'

/** 由 index.ts 注入：请求切换局域网监听（后台执行，先应答后 close→re-listen） */
export interface ServerHooks {
  toggleLan: (enabled: boolean) => void
}

function isBoard(value: string): value is Board {
  return (BOARDS as string[]).includes(value)
}

/** 拒绝路径穿越与分隔符，slug 必须是一段安全的文件名（不含扩展名） */
function isSafeSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  )
}

/** Win32 保留设备名；「CON.md」这类带扩展名的首段命中同样不可写 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

/** 写盘专用：在 isSafeSlug 基础上补 Windows 保留名与结尾点/空格（写这类文件名抛 EINVAL） */
function isWritableSlug(value: string): boolean {
  if (!isSafeSlug(value)) return false
  if (value.endsWith('.') || value.endsWith(' ')) return false
  return !WINDOWS_RESERVED.has(value.split('.', 1)[0].toUpperCase())
}

/** 词汇按字母序（title），其余按 updated 倒序 */
function sortNotes(board: Board) {
  const notes = listNotes(board)
  if (board === 'vocab') {
    return notes.sort((a, b) => a.title.localeCompare(b.title))
  }
  return notes.sort((a, b) => b.updated.localeCompare(a.updated))
}

export function registerRoutes(app: FastifyInstance, hooks?: ServerHooks): void {
  app.get('/api/boards', async () => boardCounts())

  app.get('/api/notes', async (req, reply) => {
    const { board } = req.query as { board?: string }
    if (!board || !isBoard(board)) {
      return reply.code(400).send({ error: `未知板块：${board ?? ''}，可选值为 ${BOARDS.join('/')}` })
    }
    return sortNotes(board)
  })

  app.get('/api/notes/:board/:slug', async (req, reply) => {
    const { board, slug } = req.params as { board: string; slug: string }
    if (!isBoard(board)) {
      return reply.code(404).send({ error: `板块不存在：${board}` })
    }
    if (!isSafeSlug(slug)) {
      return reply.code(404).send({ error: `词条不存在：${board}/${slug}` })
    }
    const note = getNoteRaw(board, slug)
    if (!note) {
      return reply.code(404).send({ error: `词条不存在：${board}/${slug}` })
    }
    return note
  })

  app.get('/api/search-index', async () => {
    return allNotesWithBody()
  })

  app.get('/api/recent', async (req) => {
    const { limit } = req.query as { limit?: string }
    const n = Math.max(1, Math.min(parseInt(limit ?? '10', 10) || 10, 100))
    return allNotes()
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .slice(0, n)
  })

  app.get('/api/server-info', async () => {
    return buildServerInfo(LAN_STATE.enabled)
  })

  app.post('/api/settings', async (req, reply) => {
    const body = req.body as { lanEnabled?: unknown } | null | undefined
    if (!body || typeof body.lanEnabled !== 'boolean') {
      return reply.code(400).send({ error: 'body 必须为 { lanEnabled: boolean }' })
    }
    // 切换在后台执行：先应答再 close→re-listen（close 等当前请求结束，路由内 await 会死锁）。
    // 应答反映目标状态；若切换失败服务端会回滚，前端核对 /api/server-info 提示。
    hooks?.toggleLan(body.lanEnabled)
    return buildServerInfo(body.lanEnabled)
  })

  app.post('/api/notes', async (req, reply) => {
    const body = req.body as {
      board?: unknown
      slug?: unknown
      title?: unknown
      tags?: unknown
      source?: unknown
    } | null | undefined
    if (!body) return reply.code(400).send({ error: 'body 不能为空' })
    const { board, slug, title, tags, source } = body
    if (typeof board !== 'string' || !isBoard(board)) {
      return reply.code(400).send({ error: `未知板块：${String(board ?? '')}，可选值为 ${BOARDS.join('/')}` })
    }
    if (typeof slug !== 'string' || !isWritableSlug(slug)) {
      return reply.code(400).send({ error: `slug 非法：${String(slug ?? '')}（不能含路径分隔符，不能是 Windows 保留名，不能以点或空格结尾）` })
    }
    if (typeof title !== 'string' || !title.trim()) {
      return reply.code(400).send({ error: 'title 不能为空' })
    }
    if (listNotes(board).some((n) => n.slug === slug)) {
      return reply.code(409).send({ error: `slug 已存在：${board}/${slug}，请换一个` })
    }
    const tagList = Array.isArray(tags)
      ? tags.map(String).map((t) => t.trim()).filter(Boolean)
      : []
    const src = typeof source === 'string' ? source.trim() : ''
    try {
      return writeNote(board, slug, buildTemplate(board, { title: title.trim(), tags: tagList, source: src }))
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: `写入失败：${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.put('/api/notes/:board/:slug', async (req, reply) => {
    const { board, slug } = req.params as { board: string; slug: string }
    // 校验同读接口：板块/slug 不存在或不安全一律 404
    if (!isBoard(board)) {
      return reply.code(404).send({ error: `板块不存在：${board}` })
    }
    if (!isSafeSlug(slug)) {
      return reply.code(404).send({ error: `词条不存在：${board}/${slug}` })
    }
    const body = req.body as { content?: unknown } | null | undefined
    if (!body || typeof body.content !== 'string') {
      return reply.code(400).send({ error: 'body 必须为 { content: string }' })
    }
    if (!getNote(board, slug)) {
      return reply.code(404).send({ error: `词条不存在：${board}/${slug}` })
    }
    try {
      return writeNote(board, slug, body.content)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: `写入失败：${err instanceof Error ? err.message : String(err)}` })
    }
  })
}
