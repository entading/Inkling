// E4 §6.2 dev 更新接线测试用本地静态服务（非产品代码）：8787 端口。
// 配合 dev-app-update.yml（provider: generic → http://127.0.0.1:8787/updater/）使用：
//   GET /updater/latest.yml             → electron-updater 版本索引（version 经命令行参数切换）
//   GET /updater/Inkling Setup <v>.exe  → 假安装包（随机字节，sha512 与 latest.yml 一致）
// 用法：node scripts/update-mock.mjs [版本号|fail]
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const failMode = process.argv[2] === 'fail'
const version = failMode ? '1.0.0' : (process.argv[2] ?? '9.9.9')
const fileName = `Inkling Setup ${version}.exe`
const payload = randomBytes(4096)
const sha512 = createHash('sha512').update(payload).digest('base64')
const releaseDate = new Date().toISOString()

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '').split('?')[0])
  console.log(`${req.method} ${url}`)
  if (url === '/updater/latest.yml') {
    if (failMode) {
      res.writeHead(503).end('server error')
      return
    }
    const body = [
      `version: ${version}`,
      `path: ${fileName}`,
      `sha512: ${sha512}`,
      `releaseDate: '${releaseDate}'`,
      'releaseName: Inkling dev wiring test',
    ].join('\n')
    res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8' }).end(`${body}\n`)
    return
  }
  if (url === `/updater/${fileName}`) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(payload)
    return
  }
  res.writeHead(404).end('not found')
})
server.listen(8787, '127.0.0.1', () =>
  console.log(`update mock on :8787 (version=${version}${failMode ? ' FAILMODE' : ''})`),
)
