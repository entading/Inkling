import { contextBridge, ipcRenderer } from 'electron'

/**
 * Inkling 桌面态桥（E1）：经 contextBridge 暴露 window.desktop。
 * 网页形态（Edge/浏览器直开）无 preload → 特征不存在 → web 侧入口自动隐藏（lib/desktop.ts）。
 * E2 增补：appVersion / checkUpdate / openUpdateUrl（关于卡与检查更新，S4）。
 * E3 增补：getDesktopSettings / setDesktopSettings（托盘设置，Settings「桌面」卡）。
 */
contextBridge.exposeInMainWorld('desktop', {
  openExternal: (url: string, target: 'default' | 'edge' = 'default') =>
    ipcRenderer.invoke('desktop:open-external', url, target),
  appVersion: () => ipcRenderer.invoke('desktop:app-version'),
  checkUpdate: () => ipcRenderer.invoke('desktop:check-update'),
  openUpdateUrl: () => ipcRenderer.invoke('desktop:open-update-url'),
  getDesktopSettings: () => ipcRenderer.invoke('desktop:get-desktop-settings'),
  setDesktopSettings: (patch: { closeToTray: boolean }) =>
    ipcRenderer.invoke('desktop:set-desktop-settings', patch),
})
