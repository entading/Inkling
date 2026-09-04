import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { BOARDS, type Board } from './types.js'
import {
  DEFAULT_NOTES_DIR,
  getNotesDir,
  getPersistedDir,
  isPendingRestart,
  isConfiguredMissing,
  isDefaultDir,
} from './appConfig.js'

/**
 * 数据目录管理（G1）：目录探测 / 切换应用 / 版本跟踪启用。
 * 红线：除「创建缺失的板块目录」与「git init + 基线提交」外，绝不移动、删除、
 * 改写目标目录内的任何已有文件（D2 附加式规范化）。
 */

export class DataDirError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export interface GitStatus {
  tracked: boolean
  root: string | null
  hasCommits: boolean
}

const NO_GIT: GitStatus = { tracked: false, root: null, hasCommits: false }

export type DirVerdict = 'empty' | 'ready' | 'needs-normalize' | 'invalid'

export interface ProbeResult {
  path: string
  verdict: DirVerdict
  /** verdict=invalid 时的原因 */
  reason?: string
  /** 路径不存在，确认后可创建 */
  canCreate?: boolean
  /** 目标即当前生效目录（apply 拒绝，UI 短路） */
  isCurrent?: boolean
  isDefaultTarget?: boolean
  missingBoards?: string[]
  boards: Array<{ board: string; mdCount: number; nonMdCount: number }>
  /** 根目录散落的 .md（不会被索引——索引只认板块目录） */
  looseRootMd: number
  /** 大写 .MD 等变体扩展名（不会被索引，扩展名匹配区分大小写） */
  uppercaseMd: number
  /** 顶层非板块条目（.obsidian 等外部数据不算异常），cap 20 */
  otherEntries: Array<{ name: string; isDir: boolean }>
  fileCount: number
  fileCountCapped?: boolean
  nodeModulesPresent?: boolean
  isDriveRoot?: boolean
  git: GitStatus
}

export interface DataDirInfo {
  notesDir: string
  defaultNotesDir: string
  isDefault: boolean
  persistedDir: string
  pendingRestart: boolean
  configuredMissing: boolean
  git: GitStatus
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function invalidProbe(
  base: Pick<ProbeResult, 'path' | 'isCurrent' | 'isDefaultTarget'>,
  reason: string,
  extra: Partial<ProbeResult> = {},
): ProbeResult {
  return {
    ...base,
    verdict: 'invalid',
    reason,
    boards: [],
    looseRootMd: 0,
    uppercaseMd: 0,
    otherEntries: [],
    fileCount: 0,
    git: NO_GIT,
    ...extra,
  }
}

/** git 仓库状态探测：tracked=位于仓库内；hasCommits=HEAD 可解析（init 后未提交 → false）。git 未安装 → 全 false */
export function detectGit(dir: string): Promise<GitStatus> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd: dir, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(NO_GIT)
      const root = stdout.trim()
      if (!root) return resolve(NO_GIT)
      execFile('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, windowsHide: true }, (err2) => {
        resolve({ tracked: true, root, hasCommits: !err2 })
      })
    })
  })
}

/** 设置页数据目录卡的状态总览（GET /api/data-dir 响应体） */
export async function getDataDirInfo(): Promise<DataDirInfo> {
  return {
    notesDir: getNotesDir(),
    defaultNotesDir: DEFAULT_NOTES_DIR,
    isDefault: isDefaultDir(),
    persistedDir: getPersistedDir(),
    pendingRestart: isPendingRestart(),
    configuredMissing: isConfiguredMissing(),
    git: await detectGit(getNotesDir()),
  }
}

/** 用户粘贴路径清洗：trim → 剥一层成对引号 → 去尾部斜杠；空返回 null */
export function cleanInputPath(raw: string): string | null {
  let p = raw.trim()
  if (p.length >= 2) {
    const first = p[0]
    const last = p[p.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      p = p.slice(1, -1).trim()
    }
  }
  p = p.replace(/[\\/]+$/, '')
  // 盘根输入（D:/ → D:）剥掉尾斜杠后失去根形态，补回；其余为空即无效
  if (/^[A-Za-z]:$/.test(p)) p += '\\'
  return p.length > 0 ? p : null
}

/** 路径同一性：Windows 大小写不敏感（resolve 后比较） */
export function samePath(a: string, b: string): boolean {
  const na = path.resolve(a)
  const nb = path.resolve(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

const JUNK_FILES = new Set(['desktop.ini', 'thumbs.db'])

/** 「空目录」口径：仅剩隐藏/系统文件（. 开头、desktop.ini、Thumbs.db）视为空 */
function isVisibleEntry(name: string): boolean {
  return !name.startsWith('.') && !JUNK_FILES.has(name.toLowerCase())
}

const FILE_COUNT_CAP = 20000

interface WalkAcc {
  files: number
  upperMd: number
  capped: boolean
}

/** 递归盘点一个板块目录：返回其 md / 非 md 文件数，累计文件总数计入 acc（cap 防失控遍历） */
function collectStats(dir: string, acc: WalkAcc): { md: number; nonMd: number } {
  let md = 0
  let nonMd = 0
  if (acc.capped) return { md, nonMd }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { md, nonMd } // 子目录读取失败（权限/竞态）：跳过，目标根目录可读性已判定
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = collectStats(path.join(dir, e.name), acc)
      md += sub.md
      nonMd += sub.nonMd
    } else if (e.isFile()) {
      acc.files++
      if (acc.files > FILE_COUNT_CAP) {
        acc.capped = true
        return { md, nonMd }
      }
      if (e.name.endsWith('.md')) {
        md++
      } else {
        nonMd++
        if (/\.md$/i.test(e.name)) acc.upperMd++
      }
    }
  }
  return { md, nonMd }
}

