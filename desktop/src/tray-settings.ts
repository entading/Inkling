import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 托盘设置持久化（E3）：主进程自有 userData/tray-settings.json——勿蹭服务端
 * /api/settings（强校验只收 { lanEnabled }），localStorage 主进程又读不到。
 *
 * 持久化纪律（与服务端 data/ 下 json 同语义，AGENTS 约束 8）：同目录 tmp + renameSync
 * 原子写、先写盘后改内存（写失败抛给调用方，内存保持与磁盘一致）；损坏/缺失兜底
 * 默认值不拒启。
 */

export interface TraySettings {
  /** 关窗（X/Alt+F4/任务栏关闭）是否隐藏到托盘；false = E1 原语义关窗全链路退出 */
  closeToTray: boolean
  /** 首次最小化到托盘的系统通知是否已弹过（每台机器只扰民一次，主进程内部态不暴露给渲染端） */
  trayTipShown: boolean
}

const DEFAULTS: TraySettings = { closeToTray: true, trayTipShown: false }

let state: TraySettings = { ...DEFAULTS }

function settingsFile(userDataDir: string): string {
  return path.join(userDataDir, 'tray-settings.json')
}

/** 启动时一次性加载（app ready 前后均可，getPath('userData') 不依赖 ready） */
export function loadTraySettings(userDataDir: string): void {
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(userDataDir), 'utf8')) as {
      closeToTray?: unknown
      trayTipShown?: unknown
    }
    state = {
      closeToTray: typeof parsed.closeToTray === 'boolean' ? parsed.closeToTray : DEFAULTS.closeToTray,
      trayTipShown: typeof parsed.trayTipShown === 'boolean' ? parsed.trayTipShown : DEFAULTS.trayTipShown,
    }
  } catch (err) {
    // ENOENT 是正常首启；其余（损坏 JSON/无读权限）warn 后兜底默认值，不拒启
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[tray-settings] 读取失败，已回退默认值：${err instanceof Error ? err.message : String(err)}`)
    }
    state = { ...DEFAULTS }
  }
}

export function getTraySettings(): TraySettings {
  return state
}

/** 部分更新并落盘；写盘失败向上抛（调用方决定如何呈现），内存不动 */
export function saveTraySettings(userDataDir: string, patch: Partial<TraySettings>): TraySettings {
  const merged: TraySettings = { ...state, ...patch }
  const file = settingsFile(userDataDir)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  state = merged
  return state
}
