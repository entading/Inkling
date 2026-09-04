import os from 'node:os'
import * as QRCode from 'qrcode'

import { getNotesDir } from './appConfig.js'

export const LOCAL_HOST = '127.0.0.1'
export const LAN_HOST = '0.0.0.0'
export const PORT = 3000

/** 局域网开关不持久化：服务重启后默认关闭（设计 5.8「默认不开启」） */
export const LAN_STATE = { enabled: false }

export interface ServerInfo {
  lanEnabled: boolean
  /** 当前监听地址（LAN 开启时为 0.0.0.0） */
  host: string
  port: number
  /** 开启时的局域网 IP 列表 */
  lanIps: string[]
  /** 可访问地址：本机 localhost + 各局域网 IP */
  urls: string[]
  /** 访问二维码 dataURL（开启时指向第一个局域网地址） */
  qrDataUrl: string
  /** 数据目录绝对路径 */
  notesDir: string
}

/** 常见虚拟网卡（VMware/Hyper-V/WSL/Docker 等）不应成为手机访问入口 */
const VIRTUAL_NIC_RE = /vmnet|virtual|veth|vethernet|wsl|docker|hyper|loopback|tap|tun/i

function isIpv4(family: string): boolean {
  return family === 'IPv4' || family === '4'
}

/** 局域网 IP 列表：非内部、IPv4、排除 127.* 与 169.254.*（链路本地） */
export function getLanIps(): string[] {
  const ips: string[] = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_NIC_RE.test(name)) continue
    for (const addr of addrs ?? []) {
      if (!addr.internal && isIpv4(String(addr.family))) {
        const ip = addr.address
        if (!ip.startsWith('127.') && !ip.startsWith('169.254.')) ips.push(ip)
      }
    }
  }
  return ips
}

function localUrl(): string {
  return `http://localhost:${PORT}`
}

function lanUrl(ip: string): string {
  return `http://${ip}:${PORT}`
}

/** 按目标监听状态构建 server-info；切换在应答后后台执行，故先按目标状态生成 */
export async function buildServerInfo(lanEnabled: boolean): Promise<ServerInfo> {
  const lanIps = lanEnabled ? getLanIps() : []
  const urls = [localUrl(), ...lanIps.map(lanUrl)]
  const qrTarget = lanIps.length > 0 ? lanUrl(lanIps[0]) : localUrl()
  const qrDataUrl = await QRCode.toDataURL(qrTarget, { width: 240, margin: 1 })
  return {
    lanEnabled,
    host: lanEnabled ? LAN_HOST : LOCAL_HOST,
    port: PORT,
    lanIps,
    urls,
    qrDataUrl,
    notesDir: getNotesDir(),
  }
}

/** 终端打印局域网访问地址与二维码；同时打印明文 URL，防 Windows 控制台二维码渲染不佳 */
export async function printLanAccess(ips: string[]): Promise<void> {
  const urls = ips.map(lanUrl)
  console.log('')
  console.log('局域网访问已开启，手机请使用以下地址（或扫码）：')
  for (const u of urls) console.log(`  ${u}`)
  if (urls.length > 0) {
    console.log('')
    console.log(await QRCode.toString(urls[0], { type: 'terminal', small: true, margin: 1 }))
    console.log('')
    console.log(`二维码内容：${urls[0]}`)
  } else {
    console.log('⚠ 未找到局域网 IPv4 地址，手机当前无法访问。')
  }
}
