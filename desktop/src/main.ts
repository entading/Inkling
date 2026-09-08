import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
// 命名须避开 electron 的 net（Chromium 网络栈）：同名导入经 esbuild 会静默遮蔽 node:net，
// 打包版 probePortFree 调 net.createServer 即炸（E2 打包验证实录）——勿改回 `import net`
import nodeNet from 'node:net'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { getTraySettings, loadTraySettings, saveTraySettings } from './tray-settings'

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

/**
 * 应用内更新（E4 S1）：完整 electron-updater 引擎，更新通道是构建期常量，渲染端不可传入
 * （无注入面，延续 E2 语义）。'github' = Release latest.yml 通道（仓库 entading/Inkling，
 * 公开态是通道工作的硬前置——private Release 资产有 auth 门，updater 拉不到 latest.yml）；
 * null = 休眠（不初始化 updater，IPC 返回 disabled）。dev 不初始化（electron-updater 在
 * 未打包态直接抛错；本地接线测试走 dev-app-update.yml + forceDevUpdateConfig，见 §6.2）。
 * 安全红线：autoDownload/autoInstallOnAppQuit 显式 false——下载与安装都只在用户于关于卡
 * 显式点击后发生；GitHub API 匿名限流 60 次/时/IP，保持手动检查、勿做自动轮询。
 */
const UPDATE_CHANNEL: 'github' | null = 'github'
const UPDATE_REPO = { owner: 'entading', repo: 'Inkling' }
/** 「前往发布页」次级路径：恒定 Releases 页，经 openExternalSafe 打开（URL 不经渲染端传递） */
const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
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
    const srv = nodeNet.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer()
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

/** 外链打开唯一出口：协议白名单 http/https 校验 → 系统浏览器（will-navigate / windowOpenHandler / 右键菜单三处收敛） */
function openExternalSafe(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      void shell.openExternal(parsed.href)
    }
  } catch {
    /* 非法 url 直接忽略 */
  }
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

/** 手写三段数字版本比较：candidate 是否严格新于 current（格式校验在调用方） */
function isNewerVersion(candidate: string, current: string): boolean {
  const seg = (v: string): [number, number, number] => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
  }
  const [cMaj, cMin, cPat] = seg(candidate)
  const [uMaj, uMin, uPat] = seg(current)
  if (cMaj !== uMaj) return cMaj > uMaj
  if (cMin !== uMin) return cMin > uMin
  return cPat > uPat
}

type UpdateCheckResult =
  | { status: 'up-to-date' }
  | { status: 'available'; version: string; notes?: string }
  | { status: 'disabled' }
  | { status: 'error' }

/** 更新事件（主进程 → 渲染端单通道 desktop:update-event）：关于卡状态机的唯一进度来源 */
type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; notes?: string }
  | { type: 'not-available' }
  | { type: 'downloading'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message?: string }

/** 最近一次可用发布页地址：open-update-url 无参取用，杜绝渲染端传 URL 的注入面 */
let lastUpdateUrl: string | null = null

/** updater 是否已初始化（仅打包版；dev 与 UPDATE_CHANNEL=null 时保持 false，IPC 走 disabled） */
let updaterActive = false

function sendUpdateEvent(payload: UpdateEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:update-event', payload)
  }
}

/** releaseNotes 归一化：github provider 为字符串正文，条目数组形态按 note 拼合；空则 undefined */
function notesOf(releaseNotes: unknown): string | undefined {
  if (typeof releaseNotes === 'string' && releaseNotes.trim()) return releaseNotes.trim()
  if (Array.isArray(releaseNotes)) {
    const joined = releaseNotes
      .map((it) =>
        it && typeof it === 'object' && typeof (it as { note?: unknown }).note === 'string'
          ? (it as { note: string }).note
          : '',
      )
      .filter(Boolean)
      .join('\n')
      .trim()
    return joined || undefined
  }
  return undefined
}

/**
 * E4 S1：electron-updater 接线（仅打包版，dev 不初始化）。自动下载/退出自装显式关闭
 * （负向清单红线）；updater 日志并入 logTail 环形缓冲（崩溃/就绪对话框附最近日志可诊断）。
 */
