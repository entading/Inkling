import { execFile } from 'node:child_process'
import path from 'node:path'
import { getNotesDir } from './appConfig.js'

/** 项目根目录（数据目录上级），git 命令的工作目录 */
const PROJECT_ROOT = path.resolve(getNotesDir(), '..')

/**
 * 删除词条后自动 git 提交（设计 2「版本管理：后台静默提交，误删可救」）：
 * git add -A notes → git commit，后台执行、不阻塞响应、失败仅 console.warn。
 * git 未安装（ENOENT）等非 git 环境静默跳过；execFile 的同步抛错由 try/catch 兜底。
 */
export function commitNoteDeletion(board: string, slug: string): void {
  try {
    execFile('git', ['add', '-A', 'notes'], { cwd: PROJECT_ROOT }, (err) => {
      if (err) {
        if (err.code === 'ENOENT') return // 非 git 环境静默跳过
        console.warn(`git add 失败，跳过删除自动提交：${err.message}`)
        return
      }
      execFile(
        'git',
        ['commit', '-m', `note: 删除 ${board}/${slug}`],
        { cwd: PROJECT_ROOT },
        (commitErr) => {
          if (!commitErr) return
          if (commitErr.code === 'ENOENT') return
          console.warn(`git commit 失败（文件已删除，仅未提交）：${commitErr.message}`)
        },
      )
    })
  } catch (err) {
    console.warn(`git 自动提交调度失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * 标签批量手术后自动 git 提交（v1.1 T2）：只 add 本次操作实际改写的文件（精确路径，
 * posix 分隔符）——不用 `-A notes`，避免把用户未提交的其他笔记变更（如手改中的
 * 词条）与验证期临时词条卷进自动提交；注册表 json 在 notes/ 外天然不入提交。
 * 后台执行、不阻塞响应、失败仅 console.warn；空文件列表不提交。
 *
 * 复检修复（2026-09-02）：
 * 1. 模块级 promise 队列串行化 + commit 加 pathspec 限定——连续快速操作时异步
 *    add/commit 链会交错（下一操作已暂存的文件被上一提交捎带），并发 commit
 *    还会撞 index.lock；`git commit -m msg -- paths` 只提交指定路径。
 * 2. 两段 add：普通 add 收录 untracked；`--renormalize` 强制重哈希已跟踪文件——
 *    mtime 恢复（updated 保护）+ 等长内容变更会让 git 的 stat 缓存误判「未变」，
 *    add 暂存空集 → commit "no changes"（与 chokidar 失明同根因，N6）。
 *    --renormalize 隐含 -u 不收 untracked，故两段缺一不可。
 */
let commitChain: Promise<void> = Promise.resolve()

export function commitNotesBatch(message: string, relFiles: string[]): void {
  if (relFiles.length === 0) return
  commitChain = commitChain.then(() =>
    runNotesCommit(message, relFiles).catch((err) => {
      console.warn(`git 自动提交调度失败：${err instanceof Error ? err.message : String(err)}`)
    }),
  )
}

function execGit(args: string[]): Promise<void> {
  return new Promise<void>((resolve) => {
    execFile('git', args, { cwd: PROJECT_ROOT }, (err) => {
      if (!err) return resolve()
      if (err.code === 'ENOENT') return resolve() // 非 git 环境静默跳过
      console.warn(`git ${args[0]} 失败，跳过标签操作自动提交：${err.message}`)
      resolve()
    })
  })
}

function runNotesCommit(message: string, relFiles: string[]): Promise<void> {
  return execGit(['add', '--', ...relFiles])
    .then(() => execGit(['add', '--renormalize', '--', ...relFiles]))
    .then(() =>
      new Promise<void>((resolve) => {
        execFile(
          'git',
          ['commit', '-m', message, '--', ...relFiles],
          { cwd: PROJECT_ROOT },
          (commitErr) => {
            if (!commitErr) return resolve()
            if (commitErr.code === 'ENOENT') return resolve()
            console.warn(`git commit 失败（文件已改写，仅未提交）：${commitErr.message}`)
            resolve()
          },
        )
      }),
    )
}
