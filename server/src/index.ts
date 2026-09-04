import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

import { registerRoutes } from './routes.js'
import { scanAll, watch } from './scanner.js'
import { getNotesDir } from './appConfig.js'
import { BOARD_LABELS } from './types.js'
import {
  LAN_HOST,
  LAN_STATE,
  LOCAL_HOST,
  PORT,
  getLanIps,
  printLanAccess,
} from './settings.js'

const DIST_DIR = path.resolve(import.meta.dirname, '../../web/dist')

function buildApp(): FastifyInstance {
  // forceCloseConnections:'idle'：close 时仅断开空闲连接，等待在途请求完成后再关闭
  const app = Fastify({ logger: true, forceCloseConnections: 'idle' })
  registerRoutes(app, { toggleLan })

  if (fs.existsSync(DIST_DIR)) {
    app.register(fastifyStatic, { root: DIST_DIR, prefix: '/' })
    // SPA history 路由：非 /api 的未知 GET 一律回退 index.html（手机直连 :3000 时 /vocab 等路径可直接打开）
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: '页面不存在' })
    })
  }
  return app
}

let app: FastifyInstance | null = null
let watcher: ReturnType<typeof watch> | null = null

/** 待执行的最新的目标状态；切换式循环逐个消化，最后一个请求胜出 */
let queuedTarget: boolean | null = null
let switchingNow = false

function toggleLan(enabled: boolean): void {
  queuedTarget = enabled
  if (!switchingNow) void runSwitches()
}

async function runSwitches(): Promise<void> {
  switchingNow = true
  try {
    while (queuedTarget !== null && queuedTarget !== LAN_STATE.enabled) {
      const enabled = queuedTarget
      queuedTarget = null
      await switchHost(enabled)
    }
  } finally {
    switchingNow = false
    queuedTarget = null
  }
}

/**
 * 切换监听地址（127.0.0.1 ↔ 0.0.0.0）：close 旧实例 → 新实例 listen（Fastify 实例关闭后不可复用）。
 * 注意：必须在路由「先应答再调用」，close 会等待当前请求结束，路由内直接 await 会死锁。
 * EADDRINUSE 等失败时回滚到原地址。
 */
async function switchHost(enabled: boolean): Promise<void> {
  const from = LAN_STATE.enabled ? LAN_HOST : LOCAL_HOST
  const to = enabled ? LAN_HOST : LOCAL_HOST
  const old = app
  const next = buildApp()
  try {
    await old?.close()
    await next.listen({ host: to, port: PORT })
    app = next
    LAN_STATE.enabled = enabled
    console.log(`监听地址已切换：${to}:${PORT}`)
    if (enabled) {
      await printLanAccess(getLanIps())
    }
  } catch (err) {
    console.error(`切换到 ${to}:${PORT} 失败，回滚为 ${from}:${PORT}：`, err)
    const rollback = buildApp()
    try {
      await rollback.listen({ host: from, port: PORT })
      app = rollback
      console.log(`已回滚：${from}:${PORT}`)
    } catch (rollbackErr) {
      console.error('回滚监听失败，服务端当前不可用：', rollbackErr)
    }
  }
}

async function start(): Promise<void> {
  app = buildApp()
  scanAll()
  watcher = watch()
  console.log(`已扫描数据目录：${getNotesDir()}`)
  await app.listen({ host: LOCAL_HOST, port: PORT })
  console.log(`Inkling 服务端已启动：http://localhost:${PORT}`)
  console.log(`板块：${Object.values(BOARD_LABELS).join('、')}`)
}

async function shutdown(signal: string): Promise<void> {
  console.log(`收到 ${signal}，正在退出…`)
  await watcher?.close()
  try {
    await app?.close()
  } catch {
    /* 忽略关闭异常，直接退出 */
  }
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

start().catch((err) => {
  console.error('服务端启动失败：', err)
  process.exit(1)
})
