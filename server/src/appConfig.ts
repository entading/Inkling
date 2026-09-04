import fs from 'node:fs'
import path from 'node:path'

/**
 * 应用级配置（G1 数据目录管理）：notes 数据目录可配置化。
 * - 持久化于 data/app-settings.json（仓库根、notes/ 之外——与 tags.json 同侧，不随数据目录走，
 *   也天然不在 chokidar 监听与 git 自动提交范围内）；
 * - 原子写 = 同目录 tmp 文件 + fs.renameSync（Windows 下 rename 可覆盖已存在目标），
 *   写盘成功后才更新内存镜像（tagRegistry 同款语义）；
 * - 生效目录在启动期一次性解析，进程内恒定（D1 决策：重启生效，无运行时切换）；
 *   persistNotesDir 只写配置文件，本进程继续用旧目录直到重启；
 * - 配置目录缺失 → console.warn + 回退默认目录 + configuredMissing 标记（配置保留不删，
 *   目录恢复后下次重启自然生效）；配置损坏/非法 → 同样回落默认不拒启。
 */

export const DEFAULT_NOTES_DIR = path.resolve(import.meta.dirname, '../../notes')

const APP_SETTINGS_PATH = path.resolve(import.meta.dirname, '../../data/app-settings.json')

interface AppSettings {
  notesDir: string
}

/** 配置文件中的目录（下次重启生效） */
let persistedDir = DEFAULT_NOTES_DIR
/** 本进程实际生效目录（启动期定死） */
let effectiveDir = DEFAULT_NOTES_DIR
/** 启动时配置目录不存在、已回退默认 */
let configuredMissing = false

function loadPersisted(): string {
  let raw: string
  try {
    raw = fs.readFileSync(APP_SETTINGS_PATH, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `应用配置加载失败（已按默认数据目录兜底）：${APP_SETTINGS_PATH} —— ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return DEFAULT_NOTES_DIR
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    if (typeof parsed.notesDir === 'string' && path.isAbsolute(parsed.notesDir)) {
      return path.resolve(parsed.notesDir)
    }
    console.warn(`应用配置的 notesDir 非法（已按默认数据目录兜底）：${APP_SETTINGS_PATH}`)
    return DEFAULT_NOTES_DIR
  } catch (err) {
    console.warn(
      `应用配置不是合法 JSON（已按默认数据目录兜底）：${APP_SETTINGS_PATH} —— ${err instanceof Error ? err.message : String(err)}`,
    )
    return DEFAULT_NOTES_DIR
  }
}

// 模块级加载（tagRegistry 同款）：先于 scanner/路由的任何取用执行
persistedDir = loadPersisted()
if (persistedDir !== DEFAULT_NOTES_DIR && !fs.existsSync(persistedDir)) {
  console.warn(`配置的数据目录不存在，已回退默认目录（配置保留）：${persistedDir}`)
  configuredMissing = true
  effectiveDir = DEFAULT_NOTES_DIR
} else {
  effectiveDir = persistedDir
}

/** 本进程生效的数据目录（启动期定死；切换须持久化新目录并重启服务） */
export function getNotesDir(): string {
  return effectiveDir
}

/** 默认数据目录（仓库内 notes/） */
export function getDefaultNotesDir(): string {
  return DEFAULT_NOTES_DIR
}

/** 配置文件中的数据目录（下次重启生效） */
export function getPersistedDir(): string {
  return persistedDir
}

/** 配置目录尚未生效（等待重启；含启动时配置目录缺失回退的情形） */
export function isPendingRestart(): boolean {
  return persistedDir !== effectiveDir
}

/** 启动时配置目录不存在、已回退默认 */
export function isConfiguredMissing(): boolean {
  return configuredMissing
}

/** 当前生效目录是否为默认目录 */
export function isDefaultDir(): boolean {
  return effectiveDir === DEFAULT_NOTES_DIR
}

/**
 * 持久化数据目录：仅写配置文件，不改本进程生效目录（重启生效，D1）。
 * 路径合法性（存在性/可写性/绝对路径）由调用方校验；写失败向上抛由路由转 500。
 */
export function persistNotesDir(dir: string): void {
  const next: AppSettings = { notesDir: path.resolve(dir) }
  fs.mkdirSync(path.dirname(APP_SETTINGS_PATH), { recursive: true })
  const tmp = `${APP_SETTINGS_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, APP_SETTINGS_PATH)
  persistedDir = next.notesDir
}
