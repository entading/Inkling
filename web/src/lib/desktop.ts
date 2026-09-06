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

interface DesktopBridge {
  openExternal: (url: string, target?: 'default' | 'edge') => Promise<DesktopOpenResult>
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}

/** preload 先于页面脚本注入，模块加载期判定安全 */
export const isDesktop = typeof window !== 'undefined' && !!window.desktop?.openExternal

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
