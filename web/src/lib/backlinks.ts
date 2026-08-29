import type { Board, NoteDetail } from '../api'
import { parseWikiTarget, WIKI_LINK_RE } from './markdown'
import { getSearchIndex } from './search'

/** 反向引用条目：正文中链接到目标词条的来源词条 */
export interface Backlink {
  board: Board
  slug: string
  title: string
}

/**
 * 反向引用缓存。生命周期与搜索索引一致：invalidateSearchIndex() 置空 indexPromise 后，
 * getSearchIndex() 返回新的 Promise，identity 变化即触发重建、旧缓存自然作废——
 * 无需在本模块新增失效调用点（EditView/NewNote 已有的 invalidateSearchIndex() 自动生效）。
 */
let cacheFor: Promise<NoteDetail[]> | null = null
let cacheMap: Map<string, Backlink[]> | null = null

// 独立正则对象：matchAll 的 clone 会复制原 regex 的 lastIndex，与 inline rule 共用对象会互相污染
const SCAN_RE = new RegExp(WIKI_LINK_RE.source, 'g')

/**
 * 扫描前剥离代码文本：围栏代码块与行内代码中的 [[...]] 不渲染为链接（inline 解析不进入代码），
 * 不剥离会让代码里的 wiki 语法示例凭空生成反向引用，与渲染语义不一致。
 * 已知局限：4 空格缩进代码块不剥离（无法与列表嵌套缩进安全区分，本库实际用法极少）。
 */
function stripCodeText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    .replace(/`[^`\n]*`/g, ' ')
}

/** 扫描全部词条正文中的 [[...]]，构建 目标 key（board/slug）→ 引用方列表 的反向 map */
function buildBacklinksMap(notes: NoteDetail[]): Map<string, Backlink[]> {
  const map = new Map<string, Backlink[]>()
  for (const note of notes) {
    // 同一词条多次引用同一目标只记一条；自引用不算反向引用
    const targets = new Set<string>()
    for (const m of stripCodeText(note.body).matchAll(SCAN_RE)) {
      const target = parseWikiTarget(m[1])
      if (!target.resolved) continue
      targets.add(`${target.board}/${target.slug}`)
    }
    targets.delete(`${note.board}/${note.slug}`)
    for (const key of targets) {
      const list = map.get(key)
      const item: Backlink = { board: note.board, slug: note.slug, title: note.title }
      if (list) list.push(item)
      else map.set(key, [item])
    }
  }
  return map
}

/** 目标词条（board, slug）的反向引用列表；无引用返回空数组 */
export async function getBacklinks(board: Board, slug: string): Promise<Backlink[]> {
  const indexPromise = getSearchIndex()
  const index = await indexPromise
  if (cacheFor !== indexPromise) {
    cacheMap = buildBacklinksMap(index)
    cacheFor = indexPromise
  }
  return cacheMap?.get(`${board}/${slug}`) ?? []
}
