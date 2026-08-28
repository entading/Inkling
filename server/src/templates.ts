import matter from 'gray-matter'
import type { Board } from './types.js'
import { dateOfLocal } from './scanner.js'

export interface TemplateInput {
  title: string
  tags: string[]
  source?: string
}

/** 各板块建议骨架（设计 4.4 / 第 6 节；仅新建时生成，用户可自由删改） */
const BODY_TEMPLATES: Record<Board, (title: string) => string> = {
  vocab: (title) => `# ${title}

**词性**：...

**释义**：...

**搭配**：
- ...

**例句**：
- ...

**近义词辨析**：...

**词根词缀**：...
`,
  phrase: (title) => `# ${title}

**释义**：...

**用法**：...

**例句**：
- ...

**易混辨析**：...
`,
  sentence: (title) => `# ${title}

**原句**：...

**结构拆解**：
- 主干：...
- 从句：...

**重点词汇**：...

**翻译**：...
`,
  grammar: (title) => `# ${title}

**规则**：...

**例句**：
- ...

**易错点**：...

**对比辨析**：...
`,
}

/**
 * 生成新建骨架：frontmatter 写 title/tags/source/created，不写 updated
 * （updated 由文件 mtime 兜底，scanner 的 createDateStr 已支持）。
 * frontmatter 用 gray-matter stringify 序列化，标题含冒号等特殊字符也能正确转义。
 */
export function buildTemplate(board: Board, input: TemplateInput): string {
  const data: Record<string, unknown> = {
    title: input.title,
    created: dateOfLocal(new Date()),
  }
  if (input.tags.length > 0) data.tags = input.tags
  if (input.source) data.source = input.source
  return matter.stringify(BODY_TEMPLATES[board](input.title), data)
}
