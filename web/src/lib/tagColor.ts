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
