import Fuse, { type FuseOptionKey } from 'fuse.js'
import { api, type Board, type NoteDetail, type NoteMeta } from '../api'

/** 板块展示名（搜索结果分组、标签合集分组共用） */
export const BOARD_ORDER: Board[] = ['vocab', 'phrase', 'sentence', 'grammar']

export const BOARD_LABELS: Record<Board, string> = {
  vocab: '词汇',
  phrase: '短语',
  sentence: '长难句',
  grammar: '语法',
}

/** 分组搜索结果：每组至多展示 5 条，total 为组内实际命中总数 */
export interface SearchGroup {
  board: Board
  label: string
  total: number
  notes: NoteDetail[]
}

export interface TagCount {
  tag: string
  count: number
}

/** 全量索引 Promise 缓存；失败后清空以便下次聚焦重试 */
let indexPromise: Promise<NoteDetail[]> | null = null

export function getSearchIndex(): Promise<NoteDetail[]> {
  if (!indexPromise) {
    indexPromise = api.searchIndex().catch((e) => {
      indexPromise = null
      throw e
    })
  }
  return indexPromise
}

/** 使全量索引缓存失效：新建/编辑词条写盘成功后调用，下次 getSearchIndex() 自动重新拉取 */
export function invalidateSearchIndex(): void {
  indexPromise = null
}

/** 按 板块 + slug 精确查找词条（wiki 链接悬停预览用）；未命中返回 null */
export async function findNote(board: Board, slug: string): Promise<NoteDetail | null> {
  const index = await getSearchIndex()
  return index.find((n) => n.board === board && n.slug === slug) ?? null
}

const BASE_KEYS: FuseOptionKey<NoteDetail>[] = ['title', 'tags']
const BODY_KEYS: FuseOptionKey<NoteDetail>[] = ['title', 'tags', 'body']

export function buildFuse<T>(items: T[], keys: FuseOptionKey<T>[]): Fuse<T> {
  return new Fuse(items, {
    keys,
    // 忽略位置（中文子串命中）、放宽阈值（容忍拼写错误）
    ignoreLocation: true,
    threshold: 0.35,
    minMatchCharLength: 1,
  })
}

export function runFuse<T>(fuse: Fuse<T>, q: string): T[] {
  return fuse.search(q.trim()).map((r) => r.item)
}

/** 板块内就地过滤：大小写不敏感子串匹配（title/tags/ipa/source；fulltext 时加搜 body）。
 * 模糊容忍是全局搜索语义；板块内快速收窄用子串更可预期 */
export function searchBoard(
  notes: NoteMeta[],
  q: string,
  boardData: NoteDetail[] | null,
  opts: { fulltext?: boolean } = {},
): NoteMeta[] {
  const query = q.trim().toLowerCase()
  if (!query) return notes
  const pool: NoteMeta[] = opts.fulltext && boardData ? boardData : notes
  const withBody = opts.fulltext && boardData
  return pool.filter((n) => {
    const fields = [n.title, ...n.tags, n.ipa ?? '', n.source ?? '']
    if (withBody) fields.push((n as NoteDetail).body)
    return fields.some((v) => v.toLowerCase().includes(query))
  })
}

/** 精确（title 完全相等）与前缀（title 以 q 开头）排在模糊结果之前；均忽略大小写 */
function rankExactFirst(results: NoteDetail[], q: string): NoteDetail[] {
  const lower = q.toLowerCase()
  const exact = new Set<NoteDetail>()
  const prefix = new Set<NoteDetail>()
  for (const n of results) {
    const title = n.title.toLowerCase()
    if (title === lower) exact.add(n)
    else if (title.startsWith(lower)) prefix.add(n)
  }
  return [
    ...[...exact],
    ...[...prefix],
    ...results.filter((n) => !exact.has(n) && !prefix.has(n)),
  ]
}

const GROUP_LIMIT = 5

/** 全局搜索：按板块分组，精确优先，每组至多 5 条；不返回空组 */
export async function search(
  q: string,
  opts: { fulltext?: boolean } = {},
): Promise<SearchGroup[]> {
  const query = q.trim()
  if (!query) return []
  const index = await getSearchIndex()
  const fuse = buildFuse(index, opts.fulltext ? BODY_KEYS : BASE_KEYS)
  const ranked = rankExactFirst(runFuse(fuse, query), query)

  const groups: SearchGroup[] = []
  for (const board of BOARD_ORDER) {
    const hits = ranked.filter((n) => n.board === board)
    if (hits.length > 0) {
      groups.push({
        board,
        label: BOARD_LABELS[board],
        total: hits.length,
        notes: hits.slice(0, GROUP_LIMIT),
      })
    }
  }
  return groups
}

/** 标签聚合：tag → 词条数，按计数降序、同数按标签升序 */
export async function aggregateTags(): Promise<TagCount[]> {
  const index = await getSearchIndex()
  const counts = new Map<string, number>()
  for (const n of index) {
    for (const tag of n.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
