import { shallowRef } from 'vue'
import { api, type TagRegistry } from '../api'

/**
 * 标签注册表客户端缓存（v1.1）：Promise 缓存照 getSearchIndex 模式；额外维护
 * tagRegistryRef 响应式镜像——注册表未就绪时为 {}（取色回落 djb2 hash），就绪/
 * 失效重载/upsert 后整体替换 .value，依赖它的 computed 自动重算完成全站重上色
 * （MarkdownViewer linkVersion 同款思路）。
 *
 * 一致性守卫（全面审查 B2/B6 定稿）：mutationSeq 每次 upsert 调用递增——
 * - upsert 响应仅在自己是最新一次调用时应用（乱序返回的过期快照直接丢弃）；
 * - GET 发起时记录快照，期间若发生过 upsert 则响应不覆盖 ref（预载竞态根治）。
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