/**
 * 目录探测（check 与 apply 共用，apply 即时重探测防 TOCTOU）。
 * 请求形态问题（空/相对路径/含程序自身）抛 DataDirError；目录本身的问题作为
 * verdict=invalid 数据返回（探测是询问不是失败）。
 */
export async function probeDir(rawPath: string): Promise<ProbeResult> {
  const cleaned = cleanInputPath(rawPath)
  if (!cleaned) throw new DataDirError('路径为空', 400)
  if (!path.isAbsolute(cleaned)) throw new DataDirError('需要绝对路径（如 D:\\MyNotes）', 400)
  const target = path.resolve(cleaned)

  // 目标包含程序自身（程序仓库根本身或其祖先）→ 拒绝：会把源码/node_modules 卷进监听
  const appRoot = path.resolve(import.meta.dirname, '../..')
  const relToApp = path.relative(target, appRoot)
  if (relToApp === '' || (!relToApp.startsWith('..') && !path.isAbsolute(relToApp))) {
    throw new DataDirError('目标目录包含 Inkling 程序自身，不能作为数据目录', 400)
  }

  const base = {
    path: target,
    isCurrent: samePath(target, getNotesDir()),
    isDefaultTarget: samePath(target, DEFAULT_NOTES_DIR),
  }

  let st: fs.Stats
  try {
    st = fs.statSync(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return invalidProbe(base, '路径不存在', { canCreate: true })
    }
    return invalidProbe(base, `路径不可访问：${errText(err)}`)
  }
  if (!st.isDirectory()) return invalidProbe(base, '该路径不是文件夹')
  try {
    fs.accessSync(target, fs.constants.W_OK)
  } catch {
    return invalidProbe(base, '目录不可写')
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(target, { withFileTypes: true })
  } catch (err) {
    return invalidProbe(base, `目录读取失败：${errText(err)}`)
  }

  const missingBoards = BOARDS.filter((b) => !entries.some((e) => e.isDirectory() && e.name === b))
  const acc: WalkAcc = { files: 0, upperMd: 0, capped: false }
  const boards = BOARDS.map((b) => {
    if (missingBoards.includes(b)) return { board: b, mdCount: 0, nonMdCount: 0 }
    const c = collectStats(path.join(target, b), acc)
    return { board: b, mdCount: c.md, nonMdCount: c.nonMd }
  })
  const looseRootMd = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length
  const uppercaseMd =
    acc.upperMd +
    entries.filter((e) => e.isFile() && /\.md$/i.test(e.name) && !e.name.endsWith('.md')).length
  const otherEntries = entries
    .filter((e) => !(BOARDS as string[]).includes(e.name))
    .slice(0, 20)
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
  const visibleCount = entries.filter((e) => isVisibleEntry(e.name)).length
  const verdict: DirVerdict =
    visibleCount === 0 ? 'empty' : missingBoards.length > 0 ? 'needs-normalize' : 'ready'

  return {
    ...base,
    verdict,
    ...(missingBoards.length > 0 ? { missingBoards } : {}),
    boards,
    looseRootMd,
    uppercaseMd,
    otherEntries,
    fileCount: acc.files,
    ...(acc.capped ? { fileCountCapped: true } : {}),
    nodeModulesPresent: entries.some((e) => e.isDirectory() && e.name === 'node_modules'),
    isDriveRoot: path.parse(target).root === target,
    git: await detectGit(target),
  }
}

export interface EnableGitResult {
  ok: true
  committed: boolean
  /** committed=false 时的说明（缺身份配置 / 空目录等） */
  warning?: string
  git: GitStatus
}

interface GitRun {
  ok: boolean
  enoent: boolean
  stderr: string
}

function runGit(args: string[], cwd: string): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, _stdout, stderr) => {
      if (!err) return resolve({ ok: true, enoent: false, stderr: '' })
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return resolve({ ok: false, enoent: true, stderr: '' })
      }
      resolve({ ok: false, enoent: false, stderr: String(stderr || err.message) })
    })
  })
}

/**
 * 在当前生效数据目录启用版本跟踪：git init + （非空时）全量基线提交。
 * 单向操作——不提供停止跟踪（删 .git 属文件系统操作）；已在仓库内 → 409。
 * 初始提交失败（典型：缺 user.name/email）不回滚 init，如实返回 warning，
 * 版本跟踪状态呈「已初始化但无提交」。
 */
export async function enableGitTracking(): Promise<EnableGitResult> {
  if (isPendingRestart()) {
    throw new DataDirError('已有待生效的目录切换，请先重启服务再启用版本跟踪', 409)
  }
  const dir = getNotesDir()
  const before = await detectGit(dir)
  if (before.tracked) {
    throw new DataDirError(`目录已在 git 仓库内（${before.root}），无需启用`, 409)
  }
  let r = await runGit(['init'], dir)
  if (r.enoent) throw new DataDirError('未检测到 git，无法启用版本跟踪', 400)
  if (!r.ok) throw new DataDirError(`git init 失败：${r.stderr}`, 500)

  const visibleCount = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => isVisibleEntry(e.name)).length
  const after = await detectGit(dir)
  if (visibleCount === 0) {
    return { ok: true, committed: false, warning: '目录为空，已初始化仓库（暂无初始提交）', git: after }
  }
  await runGit(['add', '-A', '--', '.'], dir)
  r = await runGit(['commit', '-m', 'chore: 初始化版本跟踪', '--', '.'], dir)
  if (!r.ok) {
    return {
      ok: true,
      committed: false,
      warning: `已初始化仓库，但初始提交失败（${r.stderr.trim().split('\n')[0] || '原因未知'}），自动提交不可用`,
      git: after,
    }
  }
  return { ok: true, committed: true, git: await detectGit(dir) }
}
