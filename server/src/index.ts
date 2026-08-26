import Fastify from 'fastify'
import { registerRoutes } from './routes.js'
import { scanAll, watch, NOTES_DIR } from './scanner.js'
import { BOARD_LABELS } from './types.js'

const HOST = '127.0.0.1'
const PORT = 3000

const app = Fastify({ logger: true })

scanAll()
registerRoutes(app)

const watcher = watch()
console.log(`已扫描 notes/ 目录：${NOTES_DIR}`)

app.listen({ host: HOST, port: PORT }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`EN_tool 服务端已启动：${address}`)
  console.log(`板块：${Object.values(BOARD_LABELS).join('、')}`)
})

// 保持进程存活直到退出
process.on('SIGINT', () => {
  void watcher.close()
  process.exit(0)
})
