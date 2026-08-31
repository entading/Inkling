/**
 * 思源宋体（Noto Serif SC）woff2 分片管线 —— M2' 一次性执行，常规构建不重跑。
 *
 * 产物 self-host 到 web/public/fonts/serif/{400,700}/（分片 woff2 + unicode-range CSS），
 * 并合并生成 web/src/styles/fonts.css（family 精确为 'Noto Serif SC Web'，font-display: swap）。
 * OFL 许可证随产物拷入 public/fonts/serif/OFL-NotoSerifSC.txt。
 *
 * 源字体不入库：从 notofonts/noto-cjk GitHub release Serif2.003 的 14_NotoSerifSC.zip
 * 取 SubsetOTF/SC/NotoSerifSC-{Regular,Bold}.otf，放到本目录 font-src/（已 gitignore）
 * 或用环境变量 FONT_SRC_DIR 指向其所在目录：
 *   curl -L -o NotoSerifSC.zip https://github.com/notofonts/noto-cjk/releases/download/Serif2.003/14_NotoSerifSC.zip
 */
import { fontSplit } from 'cn-font-split'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '..')
const srcDir = process.env.FONT_SRC_DIR ?? resolve(here, 'font-src')
const outRoot = resolve(webRoot, 'public', 'fonts', 'serif')
const fontsCssPath = resolve(webRoot, 'src', 'styles', 'fonts.css')

const FAMILY = 'Noto Serif SC Web'
const weights = [
  { weight: 400, file: 'NotoSerifSC-Regular.otf' },
  { weight: 700, file: 'NotoSerifSC-Bold.otf' },
]

rmSync(outRoot, { recursive: true, force: true })
mkdirSync(outRoot, { recursive: true })

const blocks = []
for (const w of weights) {
  const input = new Uint8Array(readFileSync(resolve(srcDir, w.file)).buffer)
  const outDir = resolve(outRoot, String(w.weight))
  await fontSplit({
    input,
    outDir,
    css: {
      fontFamily: FAMILY,
      fontWeight: String(w.weight),
      fontDisplay: 'swap',
    },
    renameOutputFont: '[hash:6].[ext]',
    testHtml: false,
    reporter: false,
    silent: true,
  })

  // 产物目录内的 css（文件名由工具决定）读出，把相对路径改写为站点绝对路径后并入 fonts.css
  const cssName = readdirSync(outDir).find((f) => f.endsWith('.css'))
  if (!cssName) throw new Error(`fontSplit 未产出 css（weight ${w.weight}）: ${outDir}`)
  const raw = readFileSync(resolve(outDir, cssName), 'utf8')
  // 工具注释含 CreateTime 时间戳等元数据，会导致重跑产物不一致：全部剥除（本脚本的节头在此之后另行写入）
  const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  const rewritten = noComments.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, p) => {
    if (/^(https?:|data:|\/)/.test(p)) return m
    return `url(${q}/fonts/serif/${w.weight}/${p.replace(/^\.\//, '')}${q})`
  })
  blocks.push(`/* weight ${w.weight} —— ${w.file}（cn-font-split 分片，unicode-range 按需加载） */\n${rewritten.trim()}\n`)
  // 清理工具中间产物：result.css（已并入 fonts.css）与 index.proto（内部分片元数据），产物目录只留 woff2
  for (const extra of readdirSync(outDir).filter((f) => !f.endsWith('.woff2'))) {
    rmSync(resolve(outDir, extra))
  }
  const woff2 = readdirSync(outDir).filter((f) => f.endsWith('.woff2'))
  console.log(`weight ${w.weight}: ${woff2.length} woff2 片`)
}

const header = `/* 本文件由 npm run build:fonts 生成（web/scripts/build-fonts.mjs），请勿手改；
   产物为 Noto Serif SC（思源宋体）woff2 分片，self-host 于 public/fonts/serif/，
   仅 .note-body 正文衬线引用（--font-serif），UI 层仍走 --font-sans。 */\n\n`
writeFileSync(fontsCssPath, header + blocks.join('\n'))
copyFileSync(resolve(srcDir, 'OFL-NotoSerifSC.txt'), resolve(outRoot, 'OFL-NotoSerifSC.txt'))
console.log(`fonts.css → ${fontsCssPath}`)
// Rust FFI 库在 Node 退出清理阶段会段错误（0xC0000005，Windows 实测），产物此时已全部落盘，强制立即退出规避
process.exit(0)
