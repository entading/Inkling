import MarkdownIt from 'markdown-it'

/** 全项目唯一 markdown-it 实例（配置与 M1 阅读页一致：禁 HTML、自动链接、不换行断行） */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

/**
 * 剥离 frontmatter 供预览渲染；无 frontmatter 时原样返回。
 * 仅识别文件开头 --- 围栏（YAML 以 ... 结束也算），正文中的 --- 分隔线不受影响。
 */
export function stripFrontmatter(source: string): string {
  const m = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source)
  return m ? source.slice(m[0].length) : source
}

/** 渲染 markdown 源码（含 frontmatter 时自动剥离，供编辑页实时预览复用） */
export function renderMarkdown(source: string): string {
  return md.render(stripFrontmatter(source))
}
