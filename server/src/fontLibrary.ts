import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'

/**
 * 导入字体库（F1 阅读字体管理）：用户上传的字体文件经 cn-font-split 运行时分片后
 * self-host，持久化于 data/fonts/<id>/（仓库根、notes/ 之外——chokidar 只盯 notes/，
 * 二进制资产不入库，.gitignore 已排除 data/fonts/）。
 *
 * 目录布局：
 *   data/fonts/<id>/manifest.json   条目元数据（原子写）
 *   data/fonts/<id>/source.<ext>    上传源文件（分片成功即删，E4）
 *   data/fonts/<id>/chunks/*.woff2  分片产物 + fonts.css（url 指向 GET /api/fonts/<id>/file/*）
 *
 * 分片在独立子进程跑（server/scripts/split-font.mjs）：cn-font-split 的 Rust FFI 在
 * Node 退出清理阶段段错误（0xC0000005，Windows 实测），子进程尾部 process.exit(0)
 * 规避且不污染常驻服务主进程；任务经模块级 promise 队列串行化（同时上传多字体不并发切分）。
 */

export const FONTS_DIR = path.resolve(import.meta.dirname, '../../data/fonts')
const SPLIT_SCRIPT = path.resolve(import.meta.dirname, '../scripts/split-font.mjs')

export type FontStatus = 'pending' | 'ready' | 'failed'
export type FontFormat = 'ttf' | 'otf' | 'woff2'

export interface FontManifest {
  id: string
  /** 用户可见显示名（仅展示用，非唯一键） */
  name: string
  /** 内部 @font-face family 名（inkling-font-<id>，服务端生成杜绝与系统字体撞名） */
  family: string
  status: FontStatus
  format: FontFormat
  /** 上传源文件字节数（删除源文件后仍保留供 UI 展示） */
  sizeBytes: number
  /** 分片 woff2 数量（ready 后填写） */
  chunkCount: number
  /** failed 时的失败原因（供 UI 展示与重试决策） */
  error?: string
  createdAt: string
}

let fonts: FontManifest[] = []

// ---------- 持久化 ----------

function manifestPath(id: string): string {
  return path.join(FONTS_DIR, id, 'manifest.json')
}

/** 原子写：同目录临时文件 + rename（Windows 上 rename 覆盖已存在目标），杜绝半文件 */
function persistManifest(m: FontManifest): void {
  const file = manifestPath(m.id)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, file)
}

/** 先写盘后改内存：写盘失败向上抛（路由转 500），内存保持与磁盘一致 */
function update(m: FontManifest): void {
  persistManifest(m)
  const i = fonts.findIndex((f) => f.id === m.id)
  if (i >= 0) fonts[i] = m
  else fonts.push(m)
}

// ---------- 模块级加载：routes.ts 引入本模块即完成初始化，index.ts 无需感知 ----------

