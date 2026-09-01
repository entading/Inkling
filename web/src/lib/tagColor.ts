import { tagRegistryRef } from './tagRegistry'

/**
 * 标签 8 色稳定取色（§5）：djb2 hash(tag) % 8 → tag-pair-N（tokens.css 应用类）。
 * 同一标签在任何页面/会话取色一致；注意：更换 hash 算法会让全部标签重新分配颜色。
 */
export function tagPairIndex(tag: string): number {
  let h = 5381
  for (let i = 0; i < tag.length; i++) {
    h = ((h << 5) + h + tag.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 8
}

/**
 * 取色解析（v1.1 标签实体化）：注册表优先（人工指定色），未命中回落 djb2 稳定 hash。
 * 读 shallowRef 镜像，在 computed 中使用即获响应式——注册表就绪/改色后全站自动重上色。
 */
export function tagColorIndex(tag: string): number {
  const entry = tagRegistryRef.value[tag]
  return entry ? entry.color : tagPairIndex(tag)
}
