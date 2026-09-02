import { execFile } from 'node:child_process'
import path from 'node:path'
import { NOTES_DIR } from './scanner.js'

/** 项目根目录（NOTES_DIR 上级），git 命令的工作目录 */
const PROJECT_ROOT = path.resolve(NOTES_DIR, '..')

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
 */
export function commitNotesBatch(message: string, relFiles: string[]): void {
  if (relFiles.length === 0) return
  try {
    execFile('git', ['add', '--', ...relFiles], { cwd: PROJECT_ROOT }, (err) => {
      if (err) {
        if (err.code === 'ENOENT') return
        console.warn(`git add 失败，跳过标签操作自动提交：${err.message}`)
        return
      }
      execFile('git', ['commit', '-m', message], { cwd: PROJECT_ROOT }, (commitErr) => {
        if (!commitErr) return
        if (commitErr.code === 'ENOENT') return
        console.warn(`git commit 失败（文件已改写，仅未提交）：${commitErr.message}`)
      })
    })
  } catch (err) {
    console.warn(`git 自动提交调度失败：${err instanceof Error ? err.message : String(err)}`)
  }
}