function initUpdater(): void {
  if (UPDATE_CHANNEL !== 'github' || IS_DEV) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = {
    info: (message: unknown) => noteLog(`[updater] ${String(message)}`),
    warn: (message: unknown) => noteLog(`[updater] ${String(message)}`),
    error: (message: unknown) => noteLog(`[updater] ${String(message)}`),
    debug: () => {},
  }
  autoUpdater.on('checking-for-update', () => sendUpdateEvent({ type: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    sendUpdateEvent({ type: 'available', version: info.version, notes: notesOf(info.releaseNotes) }),
  )
  autoUpdater.on('update-not-available', () => sendUpdateEvent({ type: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    sendUpdateEvent({ type: 'downloading', percent: Math.round(progress.percent * 10) / 10 }),
  )
  autoUpdater.on('update-downloaded', (info) => sendUpdateEvent({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err)
    noteLog(`[updater] error: ${message}`)
    sendUpdateEvent({ type: 'error', message: message.slice(0, 200) })
  })
  lastUpdateUrl = RELEASES_PAGE_URL
  updaterActive = true
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

  // 检查更新（E4 S1）：autoUpdater 引擎映射回 E2 同形状结果；进度/完成经事件通道推送。
  // 版本非法按无更新处理并 warn；异常（网络/限流/auth 门）一律 { status: 'error' }
  ipcMain.handle('desktop:app-version', () => ({
    version: app.getVersion(),
    updateCheckEnabled: UPDATE_CHANNEL !== null && !IS_DEV,
    updateChannel: UPDATE_CHANNEL,
  }))

  ipcMain.handle('desktop:check-update', async (): Promise<UpdateCheckResult> => {
    if (!updaterActive) return { status: 'disabled' }
    try {
      const result = await autoUpdater.checkForUpdates()
      const remote = (result?.updateInfo?.version ?? '').trim().replace(/^v/i, '')
      if (!/^\d+\.\d+\.\d+$/.test(remote)) {
        console.warn(`[update] 远端版本格式非法（${remote}），按无更新处理`)
        return { status: 'up-to-date' }
      }
      if (isNewerVersion(remote, app.getVersion())) {
        return {
          status: 'available',
          version: remote,
          notes: notesOf(result?.updateInfo?.releaseNotes),
        }
      }
      return { status: 'up-to-date' }
    } catch {
      return { status: 'error' }
    }
  })

  // 下载更新（E4 S1）：autoDownload=false，仅渲染端显式触发；进度经 download-progress 事件推送
  ipcMain.handle('desktop:update-download', async () => {
    if (!updaterActive) return { ok: false }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // 安装并重启（E4 S1）：先置位 quitting 再 quitAndInstall——其内部走 app.quit，若 close
  // 拦截（E3 closeToTray）先把窗口藏进托盘，安装器会等不到窗口销毁；置位后 close 直接放行。
  // 非静默（安装过程可见）、装后自启
  ipcMain.handle('desktop:update-install', () => {
    if (!updaterActive) return { ok: false }
    quitting = true
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  })

  // 前往发布页：不收渲染端 URL，只开最近一次可用发布页（openExternalSafe 再校验协议）；
  // updater 激活时常量预置，任何时刻可开
  ipcMain.handle('desktop:open-update-url', () => {
    if (!lastUpdateUrl) return { ok: false }
    openExternalSafe(lastUpdateUrl)
    return { ok: true }
  })

  // 桌面设置（E3）：主进程自有 tray-settings.json，不经服务端。get 只回渲染端需要的
  // 字段（trayTipShown 是主进程内部态）；set 强校验 { closeToTray: boolean }，
  // 落盘即生效（close handler 每次读内存态，无需重启）
  ipcMain.handle('desktop:get-desktop-settings', () => ({ closeToTray: getTraySettings().closeToTray }))

  ipcMain.handle('desktop:set-desktop-settings', (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) return { ok: false }
    const { closeToTray } = patch as { closeToTray?: unknown }
    if (typeof closeToTray !== 'boolean') return { ok: false }
    try {
      saveTraySettings(app.getPath('userData'), { closeToTray })
    } catch (err) {
      console.warn(`[tray-settings] 写盘失败：${err instanceof Error ? err.message : String(err)}`)
      return { ok: false }
    }
    return { ok: true, closeToTray: getTraySettings().closeToTray }
  })
}

// ---------- 托盘（E3）：app ready 后即创建，独立于窗口存在；dev 同样创建（主路径 dev 可验） ----------

/** 窗口从隐藏/最小化恢复并置前（托盘单击/菜单与 second-instance 共用；steal 防 Windows 前台锁拦截） */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  app.focus({ steal: true })
  mainWindow.focus()
}

function trayIconPath(): string {
  // dev：main.cjs 在 desktop/dist/，图标源在 desktop/build/；prod：与 main.cjs 同目录（装配项）
  return path.join(__dirname, IS_DEV ? '../build/tray-icon.png' : 'tray-icon.png')
}

function createTray(): void {
  try {
    tray = new Tray(trayIconPath())
  } catch (err) {
    // 图标缺失/损坏只降级托盘入口，不阻塞应用（关窗退回 E1 语义）
    console.warn(`[tray] 托盘图标加载失败，托盘不可用：${err instanceof Error ? err.message : String(err)}`)
    tray = null
    return
  }
  tray.setToolTip(`Inkling v${app.getVersion()}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 Inkling', click: () => showMainWindow() },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  // Windows 左键单击：窗口隐藏时恢复置前，已可见时前置聚焦（右键走 context menu）
  tray.on('click', () => showMainWindow())
}

/** 首次最小化到托盘的系统通知（Windows toast）：尽力而为，失败静默，不阻塞 hide */
function notifyTrayOnce(): void {
  if (!getTraySettings().trayTipShown) {
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Inkling 已最小化到托盘',
          body: '从托盘图标可随时打开或退出',
        }).show()
      }
    } catch {
      /* 系统不支持/权限缺失：静默忽略 */
    }
    // 无论通知是否实际弹出都置位持久化——避免每次关窗都尝试弹失败的通知
    try {
      saveTraySettings(app.getPath('userData'), { trayTipShown: true })
    } catch (err) {
      console.warn(`[tray-settings] trayTipShown 持久化失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
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

  // 关窗拦截（E3 生命周期 A 语义）：三条关闭路径（X/Alt+F4/任务栏关闭）统一走 close 事件。
  // quitting 守卫勿删——托盘「退出」→ app.quit() → before-quit 置位 → close 放行销毁；
  // 没有它 close 拦截与 quit 互相死锁。closeToTray=false 时直接放行（E1 原语义不劣化）；
  // tray 在位守卫：托盘创建失败（图标缺失降级）时 hide 会令窗口无处可恢复，同样放行退回 E1
  mainWindow.on('close', (event) => {
    if (!quitting && tray && getTraySettings().closeToTray) {
      event.preventDefault()
      mainWindow?.hide()
      notifyTrayOnce()
    }
  })

  // deny 一切壳内新窗：target=_blank 一律不开新 Electron 窗，白名单 origin 交默认浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (allowedOrigins().has(new URL(url).origin)) openExternalSafe(url)
    } catch {
      /* 非法 url 直接忽略 */
    }
    return { action: 'deny' }
  })

  // 同窗整页导航防护（设计 §5.1-5 未覆盖的路径）：markdown-it 默认外链不带 target=_blank，
  // 点击会把窗口导航到外部网站且壳内无导航 UI 可返回。白名单 origin 放行（站内整页跳转），
  // 外部 http(s) preventDefault 后交系统浏览器——收紧壳而非放宽 windowOpenHandler 白名单
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      event.preventDefault()
      return
    }
    if (allowedOrigins().has(parsed.origin)) return
    event.preventDefault()
    openExternalSafe(url)
  })

  // 壳内右键菜单（E2 S3）：可编辑元素（剪切/复制/粘贴/全选）、有选区（复制）、
  // http(s) 链接（在浏览器打开链接）；无可操作项不弹（避免空菜单闪烁）。网页版零影响。
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      items.push(
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      )
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: '复制' })
    }
    if (params.linkURL) {
      let isHttpLink = false
      try {
        const protocol = new URL(params.linkURL).protocol
        isHttpLink = protocol === 'http:' || protocol === 'https:'
      } catch {
        /* 非 url 不给菜单项 */
      }
      if (isHttpLink) {
        if (items.length > 0) items.push({ type: 'separator' })
        items.push({ label: '在浏览器打开链接', click: () => openExternalSafe(params.linkURL) })
      }
    }
    if (items.length === 0) return
    Menu.buildFromTemplate(items).popup({ window: mainWindow ?? undefined })
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
    // 对隐藏（托盘驻留）态天然兼容：show 即恢复；逻辑与托盘打开共用 showMainWindow
    showMainWindow()
  })

  void app
    .whenReady()
    .then(() => {
      loadTraySettings(app.getPath('userData'))
      registerIpc()
      initUpdater()
      createTray()
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
