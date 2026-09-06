import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'

/**
 * Inkling Electron 主进程（E1 桌面化）。
 *
 * 进程模型（设计方案 §2.1）：主进程 spawn process.execPath + ELECTRON_RUN_AS_NODE=1
 * 运行 server/dist/index.js（Electron 二进制充当 Node 运行时），服务端 tsc 产物原样落盘
 * 原样运行——import.meta 路径锚点与 LAN 切换状态机均不受打包影响；窗口加载实际 origin。
 * 勿改为主进程 import 服务端（CJS 化后 import.meta 锚点全灭 + LAN 状态机被迫重写）。
 *
 * dev/prod 双形态（§2.3）：dev = `electron .` 直跑（app.isPackaged === false），不 spawn
 * 子进程、不接管端口，窗口加载 vite dev server；prod = spawn 子进程，3000 被占（如 dev
 * server 在跑）时随机回落空闲端口，经 INKLING_PORT 注入，server-info/二维码自动跟随。
 *
 * 安全基线（§5.1，勿放宽）：contextIsolation、nodeIntegration:false、sandbox；
 * setWindowOpenHandler 一律 deny + origin 白名单才交默认浏览器；IPC 在白名单之上
 * 额外要求 URL 与 origin 根精确相等（openWithEdge 经 cmd start 传递，杜绝任意串注入）。
 */

const IS_DEV = !app.isPackaged
const DEV_WEB_ORIGIN = 'http://localhost:5173'
/** dev 下服务端固定 3000（tsx watch 未设 INKLING_PORT）；壳内 server-info 派生的 localUrl 指向它 */
const DEV_SERVER_ORIGIN = 'http://localhost:3000'
const READY_TIMEOUT_MS = 15_000

let mainWindow: BrowserWindow | null = null
let serverChild: ChildProcess | null = null
let serverPort = 0
let readyFulfilled = false
let quitting = false

/** 子进程 stdout/stderr 尾部环形缓冲：就绪超时/崩溃对话框附最近日志辅助定位 */
const logTail: string[] = []

function noteLog(line: string): void {
  logTail.push(line)
  if (logTail.length > 40) logTail.shift()
}

// ---------- 端口选择（§5.1-2）：3000 可监听则用之，否则取随机空闲端口 ----------

function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('无法获取空闲端口'))))
    })
  })
}

async function pickPort(): Promise<number> {
  if (await probePortFree(3000)) return 3000
  return pickFreePort()
}

// ---------- 子进程（§2.1 / §5.1-3、7） ----------

function spawnServer(port: number): void {
  const serverEntry = path.join(__dirname, 'server', 'dist', 'index.js')
  // 首启自举：默认数据目录（userData/notes）不存在时 chokidar.watch 的 ENOENT error
  // 事件无监听会直接抛出（scanner.watch 未挂 error），预建目录保证四板块空态正常呈现
  mkdirSync(path.join(app.getPath('userData'), 'notes'), { recursive: true })

  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      INKLING_PORT: String(port),
      INKLING_GLOBAL_DATA_DIR: app.getPath('userData'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  serverChild = child

  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) noteLog(line)
      }
    })
  }

  child.on('error', (err) => {
    if (!quitting) {
      dialog.showErrorBox('Inkling 启动失败', `后端服务进程无法启动：${err.message}`)
      app.quit()
    }
  })

  child.on('exit', (code, signal) => {
    if (serverChild === child) serverChild = null
    // 就绪前退出由 waitForReady 超时路径统一报错；运行中意外退出才单独提示
    if (!quitting && readyFulfilled) {
      dialog.showErrorBox(
        'Inkling 服务已退出',
        `后端服务意外退出（code=${code ?? '-'} ${signal ?? ''}），请重新启动应用。\n\n最近日志：\n${logTail.join('\n')}`,
      )
      app.quit()
    }
  })
}

