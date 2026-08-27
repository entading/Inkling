import type { FastifyInstance } from 'fastify'
import { BOARDS, type Board } from './types.js'
import {
  boardCounts,
  getNote,
  listNotes,
  allNotes,
  allNotesWithBody,
} from './scanner.js'

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

/** 词汇按字母序（title），其余按 updated 倒序 */
function sortNotes(board: Board) {
  const notes = listNotes(board)
  if (board === 'vocab') {
    return notes.sort((a, b) => a.title.localeCompare(b.title))
  }
  return notes.sort((a, b) => b.updated.localeCompare(a.updated))
}

export function registerRoutes(app: FastifyInstance): void {
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
    const note = getNote(board, slug)
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
}
