import fs from 'node:fs'
import path from 'node:path'
import { dateOfLocal } from './scanner.js'

/**
 * 标签注册表（v1.1）：标签作为可独立存在、可携带色板颜色的实体，持久化于
 * data/tags.json（仓库根、notes/ 之外——避免 chokidar 重扫抖动与 DELETE 自动
 * 提交把注册表卷进笔记提交）。结构：{ "标签名": { color: 0-7, created } }。
 */

export const REGISTRY_PATH = path.resolve(import.meta.dirname, '../../data/tags.json')
const REGISTRY_DIR = path.dirname(REGISTRY_PATH)

export type TagRegistry = Record<string, { color: number; created: string }>

let registry: TagRegistry = {}

// 模块级加载：routes.ts 引入本模块即完成初始化，index.ts 无需感知。
// 损坏/缺失一律视为空表 + 告警，服务不拒启（用户下次改色即重建文件）。
try {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    registry = parsed as TagRegistry
  } else {
    console.warn(`标签注册表不是 JSON 对象，已按空表兜底：${REGISTRY_PATH}`)
  }
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn(
      `标签注册表加载失败（已按空表兜底）：${REGISTRY_PATH} —— ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** 原子写：同目录临时文件 + rename（Windows 上 rename 覆盖已存在目标），杜绝半文件 */
function persist(next: TagRegistry): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true })
  const tmp = `${REGISTRY_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, REGISTRY_PATH)
}

export function getTagRegistry(): TagRegistry {
  return registry
}

/**
 * upsert：已存在仅更新 color（保留 created）；不存在创建（created = 当天本地日期）。
 * 键做 NFC 规范化（规范等价，视觉零变化）——堵 NFD/NFC 重复键的洞；大小写保持
 * 敏感（与笔记 frontmatter 标签语义一致，静默小写会改变用户输入并破坏颜色绑定）。
 * 先写盘后改内存：写盘失败向上抛（路由转 500），内存保持与磁盘一致。
 */
export function upsertTag(tag: string, color: number): TagRegistry {
  const key = tag.normalize('NFC')
  const next: TagRegistry = { ...registry }
  next[key] = { color, created: next[key]?.created ?? dateOfLocal(new Date()) }
  persist(next)
  registry = next
  return registry
}

/**
 * 移除注册表条目（v1.1 T2 深度删除的注册表侧）；不存在的键幂等返回现表。
 * 键必须为 NFC 形式（路由层归一）；判存走 hasOwnProperty（防原型链误判）。
 * 先写盘后改内存：写盘失败向上抛（路由转 500），内存保持与磁盘一致。
 */
export function removeTagFromRegistry(tagNfc: string): TagRegistry {
  if (!Object.prototype.hasOwnProperty.call(registry, tagNfc)) return registry
  const next: TagRegistry = { ...registry }
  delete next[tagNfc]
  persist(next)
  registry = next
  return registry
}

/**
 * 注册表键改名（v1.1 T2 重命名的注册表侧）：color/created 原样保留；
 * 旧键不存在幂等返回现表（路由层已做 404 判定，这里兜底）。先写盘后改内存。
 */
export function renameTagInRegistry(oldNfc: string, newNfc: string): TagRegistry {
  if (!Object.prototype.hasOwnProperty.call(registry, oldNfc)) return registry
  const entry = registry[oldNfc]
  const next: TagRegistry = { ...registry }
  delete next[oldNfc]
  next[newNfc] = { color: entry.color, created: entry.created }
  persist(next)
  registry = next
  return registry
}
