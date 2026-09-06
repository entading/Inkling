// 图标生成链（E2 S2）：手写 SVG → @resvg/resvg-js 渲染 PNG（默认 512px）。
// 用法：node scripts/gen-icon.mjs <input.svg> <output.png> [size]
// electron-builder 以 desktop/build/icon.png 为源自动派生 win ico，无需手工转换。
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const [input, output, sizeArg] = process.argv.slice(2)
if (!input || !output) {
  console.error('用法：node scripts/gen-icon.mjs <input.svg> <output.png> [size]')
  process.exit(1)
}
const size = Number(sizeArg) || 512
const resvg = new Resvg(readFileSync(input, 'utf8'), {
  fitTo: { mode: 'width', value: size },
  font: { loadSystemFonts: false },
})
writeFileSync(output, resvg.render().asPng())
console.log(`已生成 ${output}（${size}px）`)
