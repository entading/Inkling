import MarkdownIt from 'markdown-it'
import type { Board, NoteDetail } from '../api'
import { BOARD_ORDER } from './search'

/** 全项目唯一 markdown-it 实例（配置与 M1 阅读页一致：禁 HTML、自动链接、不换行断行） */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

/** 文件开头 --- 围栏的 frontmatter 匹配（YAML 以 ... 结束也算），正文中的 --- 分隔线不受影响 */
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

// ---------- 双向链接（M5） ----------

/**
 * [[...]] 的统一语法：内容不含 [ ] 与换行。
 * inline rule（ lastIndex 逐位匹配）与反向引用扫描共用同一模式，保证两处语义一致。
 */
export const WIKI_LINK_RE = /\[\[([^\[\]\r\n]+)\]\]/g

/**
 * 板块 → slug 集合的存在性索引；null = 尚未加载。
 * md 渲染是同步的而索引是异步的，未加载时按「存在」渲染普通样式，
 * MarkdownViewer 拉取 search-index 后调用 setLinkIndex 并触发重渲染修正。
 */
let linkIndex: Map<string, Set<string>> | null = null

/** 用 search-index 全量数据重建链接存在性索引 */
export function setLinkIndex(notes: NoteDetail[]): void {
  const idx = new Map<string, Set<string>>()
  for (const n of notes) {
    let set = idx.get(n.board)
    if (!set) {
      set = new Set()
      idx.set(n.board, set)
    }
    set.add(n.slug)
  }
  linkIndex = idx
}

function hasNote(board: string, slug: string): boolean {
  if (!linkIndex) return true
  return linkIndex.get(board)?.has(slug) ?? false
}

/** wiki 目标归一化结果：渲染与反向引用计算共用，解析规则只写这一份 */
export interface WikiTarget {
  board: Board
  slug: string
  /** 目标词条是否已存在（linkIndex 未加载时恒为 true，按存在渲染） */
  resolved: boolean
}

/**
 * 归一化一个 [[...]] 目标文本：
 * - 显式形式 board/slug：精确到板块不回落（板块名不限于四板块，非法板块自然未命中）
 * - 裸形式：默认词汇板块，未命中依次回落其余板块；全部未命中 board 兜底 vocab
 * - 板块或 slug 为空（如 [[grammar/]]）按缺失处理，不回落裸形式
 */
export function parseWikiTarget(text: string): WikiTarget {
  const t = text.trim()
  const sep = t.indexOf('/')
  if (sep === -1) {
    if (hasNote('vocab', t)) return { board: 'vocab', slug: t, resolved: true }
    for (const b of BOARD_ORDER) {
      if (b === 'vocab') continue
      if (hasNote(b, t)) return { board: b, slug: t, resolved: true }
    }
    return { board: 'vocab', slug: t, resolved: false }
  }
  const board = t.slice(0, sep).trim()
  const slug = t.slice(sep + 1).trim()
  if (!board || !slug) {
    return { board: (board || 'vocab') as Board, slug, resolved: false }
  }
  return { board: board as Board, slug, resolved: hasNote(board, slug) }
}

/**
 * [[...]] 书写文本的词法合法性：显式形式（含 /）板块与 slug 均须非空，
 * [[x/]]、[[/x]]、[[/]] 等非法目标渲染为字面文本。
 * inline rule（字面渲染判定）与 NoteView 失效链接扫描（字面目标不计入提示条）共用，
 * 词法规则只写这一份，防止渲染与提示条语义漂移。
 */
export function isLegalWikiText(text: string): boolean {
  if (!text.includes('/')) return true
  const sep = text.indexOf('/')
  return !!text.slice(0, sep).trim() && !!text.slice(sep + 1).trim()
}

/**
 * [[...]] 内联规则：产出 <a class="wiki-link">（不写 href，跳转由 MarkdownViewer 事件委托）。
 * 注册在 link 之前，[[...]] 先于普通链接语法被认领；inline 解析天然不进入 code fence / 行内代码。
 * 契约：返回 true 时必须推进 state.pos（silent 校验模式同样要求，见 markdown-it parser_inline）。
 */
md.inline.ruler.before('link', 'wiki', (state, silent) => {
  WIKI_LINK_RE.lastIndex = state.pos
  const m = WIKI_LINK_RE.exec(state.src)
  if (!m || m.index !== state.pos) return false
  const text = m[1].trim()
  // 空目标与非法显式目标（isLegalWikiText）→ 字面渲染；
  // 判定须在 silent 分支之前：skipToken 的 pos 缓存要求校验与 tokenize 两分支结论一致
  if (!text || !isLegalWikiText(text)) return false
  state.pos = m.index + m[0].length
  if (silent) return true
  const target = parseWikiTarget(text)
  const open = state.push('wiki_link_open', 'a', 1)
  open.attrSet('class', target.resolved ? 'wiki-link' : 'wiki-link is-missing')
  open.attrSet('data-board', target.board)
  open.attrSet('data-slug', target.slug)
  // 无 href（跳转靠事件委托），补 tabindex/role 使键盘可达（M7）：Tab 聚焦 + Enter 触发跳转
  open.attrSet('tabindex', '0')
  open.attrSet('role', 'link')
  // 缺失目标记录 slug 作 stub 创建预填标题（显式形式不带板块前缀；显示文本仍为原始书写文本）
  if (!target.resolved) open.attrSet('data-title', target.slug)
  const inner = state.push('text', '', 0)
  inner.content = text
  state.push('wiki_link_close', 'a', -1)
  return true
})

// ---------- frontmatter 工具（M4） ----------

/**
 * 剥离 frontmatter；无 frontmatter 时原样返回。
 * 注意：只应在「编辑器全文源码」上调用（编辑页预览）；阅读页 body 已由 gray-matter 剥离，
 * 若正文本身以 --- 开头会被误剥，故 MarkdownViewer 不做剥离。
 */
export function stripFrontmatter(source: string): string {
  const m = FM_RE.exec(source)
  return m ? source.slice(m[0].length) : source
}

/** 取文件开头的 frontmatter 块（含围栏与结尾换行，可直接拼接回源码）；无则 null */
export function extractFrontmatter(source: string): string | null {
  const m = FM_RE.exec(source)
  return m ? m[0] : null
}

/** 渲染 markdown（原样渲染，不处理 frontmatter） */
export function render(source: string): string {
  return md.render(source)
}
