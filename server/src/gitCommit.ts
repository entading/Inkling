import { execFile } from 'node:child_process'
import path from 'node:path'
import { getNotesDir } from './appConfig.js'

/**
 * 自动 git 提交（G1 起跟随数据目录）：提交目标 = 当前数据目录所在的 git 仓库
 * （`git rev-parse --show-toplevel` 现探不缓存——调用点均为低频后台操作）。
 * 数据目录不在任何仓库内（版本跟踪未启用）或 git 未安装 → 静默跳过（尽力而为语义，
 * 设置页版本跟踪状态如实呈现）；pathspec 一律限定到数据目录相对仓库根的子树，
 * 目录在更大仓库内时不卷入仓库内其他变更。后台执行、不阻塞响应、失败仅 console.warn。
 */

function resolveGitRoot(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd: getNotesDir() }, (err, stdout) => {
      if (err) return resolve(null)
      const root = stdout.trim()
      resolve(root.length > 0 ? root : null)
    })
  })
}

/** 绝对路径 → 相对仓库根的 posix 路径（恰为仓库根时 '.'） */
function relFromRoot(root: string, absPath: string): string {
  const rel = path.relative(root, absPath).replace(/\\/g, '/')
  return rel.length > 0 ? rel : '.'
}

/**
 * 删除词条后自动 git 提交（设计 2「版本管理：后台静默提交，误删可救」）：
 * git add -A -- <数据目录相对仓库根路径> → git commit -- <同一 pathspec>。
 * add -A 会把数据目录内全部变更（含手工放入的未跟踪笔记）一并提交——这是既定语义；
 * 批量清理临时词条必须走文件系统删除，勿经 DELETE API。
 */
export function commitNoteDeletion(board: string, slug: string): void {
  void (async () => {
    try {
      const root = await resolveGitRoot()
      if (!root) return
      const target = relFromRoot(root, getNotesDir())
      await execGit(['add', '-A', '--', target], root)
      await runGitCommit(`note: 删除 ${board}/${slug}`, [target], root, (msg) =>
        console.warn(`git commit 失败（文件已删除，仅未提交）：${msg}`),
      )
    } catch (err) {
      console.warn(`git 自动提交调度失败：${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}

/**
 * 标签批量手术后自动 git 提交（v1.1 T2 引入）：只提交本次操作实际改写的文件
 * （入参为绝对路径，本模块内部相对仓库根换算）——不用 add -A，避免把用户未提交的
 * 其他笔记变更与验证期临时词条卷进自动提交；注册表 json 在数据目录外天然不入提交。
 *
 * 两段 add + pathspec commit 三重防线（复检修复 2026-09-02，语义不变）：
 * 1. 模块级 promise 队列串行化 + commit 加 pathspec 限定——连续快速操作时异步
 *    add/commit 链会交错，并发 commit 还会撞 index.lock；
 * 2. 两段 add：普通 add 收录 untracked；`--renormalize` 强制重哈希已跟踪文件——
 *    mtime 恢复（updated 保护）+ 等长内容变更会让 git 的 stat 缓存误判「未变」，
 *    add 暂存空集 → commit "no changes"（与 chokidar 失明同根因）。
 *    --renormalize 隐含 -u 不收 untracked，故两段缺一不可。
 */
let commitChain: Promise<void> = Promise.resolve()

export function commitNotesBatch(message: string, absFiles: string[]): void {
  if (absFiles.length === 0) return
  commitChain = commitChain.then(() =>
    runNotesCommit(message, absFiles).catch((err) => {
      console.warn(`git 自动提交调度失败：${err instanceof Error ? err.message : String(err)}`)
    }),
  )
}

function execGit(args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile('git', args, { cwd }, (err) => {
      if (!err) return resolve()
      if (err.code === 'ENOENT') return resolve() // 非 git 环境静默跳过
      console.warn(`git ${args[0]} 失败，跳过标签操作自动提交：${err.message}`)
      resolve()
    })
  })
}

function runGitCommit(
  message: string,
  pathspecs: string[],
  cwd: string,
  onFail: (msg: string) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile('git', ['commit', '-m', message, '--', ...pathspecs], { cwd }, (commitErr) => {
      if (!commitErr) return resolve()
      if (commitErr.code === 'ENOENT') return resolve()
      onFail(commitErr.message)
      resolve()
    })
  })
}

async function runNotesCommit(message: string, absFiles: string[]): Promise<void> {
  const root = await resolveGitRoot()
  if (!root) return
  const relFiles = [
    ...new Set(
      absFiles
        .map((f) => path.relative(root, f).replace(/\\/g, '/'))
        .filter((rel) => rel.length > 0 && !rel.startsWith('../')),
    ),
  ]
  if (relFiles.length === 0) return
  await execGit(['add', '--', ...relFiles], root)
  await execGit(['add', '--renormalize', '--', ...relFiles], root)
  await runGitCommit(message, relFiles, root, (msg) =>
    console.warn(`git commit 失败（文件已改写，仅未提交）：${msg}`),
  )
}
