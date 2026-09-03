import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import fs from 'node:fs'
import path from 'node:path'
import { BOARDS, type Board } from './types.js'
import {
  boardCounts,
  getNote,
  getNoteRaw,
  listNotes,
  allNotes,
  allNotesWithBody,
  writeNote,
  removeNote,
  noteFilePath,
  NOTES_DIR,
} from './scanner.js'
import { buildTemplate } from './templates.js'
import { LAN_STATE, buildServerInfo } from './settings.js'
import { commitNoteDeletion, commitNotesBatch } from './gitCommit.js'
import { getTagRegistry, upsertTag, removeTagFromRegistry, renameTagInRegistry } from './tagRegistry.js'
import { surgeryNoteFile } from './tagSurgery.js'
import {
  FONTS_DIR,
  aggregateFontCss,
  createFontRecord,
  detectFontFormat,
  enqueueFontSplit,
  getFont,
  listFonts,
  removeFont,
} from './fontLibrary.js'

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

// —— 标签管理（v1.1 T2）共用小工具 ————————————————————————————————

const nfc = (s: string) => s.normalize('NFC')

/** 导入字体文件大小上限：30 MB（中文整包字体普遍 10–20 MB，英文小字体数百 KB） */
const MAX_FONT_BYTES = 30 * 1024 * 1024

/** 词条是否携带某标签（NFC 归一化比较，与注册表键/tagColorIndex 查询口径一致） */
function carriesTag(tags: string[], tagNfc: string): boolean {
  return tags.some((t) => t.normalize('NFC') === tagNfc)
}

/** `next[key] = ...` 对 __proto__ 会写原型而非自有键（JSON 落盘静默丢条目），直接拒绝 */
function isUnsafeTagName(tag: string): boolean {
  return tag === '__proto__'
}

function hasOwnTag(reg: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(reg, key)
}

/** 项目根（git 工作目录）：notes/ 上一级 */
const PROJECT_ROOT = path.resolve(NOTES_DIR, '..')

/** 手术改写文件的 git 相对路径（posix 分隔符，供精确 git add） */
function relForGit(absPath: string): string {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, '/')
}

interface TagOpWarning {
  board: string
  slug: string
  reason: string
}

/**
 * 对影响面词条逐个执行 frontmatter 手术：无法安全定位/读写 → 跳过并计入 warnings
 * （部分成功如实上报），成功者即时重索引并收集 git 精确提交路径。
 */
