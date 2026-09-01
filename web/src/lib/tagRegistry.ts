import { shallowRef } from 'vue'
import { api, type TagRegistry } from '../api'

/**
 * 标签注册表客户端缓存（v1.1）：Promise 缓存照 getSearchIndex 模式；额外维护
 * tagRegistryRef 响应式镜像——注册表未就绪时为 {}（取色回落 djb2 hash），就绪/
 * 失效重载/upsert 后整体替换 .value，依赖它的 computed 自动重算完成全站重上色
 * （MarkdownViewer linkVersion 同款响应式修正思路）。
 */

export const tagRegistryRef = shallowRef<TagRegistry>({})

let registryPromise: Promise<TagRegistry> | null = null

function apply(reg: TagRegistry): TagRegistry {
  tagRegistryRef.value = reg
  return reg
}

export function getTagRegistry(): Promise<TagRegistry> {
  if (!registryPromise) {
    registryPromise = api.tags().then(apply).catch((e) => {
      registryPromise = null
      throw e
    })
  }
  return registryPromise
}

/** 使注册表缓存失效：下次 getTagRegistry() 自动重新拉取 */
export function invalidateTagRegistry(): void {
  registryPromise = null
}

/** upsert 成功后用响应直接生效（省一次 GET）：更新 ref 并把缓存置为已解决的 Promise */
export function applyTagRegistry(reg: TagRegistry): void {
  tagRegistryRef.value = reg
  registryPromise = Promise.resolve(reg)
}