async function waitForReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/boards`)
      if (res.ok) return
      lastErr = `HTTP ${res.status}`
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(lastErr || '就绪探测超时')
}

function killChildTree(): void {
  const child = serverChild
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // 树杀子进程链：防字体分片孙进程残留占用数据目录
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      /* 尽力而为：进程随应用退出由系统回收 */
    }
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      /* 已退出 */
    }
  }
}

// ---------- 浏览器外开（§2.2 / §5.1-6） ----------

function allowedOrigins(): Set<string> {
  const set = new Set<string>()
  for (const host of ['localhost', '127.0.0.1']) {
    if (serverPort > 0) set.add(`http://${host}:${serverPort}`)
    if (IS_DEV) {
      set.add(`http://${host}:5173`)
      set.add(`http://${host}:3000`)
    }
  }
  return set
}

async function openWithDefault(url: string): Promise<{ ok: boolean; via: 'default' }> {
  await shell.openExternal(url)
  return { ok: true, via: 'default' }
}

function openWithEdge(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    if (process.platform === 'win32') {
      // start 无预检测：msedge 未注册 App Paths 时非零退出 → 调用方回落默认浏览器
      child = spawn('cmd', ['/c', 'start', 'msedge', url], { stdio: 'ignore', windowsHide: true })
    } else if (process.platform === 'darwin') {
      child = spawn('open', ['-a', 'Microsoft Edge', url], { stdio: 'ignore' })
    } else {
      reject(new Error('unsupported platform'))
      return
    }
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`msedge exit ${code}`))))
  })
}

function registerIpc(): void {
  ipcMain.handle('desktop:open-external', (_event, url: unknown, target: unknown) => {
    let parsed: URL
    try {
      if (typeof url !== 'string') return { ok: false }
      parsed = new URL(url)
    } catch {
      return { ok: false }
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !allowedOrigins().has(parsed.origin)) {
      return { ok: false }
    }
    // 仅放行 origin 根：保证传给 cmd start 的串不含路径/查询等任何可注入字符
    if (parsed.href !== `${parsed.origin}/`) return { ok: false }

    if (target === 'edge') {
      return openWithEdge(parsed.href)
        .then(() => ({ ok: true, via: 'edge' as const }))
        .catch(() => openWithDefault(parsed.href))
    }
    return openWithDefault(parsed.href)
  })
}

// ---------- 窗口（§5.1-4、5） ----------

function createWindow(origin: string): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#fafafa',
    title: 'Inkling',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // deny 一切壳内新窗：target=_blank 一律不开新 Electron 窗，白名单 origin 交默认浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (allowedOrigins().has(new URL(url).origin)) void shell.openExternal(url)
    } catch {
      /* 非法 url 直接忽略 */
    }
    return { action: 'deny' }
  })

  void mainWindow.loadURL(origin)
}

// ---------- 生命周期（§5.1-1、3） ----------

async function startup(): Promise<void> {
  if (IS_DEV) {
    createWindow(DEV_WEB_ORIGIN)
    return
  }
  const port = await pickPort()
  serverPort = port
  spawnServer(port)
  try {
    await waitForReady(port)
  } catch (err) {
    dialog.showErrorBox(
      'Inkling 启动失败',
      `后端服务未能在预期时间内就绪：${err instanceof Error ? err.message : String(err)}\n\n最近日志：\n${logTail.join('\n')}`,
    )
    app.quit()
    return
  }
  readyFulfilled = true
  createWindow(`http://localhost:${port}`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 二次启动：单实例锁未获取，直接退出（首实例收到 second-instance 聚焦窗口）
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      // Windows 前台锁会拦截后台进程的 show/focus（二次启动实测窗口不置前），steal 置前
      app.focus({ steal: true })
      mainWindow.focus()
    }
  })

  void app
    .whenReady()
    .then(() => {
      registerIpc()
      return startup()
    })
    .catch((err: unknown) => {
      dialog.showErrorBox('Inkling 启动失败', err instanceof Error ? (err.stack ?? err.message) : String(err))
      app.quit()
    })

  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', () => {
    quitting = true
    killChildTree()
  })
}