function operateAffectedNotes(
  affected: Array<{ board: Board; slug: string }>,
  targetNfc: string,
  mode: 'remove' | 'rename',
  replacement: string,
): { done: Array<{ board: string; slug: string }>; warnings: TagOpWarning[]; changedRel: string[] } {
  const done: Array<{ board: string; slug: string }> = []
  const warnings: TagOpWarning[] = []
  const changedRel: string[] = []
  for (const n of affected) {
    const abs = noteFilePath(n.board, n.slug)
    if (!abs) {
      warnings.push({ board: n.board, slug: n.slug, reason: '索引中找不到词条文件路径' })
      continue
    }
    const res = surgeryNoteFile(abs, targetNfc, mode, replacement)
    if (res.ok) {
      done.push({ board: n.board, slug: n.slug })
      changedRel.push(relForGit(abs))
    } else {
      warnings.push({ board: n.board, slug: n.slug, reason: res.reason })
    }
  }
  return { done, warnings, changedRel }
}

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
  // F1 导入字体：multipart 上传插件（fileSize 超限在 handler 转 413；随 LAN 重建重注册）
  app.register(multipart, { limits: { fileSize: MAX_FONT_BYTES } })

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

  // 标签注册表（v1.1 T1）：注册在 registerRoutes 内，LAN 切换重建实例后随本函数重注册
  app.get('/api/tags', async () => getTagRegistry())

  app.post('/api/tags', async (req, reply) => {
    const body = req.body as { tag?: unknown; color?: unknown } | null | undefined
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'body 必须为 { tag: string, color: number } 对象' })
    }
    if (typeof body.tag !== 'string') {
      return reply.code(400).send({ error: 'tag 必须为字符串' })
    }
    const tag = body.tag.trim()
    if (!tag) {
      return reply.code(400).send({ error: 'tag 不能为空白' })
    }
    if (tag.length > 32) {
      return reply.code(400).send({ error: 'tag 不能超过 32 字符' })
    }
    if (
      typeof body.color !== 'number' ||
      !Number.isInteger(body.color) ||
      body.color < 0 ||
      body.color > 7
    ) {
      return reply.code(400).send({ error: 'color 必须为 0–7 的整数' })
    }
    try {
      upsertTag(tag, body.color)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: `写入失败：${err instanceof Error ? err.message : String(err)}` })
    }
    return getTagRegistry()
  })

  // 标签深度删除（v1.1 T2）：注册表条目 + 全部携带词条 frontmatter 中的对应标签项一并移除。
  // 无法安全手术的文件跳过并计入 warnings（部分成功如实上报）；全部先落盘、注册表最后移除
  // （注册表写失败 500 时内存未变，重试路径收敛）。
  app.delete('/api/tags/:tag', async (req, reply) => {
    const tagNfc = nfc(String((req.params as { tag?: string }).tag ?? ''))
    if (!tagNfc) return reply.code(404).send({ error: '标签不存在' })
    if (isUnsafeTagName(tagNfc)) return reply.code(400).send({ error: '标签名不合法' })
    const registry = getTagRegistry()
    const inRegistry = hasOwnTag(registry, tagNfc)
    const affected = allNotes().filter((n) => carriesTag(n.tags, tagNfc))
    if (!inRegistry && affected.length === 0) {
      return reply.code(404).send({ error: `标签不存在：${tagNfc}` })
    }
    const { done, warnings, changedRel } = operateAffectedNotes(affected, tagNfc, 'remove', '')
    if (inRegistry) {
      try {
        removeTagFromRegistry(tagNfc)
      } catch (err) {
        req.log.error(err)
        return reply.code(500).send({ error: `注册表写入失败：${err instanceof Error ? err.message : String(err)}` })
      }
    }
    if (changedRel.length > 0) {
      commitNotesBatch(`note: 删除标签「${tagNfc}」（${done.length} 个词条移除）`, changedRel)
    }
    return { registry: getTagRegistry(), removedFrom: done, warnings }
  })

  // 标签重命名（v1.1 T2）：注册表键改名（color/created 保留）+ 全部携带词条同步替换。
  // 409 = 新名（NFC）已存在于注册表或任一词条；写入词条的是 NFC 形式新名（注册表键同源）。
  app.post('/api/tags/:tag/rename', async (req, reply) => {
    const oldNfc = nfc(String((req.params as { tag?: string }).tag ?? ''))
    if (!oldNfc) return reply.code(404).send({ error: '标签不存在' })
    if (isUnsafeTagName(oldNfc)) return reply.code(400).send({ error: '标签名不合法' })
    const body = req.body as { newTag?: unknown } | null | undefined
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.code(400).send({ error: 'body 必须为 { newTag: string } 对象' })
    }
    if (typeof body.newTag !== 'string') {
      return reply.code(400).send({ error: 'newTag 必须为字符串' })
    }
    const newRaw = body.newTag.trim()
    if (!newRaw) return reply.code(400).send({ error: 'newTag 不能为空白' })
    if (newRaw.length > 32) return reply.code(400).send({ error: 'newTag 不能超过 32 字符' })
    const newNfc = nfc(newRaw)
    if (isUnsafeTagName(newNfc)) return reply.code(400).send({ error: '标签名不合法' })
    if (newNfc === oldNfc) return reply.code(400).send({ error: '新名称与旧名称相同' })

    const registry = getTagRegistry()
    const oldInRegistry = hasOwnTag(registry, oldNfc)
    const affected = allNotes().filter((n) => carriesTag(n.tags, oldNfc))
    if (!oldInRegistry && affected.length === 0) {
      return reply.code(404).send({ error: `标签不存在：${oldNfc}` })
    }
    if (hasOwnTag(registry, newNfc)) {
      return reply.code(409).send({ error: `注册表中已存在标签「${newNfc}」，合并请手工进行` })
    }
    const conflict = allNotes().find((n) => carriesTag(n.tags, newNfc))
    if (conflict) {
      return reply.code(409).send({ error: `词条 ${conflict.board}/${conflict.slug} 已携带标签「${newNfc}」，合并请手工进行` })
    }

    const { done, warnings, changedRel } = operateAffectedNotes(affected, oldNfc, 'rename', newNfc)
    if (oldInRegistry) {
      try {
        renameTagInRegistry(oldNfc, newNfc)
      } catch (err) {
        req.log.error(err)
        return reply.code(500).send({ error: `注册表写入失败：${err instanceof Error ? err.message : String(err)}` })
      }
    }
    if (changedRel.length > 0) {
      commitNotesBatch(`note: 标签重命名「${oldNfc}」→「${newNfc}」（${done.length} 个词条同步）`, changedRel)
    }
    return { registry: getTagRegistry(), renamedNotes: done, warnings }
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

  app.delete('/api/notes/:board/:slug', async (req, reply) => {
    const { board, slug } = req.params as { board: string; slug: string }
    // 校验同 PUT：板块/slug 不存在或不安全一律 404
    if (!isBoard(board)) {
      return reply.code(404).send({ error: `板块不存在：${board}` })
    }
    if (!isSafeSlug(slug)) {
      return reply.code(404).send({ error: `词条不存在：${board}/${slug}` })
    }
    if (!getNote(board, slug)) {
      return reply.code(404).send({ error: `词条不存在：${board}/${slug}` })
    }
    try {
      removeNote(board, slug)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: `删除失败：${err instanceof Error ? err.message : String(err)}` })
    }
    // 删除成功后后台自动 git 提交（不阻塞响应，失败仅警告）
    commitNoteDeletion(board, slug)
    return { ok: true }
  })

  // —— 导入字体库（F1 阅读字体管理）——————————————————————————————
  // 上传 → 落盘 + pending manifest → 立即应答 → 后台子进程分片（fontLibrary 串行队列）；
  // 前端轮询 GET /api/fonts 直到 ready/failed。全程不触碰 notes/，零 git 参与。

  app.get('/api/fonts', async () => listFonts())

  app.post('/api/fonts', async (req, reply) => {
    let name = ''
    let fileBuf: Buffer | null = null
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer()
          if (part.fieldname === 'file') fileBuf = buf
        } else if (part.fieldname === 'name') {
          name = String(part.value ?? '')
        }
      }
    } catch (err) {
      // 超限：multipart 抛 RequestFileTooLargeError（不同版本 code 不一，按消息双保险匹配）
      const msg = err instanceof Error ? err.message : String(err)
      if ((err as { code?: string }).code === 'FST_PART_FILE_TOO_LARGE' || /too large/i.test(msg)) {
        return reply.code(413).send({ error: `字体文件超过上限（${MAX_FONT_BYTES / 1024 / 1024} MB）` })
      }
      req.log.error(err)
      return reply.code(400).send({ error: `上传解析失败：${msg}` })
    }

    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 32) {
      return reply.code(400).send({ error: '字体名称必须为 1–32 个字符' })
    }
    if (!fileBuf) {
      return reply.code(400).send({ error: '缺少字体文件（multipart 字段名须为 file）' })
    }
    // 魔数判定格式（与扩展名无关）：woff/ttc 等一律拒收
    const format = detectFontFormat(fileBuf)
    if (!format) {
      return reply.code(400).send({ error: '不支持的字体格式：仅收 ttf / otf / woff2（woff / ttc 拒收）' })
    }

    try {
      const record = createFontRecord(trimmed, format, fileBuf.length)
      fs.writeFileSync(path.join(FONTS_DIR, record.id, `source.${format}`), fileBuf)
      // 先应答后台分片（E1）：分片在独立子进程跑（E2），完成后 ready/failed 由 manifest 呈现
      enqueueFontSplit(record.id)
      return record
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: `字体入库失败：${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.get('/api/fonts/css', async (_req, reply) => {
    return reply.type('text/css; charset=utf-8').send(aggregateFontCss())
  })

  app.get('/api/fonts/:id/file/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string }
    const font = getFont(id)
    if (!font || font.status !== 'ready') {
      return reply.code(404).send({ error: '字体不存在或未就绪' })
    }
    // 分片名为 [hash:6].woff2（fontSplit 产出）：白名单字符 + 显式拒 '..' + 包含校验双保险
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
      return reply.code(400).send({ error: '非法文件名' })
    }
    const chunksDir = path.join(FONTS_DIR, id, 'chunks')
    const filePath = path.resolve(chunksDir, name)
    if (!filePath.startsWith(chunksDir + path.sep)) {
      return reply.code(400).send({ error: '非法文件名' })
    }
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: '分片文件不存在' })
    }
    // 文件名含内容哈希：immutable 长缓存安全
    return reply
      .type('font/woff2')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(filePath))
  })

  app.delete('/api/fonts/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!getFont(id)) {
      return reply.code(404).send({ error: '字体不存在' })
    }
    try {
      removeFont(id)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({ error: `删除失败：${err instanceof Error ? err.message : String(err)}` })
    }
    return { ok: true }
  })
}
