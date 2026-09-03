/**
 * 运行时字体分片子进程（F1）—— 由 server/src/fontLibrary.ts spawn 调用，勿手工常规运行。
 *
 * 用法：
 *   node split-font.mjs --in <源字体文件> --out <产物目录> --family <font-family 名> --base-url <css url 前缀>
 *
 * 与 web/scripts/build-fonts.mjs（M2' 思源宋体一次性管线）同源：cn-font-split 把单个
 * ttf/otf/woff2 切成 unicode-range woff2 分片；差异是本脚本面向任意导入字体——
 * 产物目录只留 woff2 + 重写后的 fonts.css（url 指向 GET <base-url>/<分片名>）。
 *
 * 尾部 process.exit(0) 必须保留：Rust FFI 在 Node 退出清理阶段段错误（0xC0000005，
 * Windows 实测，M2' 沉淀）；子进程形态下 exit(0) 同时天然不污染常驻服务主进程。
 */
import { fontSplit } from 'cn-font-split'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const srcFile = arg('in')
const outDir = arg('out')
const family = arg('family')
const baseUrl = arg('base-url') ?? ''
const weight = arg('weight') ?? '400'
if (!srcFile || !outDir || !family) {
  console.error('缺少 --in / --out / --family 参数')
  process.exit(1)
}

try {
  const input = new Uint8Array(readFileSync(srcFile).buffer)
  await fontSplit({
    input,
    outDir,
    css: { fontFamily: family, fontWeight: weight, fontDisplay: 'swap' },
    renameOutputFont: '[hash:6].[ext]',
    testHtml: false,
    reporter: false,
    silent: true,
  })

  // 工具产出的 css（文件名由工具决定）读出：剥时间戳注释、相对 url 改写为 API 绝对路径；
  // 清理全部非 woff2 中间产物（含已读入内存的工具 css），fonts.css 随后另行写入
  const cssName = readdirSync(outDir).find((f) => f.endsWith('.css'))
  if (!cssName) throw new Error(`fontSplit 未产出 css: ${outDir}`)
  const raw = readFileSync(resolve(outDir, cssName), 'utf8')
  const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  const rewritten = noComments.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, p) => {
    if (/^(https?:|data:|\/)/.test(p)) return m
    return `url(${q}${baseUrl}/${p.replace(/^\.\//, '')}${q})`
  })
  for (const extra of readdirSync(outDir).filter((f) => !f.endsWith('.woff2'))) {
    rmSync(resolve(outDir, extra))
  }
  writeFileSync(resolve(outDir, 'fonts.css'), `${rewritten.trim()}\n`)

  const chunks = readdirSync(outDir).filter((f) => f.endsWith('.woff2')).length
  console.log(`split ok: ${chunks} woff2 片 + fonts.css → ${outDir}`)
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
}

process.exit(0)
