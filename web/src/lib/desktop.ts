/**
 * 桌面态检测（E1）：Electron 壳经 preload contextBridge 注入 window.desktop；
 * Edge/浏览器打开的网页形态无 preload → 特征不存在 → 桌面入口自动隐藏。
 * 一套 web/dist 两种形态，无构建期开关。
 */

export interface DesktopOpenResult {
  ok: boolean
  /** via=edge：定向 Edge 打开；via=default：默认浏览器（含 Edge 失败回落） */
  via?: 'default' | 'edge'
}

/** 关于卡（E2 S4）：版本 + 更新源是否已配置（manifest 为构建期常量，渲染端不可传入） */
export interface DesktopAppInfo {
  version: string
  updateCheckEnabled: boolean
}

/** 检查更新结果（E2 S4）：disabled = 主进程未配置更新源（休眠形态） */
export type DesktopUpdateResult =
  | { status: 'up-to-date' }
  | { status: 'available'; version: string; url: string; notes?: string }
  | { status: 'disabled' }
  | { status: 'error' }

/** 桌面设置（E3）：主进程自有 tray-settings.json，trayTipShown 是主进程内部态不在此暴露 */
export interface DesktopSettings {
  closeToTray: boolean
}

export interface DesktopSetSettingsResult {
  ok: boolean
  closeToTray?: boolean
}

interface DesktopBridge {
  openExternal: (url: string, target?: 'default' | 'edge') => Promise<DesktopOpenResult>
  appVersion?: () => Promise<DesktopAppInfo>
  checkUpdate?: () => Promise<DesktopUpdateResult>
  openUpdateUrl?: () => Promise<{ ok: boolean }>
  getDesktopSettings?: () => Promise<DesktopSettings>
  setDesktopSettings?: (patch: { closeToTray: boolean }) => Promise<DesktopSetSettingsResult>
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

/** preload 先于页面脚本注入，模块加载期判定安全 */
export const isDesktop = typeof window !== 'undefined' && !!window.desktop?.openExternal

/** 桌面态版本信息（E2 S4）：无桥或旧壳缺方法时返回 null，关于卡不渲染 */
export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  if (!window.desktop?.appVersion) return null
  try {
    return await window.desktop.appVersion()
  } catch {
    return null
  }
}

/** 检查更新（E2 S4）：无桥时返回 null（网页态不出现该操作） */
export async function checkDesktopUpdate(): Promise<DesktopUpdateResult | null> {
  if (!window.desktop?.checkUpdate) return null
  try {
    return await window.desktop.checkUpdate()
  } catch {
    return { status: 'error' }
  }
}

/** 前往下载（E2 S4）：主进程打开最近一次检查通过的下载页（URL 不经渲染端传递） */
export async function openUpdateDownload(): Promise<boolean> {
  if (!window.desktop?.openUpdateUrl) return false
  try {
    const res = await window.desktop.openUpdateUrl()
    return !!res?.ok
  } catch {
    return false
  }
}

/** 桌面设置（E3）：无桥（网页态）或旧壳缺方法时返回 null，「桌面」卡不渲染 */
export async function getDesktopSettings(): Promise<DesktopSettings | null> {
  if (!window.desktop?.getDesktopSettings) return null
  try {
    return await window.desktop.getDesktopSettings()
  } catch {
    return null
  }
}

/** 保存桌面设置：主进程强校验 { closeToTray: boolean }，落盘即生效 */
export async function setDesktopSettings(closeToTray: boolean): Promise<boolean> {
  if (!window.desktop?.setDesktopSettings) return false
  try {
    const res = await window.desktop.setDesktopSettings({ closeToTray })
    return !!res?.ok
  } catch {
    return false
  }
}

/**
 * 用默认浏览器打开。网页形态回落 window.open（桌面入口只会隐藏，此分支仅防御性兜底）。
 * 返回是否成功发起打开。
 */
export async function openInBrowser(url: string): Promise<boolean> {
  if (!window.desktop?.openExternal) {
    window.open(url, '_blank', 'noopener')
    return true
  }
  const res = await window.desktop.openExternal(url, 'default')
  return !!res?.ok
}

/** 用 Edge 定向打开（桌面态专用；Edge 缺失时主进程回落默认浏览器，via=default） */
export async function openInEdge(url: string): Promise<DesktopOpenResult | null> {
  if (!window.desktop?.openExternal) return null
  return window.desktop.openExternal(url, 'edge')
}
