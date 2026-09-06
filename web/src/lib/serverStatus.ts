/**
 * 服务连通性全局信号（E2）：api.ts 的 fetchJson 挂钩——网络层失败（fetch reject，
 * 非 ApiError）置 false，收到任何响应置 true。无轮询；横幅出现期间由「重试」按钮
 * 主动探测。各视图既有 loading/error 态保留，本信号是叠加的全局层。
 */
import { ref } from 'vue'

export const serverOnline = ref(true)

export function setServerOnline(online: boolean): void {
  serverOnline.value = online
}

/**
 * 主动探测服务是否恢复：收到服务端的任何响应（含 4xx/5xx JSON）即算在线；
 * 网络层失败或非 JSON 错误响应（dev 代理 502 代答 = 服务不可达）算离线。
 */
export async function pingServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/boards')
    if (res.ok) {
      setServerOnline(true)
      return true
    }
    let hasJson = false
    try {
      await res.json()
      hasJson = true
    } catch {
      /* 空响应体 */
    }
    setServerOnline(hasJson)
    return hasJson
  } catch {
    setServerOnline(false)
    return false
  }
}
