import MarkdownIt from 'markdown-it'

/** 全项目唯一 markdown-it 实例（配置与 M1 阅读页一致：禁 HTML、自动链接、不换行断行） */
const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

/**
 * 剥离 frontmatter；无 frontmatter 时原样返回。
 * 仅识别文件开头 --- 围栏（YAML 以 ... 结束也算），正文中的 --- 分隔线不受影响。
 * 注意：只应在「编辑器全文源码」上调用（编辑页预览）；阅读页 body 已由 gray-matter 剥离，
 * 若正文本身以 --- 开头会被误剥，故 MarkdownViewer 不做剥离。
 */
export function stripFrontmatter(source: string): string {
  const m = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source)
  return m ? source.slice(m[0].length) : source
}

/** 渲染 markdown（原样渲染，不处理 frontmatter） */
export function render(source: string): string {
  return md.render(source)
}
