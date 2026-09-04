import { shallowRef } from 'vue'
import { api, type TagRegistry } from '../api'
import { aggregateTags, invalidateSearchIndex } from './search'
import { tagColorIndex } from './tagColor'

/**
 * 标签注册表客户端缓存（v1.1）：Promise 缓存照 getSearchIndex 模式；额外维护
 * tagRegistryRef 响应式镜像——注册表未就绪时为 {}（取色回落 djb2 hash），就绪/
 * 失效重载/upsert 后整体替换 .value，依赖它的 computed 自动重算完成全站重上色
 * （MarkdownViewer linkVersion 同款思路）。
 *
 * 一致性守卫（全面审查 B2/B6 定稿）：mutationSeq 每次写操作调用递增——
 * - 写响应仅在自己是最新一次调用时应用（乱序返回的过期快照直接丢弃）；
 * - GET 发起时记录快照，期间若发生过写操作则响应不覆盖 ref（预载竞态根治）。
 */

export const tagRegistryRef = shallowRef<TagRegistry>({})

let registryPromise: Promise<TagRegistry> | null = null
let mutationSeq = 0

function apply(reg: TagRegistry): TagRegistry {
  tagRegistryRef.value = reg
  return reg
}

export function getTagRegistry(): Promise<TagRegistry> {
  if (!registryPromise) {
    const issuedAt = mutationSeq
    registryPromise = api.tags().then((reg) => {
      // 发起后发生过本地 upsert：响应是过期快照，只回填缓存不覆盖 ref
      if (issuedAt === mutationSeq) apply(reg)
      return reg
    }).catch((e) => {
      registryPromise = null
      throw e
    })
  }
  return registryPromise
}

/** 使注册表缓存失效并重拉（跨页签/回焦同步使用，见下方监听） */
export function invalidateTagRegistry(): void {
  registryPromise = null
}

/**
 * upsert（B6 定稿）：序列号守卫下请求可安全并发——乱序返回的过期快照被丢弃，
 * 最终 ref 恒为最新一次调用之后的注册表状态；成功后本地立即生效并广播他页签。
 */
export async function upsertTag(tag: string, color: number): Promise<TagRegistry> {
  const seq = ++mutationSeq
  const reg = await api.upsertTag(tag, color)
  if (seq === mutationSeq) {
    apply(reg)
    broadcast()
  }
  return reg
}

/**
 * 深度删除（v1.1 T2）：注册表条目 + 全部携带词条的标签项一并移除。注册表应用走
 * 序列号守卫（同 upsert）；词条已变更的事实不受守卫影响——invalidateSearchIndex
 * 无条件调用（invalidateSearchIndex 全站第 4 处调用点：新建/编辑/删除词条 + 此处
 * 与 renameTag），下次 getSearchIndex() 自动重拉，色卡墙/列表徽章/搜索三处同步。
 */
export async function deleteTag(tag: string): Promise<ReturnType<typeof api.deleteTag>> {
  const seq = ++mutationSeq
  const res = await api.deleteTag(tag)
  if (seq === mutationSeq) {
    apply(res.registry)
    broadcast()
  }
  invalidateSearchIndex()
  return res
}

/** 重命名（v1.1 T2）：语义同 deleteTag——注册表守卫应用 + 搜索索引无条件失效 */
export async function renameTag(tag: string, newTag: string): Promise<ReturnType<typeof api.renameTag>> {
  const seq = ++mutationSeq
  const res = await api.renameTag(tag, newTag)
  if (seq === mutationSeq) {
    apply(res.registry)
    broadcast()
  }
  invalidateSearchIndex()
  return res
}

/**
 * 一键批量注册携带标签（G1.5）：聚合当前词条携带的标签，过滤已注册，颜色取
 * tagColorIndex（未注册 = djb2 回落色）——注册前后显示色零变化（哈希唯一来源
 * 保持在本库依赖的 tagColor.ts，不传服务端第二份 hash）。注册表应用走序列号
 * 守卫 + 广播（同 upsertTag）；只写注册表不改词条，无需失效搜索索引。
 * 返回实际新增的标签名列表。
 */
export async function registerCarriedTags(): Promise<string[]> {
  const seq = ++mutationSeq
  const [agg, reg] = await Promise.all([aggregateTags(), getTagRegistry()])
  const items = agg
    .filter((t) => !Object.prototype.hasOwnProperty.call(reg, t.tag.normalize('NFC')))
    .map((t) => ({ tag: t.tag, color: tagColorIndex(t.tag) }))
  if (items.length === 0) return []
  const res = await api.registerCarriedTags(items)
  if (seq === mutationSeq) {
    apply(res.registry)
    broadcast()
  }
  return res.registered
}

// —— 跨页签/跨设备同步（全面审查 B3 定稿，轻量方案）：
// 同浏览器页签经 BroadcastChannel 互通知重拉；跨设备靠「回到页签」时重拉兜底。
// 局域网 http 非安全上下文可能无 BroadcastChannel，try/catch 降级为仅焦点重拉。
let channel: BroadcastChannel | null = null
let lastSyncAt = 0

function resync(): void {
  invalidateTagRegistry()
  void getTagRegistry().catch(() => {})
}

try {
  channel = new BroadcastChannel('en_tool:tag-registry')
  channel.onmessage = () => resync()
} catch {
  /* 无 BroadcastChannel（非安全上下文等）：仅靠 focus/visibility 重拉 */
}

function broadcast(): void {
  channel?.postMessage(Date.now())
}

function resyncThrottled(): void {
  // focus 与 visibilitychange 在切页签时常同时触发，5s 节流防重复拉取
  if (Date.now() - lastSyncAt < 5000) return
  lastSyncAt = Date.now()
  resync()
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', resyncThrottled)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resyncThrottled()
  })
}