try {
  for (const entry of fs.readdirSync(FONTS_DIR)) {
    const dir = path.join(FONTS_DIR, entry)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')
      const m = JSON.parse(raw) as FontManifest
      if (
        m &&
        typeof m.id === 'string' &&
        typeof m.name === 'string' &&
        typeof m.family === 'string' &&
        (m.status === 'pending' || m.status === 'ready' || m.status === 'failed')
      ) {
        // 上代进程遗留的 pending：分片子进程已随进程消亡，标记失败让用户重新上传
        if (m.status === 'pending') {
          m.status = 'failed'
          m.error = '导入被服务重启中断，请删除后重新上传'
          persistManifest(m)
        }
        fonts.push(m)
      } else {
        console.warn(`字体条目 manifest 形状非法，已跳过：${dir}`)
      }
    } catch (err) {
      console.warn(
        `字体条目加载失败（已跳过）：${dir} —— ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn(
      `字体库目录扫描失败（已按空库兜底）：${FONTS_DIR} —— ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ---------- 基础存取 ----------

export function listFonts(): FontManifest[] {
  return [...fonts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getFont(id: string): FontManifest | undefined {
  return fonts.find((f) => f.id === id)
}

/** 新建条目：id 用随机 hex（非用户输入，杜绝路径注入），family 服务端生成 */
export function createFontRecord(name: string, format: FontFormat, sizeBytes: number): FontManifest {
  const id = randomBytes(6).toString('hex')
  const m: FontManifest = {
    id,
    name,
    family: `inkling-font-${id}`,
    status: 'pending',
    format,
    sizeBytes,
    chunkCount: 0,
    createdAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.join(FONTS_DIR, id), { recursive: true })
  update(m)
  return m
}

/** 部分更新（内存对象就地合并后整体持久化） */
export function patchFont(id: string, patch: Partial<Omit<FontManifest, 'id'>>): FontManifest {
  const m = getFont(id)
  if (!m) throw new Error(`字体条目不存在: ${id}`)
  const next: FontManifest = { ...m, ...patch, id }
  update(next)
  return next
}

/** 整目录移除（manifest + chunks + 可能残留的源文件）；先删盘后改内存。
 * 在途分片子进程先行终止（否则其继续写盘会复活已删目录）；Windows 下目录可能被
 * AV/索引器等暂态占用（EPERM），短退避重试兜底 */
export function removeFont(id: string): void {
  activeSplits.get(id)?.kill()
  const dir = path.join(FONTS_DIR, id)
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      fonts = fonts.filter((f) => f.id !== id)
      return
    } catch (err) {
      lastErr = err
    }
    // 同步 sleep：Node 主线程允许 Atomics.wait（浏览器才禁），removeFont 保持同步签名
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  }
  throw lastErr
}

/** 魔数识别格式（ttf/otf/woff2 之外——含 woff/ttc——一律 null，路由层转 400） */
export function detectFontFormat(buf: Buffer): FontFormat | null {
  if (buf.length < 4) return null
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) return 'ttf'
  const head = buf.toString('latin1', 0, 4)
  if (head === 'OTTO') return 'otf'
  if (head === 'wOF2') return 'woff2'
  return null
}

// ---------- 分片任务队列（E1 异步 + E2 子进程） ----------

let chain: Promise<void> = Promise.resolve()

/** 在途分片子进程登记：删除条目时先终止，防止子进程写入复活已删目录 */
const activeSplits = new Map<string, ChildProcess>()

/** 入队分片：立即返回，任务串行执行；上传路由先落盘 source.<ext> 再调本函数 */
export function enqueueFontSplit(id: string): void {
  chain = chain.then(() => runSplit(id)).catch((err) => {
    console.warn(`字体分片任务异常（已跳过）：${id} —— ${err instanceof Error ? err.message : String(err)}`)
  })
}

function failFont(id: string, message: string): void {
  try {
    patchFont(id, { status: 'failed', error: message })
  } catch (err) {
    console.warn(`分片失败状态写盘异常：${id} —— ${err instanceof Error ? err.message : String(err)}`)
  }
}

function runSplit(id: string): Promise<void> {
  const font = getFont(id)
  if (!font) return Promise.resolve()
  const dir = path.join(FONTS_DIR, id)
  const sourcePath = path.join(dir, `source.${font.format}`)
  const chunksDir = path.join(dir, 'chunks')

  return new Promise((resolveJob) => {
    fs.rmSync(chunksDir, { recursive: true, force: true })
    fs.mkdirSync(chunksDir, { recursive: true })
    // E2：分片放独立子进程——服务主进程不阻塞，且子进程 process.exit(0) 规避 FFI 退出段错误
    const child = spawn(
      process.execPath,
      [
        SPLIT_SCRIPT,
        '--in',
        sourcePath,
        '--out',
        chunksDir,
        '--family',
        font.family,
        '--base-url',
        `/api/fonts/${id}/file`,
        '--weight',
        '400',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    activeSplits.set(id, child)
    child.on('close', () => {
      activeSplits.delete(id)
    })
    child.stdout.on('data', (d: Buffer) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += String(d)
    })
    child.on('error', (err) => {
      failFont(id, `分片子进程启动失败：${err.message}`)
      resolveJob()
    })
    child.on('close', (code) => {
      if (code === 0) {
        try {
          // E4：分片成功即删源文件（chunks/ 内已含全部产物），只留 woff2 + fonts.css
          fs.rmSync(sourcePath, { force: true })
          const chunkCount = fs.readdirSync(chunksDir).filter((f) => f.endsWith('.woff2')).length
          patchFont(id, { status: 'ready', chunkCount, error: undefined })
          console.log(`字体分片完成：${font.name}（${chunkCount} 片）`)
        } catch (err) {
          failFont(id, `分片产物收尾失败：${err instanceof Error ? err.message : String(err)}`)
        }
      } else {
        failFont(id, `分片失败（exit ${code}）：${(stderr || stdout).trim().slice(-400) || '无输出'}`)
      }
      resolveJob()
    })
  })
}

// ---------- CSS 聚合（前端动态 <style> 注入的数据源） ----------

/** 覆盖范围（F1 追加，用户拍板）：all=全部字符；cjk=仅中文；latin=仅英文。
 * 实现机制 = 分片产物过滤——cn-font-split 每片自带 unicode-range，聚合时按码位
 * 与中文侧集合的交集取舍；缺片的码位视为缺字自动回落字体栈后一家，栈序零改动。 */
export type FontScope = 'all' | 'cjk' | 'latin'

/** 中文侧码位集合：CJK 各区块 + 全角形式（全角标点归中文，用户拍板）+
 * 破折号例外 U+2014–2015（——连排即中文破折号，归中文侧；西文 em dash 少见可接受）。
 * 省略号 U+2026 / 弯引号 U+2018–201D 等中西共用标点**不在**集合内（归英文侧，用户拍板） */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2e80, 0x2eff],   // CJK 部首补充
  [0x3000, 0x303f],   // CJK 符号和标点（。、《》「」）
  [0x31c0, 0x31ef],   // CJK 笔画
  [0x3200, 0x32ff],   // 附标 CJK 字符
  [0x3400, 0x4dbf],   // CJK 扩展 A
  [0x4e00, 0x9fff],   // CJK 统一表意
  [0xf900, 0xfaff],   // CJK 兼容表意
  [0xfe30, 0xfe4f],   // CJK 兼容形式
  [0xff00, 0xffef],   // 全角形式（，！？ＡＢ）
  [0x20000, 0x2ebef], // CJK 扩展 B–F
  [0x2014, 0x2015],   // 破折号例外（用户拍板归中文侧）
]

/** 解析 unicode-range 值（"U+4E00-4FFF,U+5C0A"）为码位区间列表；? 通配按上下界展开 */
function parseUnicodeRanges(value: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const part of value.split(',')) {
    const m = /^U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f?]+))?$/.exec(part.trim())
    if (!m) continue
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16)
    const hi = m[2]
      ? parseInt(m[2].replace(/\?/g, 'f'), 16)
      : parseInt(m[1].replace(/\?/g, 'f'), 16)
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi) continue
    out.push([lo, hi])
  }
  return out
}

