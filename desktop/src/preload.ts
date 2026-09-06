import { contextBridge, ipcRenderer } from 'electron'

/**
 * Inkling 桌面态桥（E1）：经 contextBridge 暴露 window.desktop。
 * 网页形态（Edge/浏览器直开）无 preload → 特征不存在 → web 侧入口自动隐藏（lib/desktop.ts）。
 */
contextBridge.exposeInMainWorld('desktop', {
  openExternal: (url: string, target: 'default' | 'edge' = 'default') =>
    ipcRenderer.invoke('desktop:open-external', url, target),
})
