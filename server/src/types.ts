export type Board = 'vocab' | 'phrase' | 'sentence' | 'grammar'

export interface Note {
  /** 板块名 */
  board: Board
  /** 文件名（不含扩展名），板块内唯一 */
  slug: string
  /** 相对 notes/ 的路径（含可能的子目录），仅服务端内部使用，API 响应中剥离 */
  filePath: string
  /** 显示标题，无 frontmatter 时以文件名兜底 */
  title: string
  /** IPA 音标（可选） */
  ipa?: string
  /** 自由标签 */
  tags: string[]
  /** 来源记录（可选） */
  source?: string
  /** 创建日期（YYYY-MM-DD） */
  created: string
  /** 最后更新日期（YYYY-MM-DD） */
  updated: string
}

/** API 对外形态：不含服务端内部字段（filePath） */
export type NotePublic = Omit<Note, 'filePath'>

/** 单条词条：frontmatter 元数据 + 正文 */
export interface NoteWithBody extends NotePublic {
  /** 正文（不含 frontmatter） */
  body: string
}

/** 单条词条完整数据：额外携带原始文件源码（含 frontmatter），编辑页用 */
export interface NoteWithRaw extends NoteWithBody {
  raw: string
}

export interface BoardInfo {
  board: Board
  label: string
  count: number
}

export const BOARDS: Board[] = ['vocab', 'phrase', 'sentence', 'grammar']

export const BOARD_LABELS: Record<Board, string> = {
  vocab: '词汇 Vocab',
  phrase: '短语 Phrase',
  sentence: '长难句 Sentence',
  grammar: '语法 Grammar',
}