type Ivl = readonly [number, number]

/** 区间交集：与 CJK 集合求交用（cjk 模式） */
function intersectIvls(a: readonly Ivl[], b: readonly Ivl[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [lo1, hi1] of a) {
    for (const [lo2, hi2] of b) {
      const lo = Math.max(lo1, lo2)
      const hi = Math.min(hi1, hi2)
      if (lo <= hi) out.push([lo, hi])
    }
  }
  return out
}

/** 区间差集：从 a 中剔除 b 覆盖部分（latin 模式），段可能被拆细 */
function subtractIvls(a: readonly Ivl[], b: readonly Ivl[]): Array<[number, number]> {
  let out: Array<[number, number]> = a.map((ivl) => [ivl[0], ivl[1]])
  for (const [blo, bhi] of b) {
    const next: Array<[number, number]> = []
    for (const [lo, hi] of out) {
      if (hi < blo || lo > bhi) {
        next.push([lo, hi])
        continue
      }
      if (lo < blo) next.push([lo, blo - 1])
      if (hi > bhi) next.push([bhi + 1, hi])
    }
    out = next
  }
  return out
}

/** 格式化为 unicode-range 值：排序、合并相邻/重叠段、大写 hex（U+XXXX / U+XXXX-YYYY） */
function formatRanges(ivls: Array<[number, number]>): string {
  const sorted = [...ivls].sort((p, q) => p[0] - q[0])
  const merged: Array<[number, number]> = []
  for (const ivl of sorted) {
    const last = merged[merged.length - 1]
    if (last && ivl[0] <= last[1] + 1) last[1] = Math.max(last[1], ivl[1])
    else merged.push([ivl[0], ivl[1]])
  }
  return merged
    .map(([lo, hi]) =>
      lo === hi
        ? `U+${lo.toString(16).toUpperCase()}`
        : `U+${lo.toString(16).toUpperCase()}-${hi.toString(16).toUpperCase()}`,
    )
    .join(',')
}

/** 全部 ready 字体的 @font-face 汇总；scope 过滤见 FontScope。
 * 实施关键（复检修正）：cn-font-split 的分片是字形分组粒度——同一片的 range 混有
 * 拉丁与 CJK 码位段（如引号/省略号与中文标点同片、基本拉丁片混入 CJK 段），**块级
 * 整块取舍无法表达「片内单码位归属」**，故保留块必须改写 unicode-range：cjk = 原
 * range ∩ CJK_RANGES，latin = 原 range − CJK_RANGES，改写后为空的块丢弃。 */
export function aggregateFontCss(scope: FontScope = 'all'): string {
  const blocks: string[] = []
  for (const f of fonts) {
    if (f.status !== 'ready') continue
    try {
      const css = fs.readFileSync(path.join(FONTS_DIR, f.id, 'chunks', 'fonts.css'), 'utf-8')
      if (scope === 'all') {
        blocks.push(css)
        continue
      }
      const faces = css.match(/@font-face\{[^}]*\}/g) ?? []
      const kept: string[] = []
      for (const face of faces) {
        const m = /unicode-range:([^;}]+)/.exec(face)
        if (!m) continue // 无 range 的块视为覆盖不明，仅 all 保留
        const orig = parseUnicodeRanges(m[1])
        const scoped =
          scope === 'cjk' ? intersectIvls(orig, CJK_RANGES) : subtractIvls(orig, CJK_RANGES)
        if (scoped.length === 0) continue
        kept.push(face.replace(m[1], formatRanges(scoped)))
      }
      if (kept.length > 0) blocks.push(kept.join(''))
    } catch {
      /* manifest ready 但产物缺失（异常中断等）：跳过该字体 */
    }
  }
  return blocks.join('\n')
}
