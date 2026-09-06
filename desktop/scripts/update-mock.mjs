// E2 S5b2 更新三态验证用本地静态服务（非产品代码）：8787 端口
//   GET /latest.json → latest 清单（version 可经命令行参数切换）
//   GET /download-page → 模拟下载页（验证「前往下载」打开了正确 URL）
import { createServer } from 'node:http'

const version = process.argv[2] ?? '1.4.0'
const failMode = process.argv[2] === 'fail'

const server = createServer((req, res) => {
  console.log(`${req.method} ${req.url}`)
  if (req.url === '/latest.json') {
    if (failMode) {
      res.writeHead(503).end('server error')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        version,
        url: 'http://127.0.0.1:8787/download-page',
        notes: 'E2 验证用假版本',
      }),
    )
    return
  }
  if (req.url === '/download-page') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Inkling 下载页验证 OK（右键菜单/前往下载 打开的正确 URL）')
    return
  }
  res.writeHead(404).end('not found')
})
server.listen(8787, '127.0.0.1', () => console.log(`update mock on :8787 (version=${version}${failMode ? ' FAILMODE' : ''})`))
