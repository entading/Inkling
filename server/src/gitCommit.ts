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
