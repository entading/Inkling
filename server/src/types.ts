export type Board = 'vocab' | 'phrase' | 'sentence' | 'grammar'

export interface Note {
  /** 板块名 */
  board: Board
  /** 文件名（不含扩展名），板块内唯一 */
  slug: string
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

/** 单条词条：frontmatter 元数据 + 正文 */
export interface NoteWithBody extends Note {
  /** 正文（不含 frontmatter） */
  body: string
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
