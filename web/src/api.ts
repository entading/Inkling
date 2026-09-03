/** 与服务端 /api 对应的数据类型（见 server/src/types.ts） */
export type Board = 'vocab' | 'phrase' | 'sentence' | 'grammar'

export interface NoteMeta {
  board: Board
  slug: string
  title: string
  ipa?: string
  tags: string[]
  source?: string
  created: string
  updated: string
}

export interface NoteDetail extends NoteMeta {
  body: string
}

/** 单条完整数据：额外携带原始文件源码（含 frontmatter），编辑页用 */
export interface NoteDetailRaw extends NoteDetail {
  raw: string
}

export interface NewNoteInput {
  board: Board
  slug: string
  title: string
  tags?: string[]
  source?: string
}

export interface BoardInfo {
  board: Board
  label: string
  count: number
}

export interface ServerInfo {
  lanEnabled: boolean
  host: string
  port: number
  lanIps: string[]
  urls: string[]
  qrDataUrl: string
  notesDir: string
}

/** 标签注册表单条目（v1.1）：color 为 0–7 色板索引 */
export interface TagRegistryEntry {
  color: number
  created: string
}

/** 标签注册表：键 = 标签名，持久化于服务端 data/tags.json */
export type TagRegistry = Record<string, TagRegistryEntry>

/** 标签管理操作涉及的词条引用（v1.1 T2） */
export interface TagNoteRef {
  board: string
  slug: string
}

/** 手术无法安全定位/读写的词条：跳过并如实上报（部分成功语义） */
export interface TagWarning extends TagNoteRef {
  reason: string
}

/** 深度删除响应：removedFrom = 实际移除了标签项的词条 */
export interface TagDeleteResult {
  registry: TagRegistry
  removedFrom: TagNoteRef[]
  warnings: TagWarning[]
}

/** 重命名响应：renamedNotes = 实际同步改名的词条 */
export interface TagRenameResult {
  registry: TagRegistry
  renamedNotes: TagNoteRef[]
  warnings: TagWarning[]
}

/** 导入字体条目（F1）：服务端 data/fonts/<id>/manifest.json 的投影 */
export interface FontEntry {
  id: string
  /** 用户可见显示名 */
  name: string
  /** 内部 @font-face family 名（inkling-font-<id>） */
  family: string
  status: 'pending' | 'ready' | 'failed'
  format: 'ttf' | 'otf' | 'woff2'
  sizeBytes: number
  chunkCount: number
  error?: string
  createdAt: string
}

/** API 错误：message 为服务端 error 字段，status 供调用方区分（如新建 409 冲突） */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) message = data.error
    } catch {
      /* 忽略非 JSON 响应 */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export const api = {
  boards: () => fetchJson<BoardInfo[]>('/api/boards'),
  notes: (board: Board) => fetchJson<NoteMeta[]>(`/api/notes?board=${board}`),
  note: (board: Board, slug: string) =>
    fetchJson<NoteDetailRaw>(`/api/notes/${board}/${encodeURIComponent(slug)}`),
  createNote: (input: NewNoteInput) =>
    fetchJson<NoteDetail>('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  saveNote: (board: Board, slug: string, content: string) =>
    fetchJson<NoteDetail>(`/api/notes/${board}/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  deleteNote: (board: Board, slug: string) =>
    fetchJson<{ ok: boolean }>(`/api/notes/${board}/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    }),
  recent: (limit = 10) => fetchJson<NoteMeta[]>(`/api/recent?limit=${limit}`),
  searchIndex: () => fetchJson<NoteDetail[]>('/api/search-index'),
  serverInfo: () => fetchJson<ServerInfo>('/api/server-info'),
  updateSettings: (lanEnabled: boolean) =>
    fetchJson<ServerInfo>('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lanEnabled }),
    }),
  tags: () => fetchJson<TagRegistry>('/api/tags'),
  /** upsert：已存在仅更新颜色；响应为全量注册表 */
  upsertTag: (tag: string, color: number) =>
    fetchJson<TagRegistry>('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, color }),
    }),
  /** 深度删除：注册表条目 + 全部携带词条的标签项一并移除（v1.1 T2） */
  deleteTag: (tag: string) =>
    fetchJson<TagDeleteResult>(`/api/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),
  /** 重命名：注册表键改名 + 携带词条同步替换（v1.1 T2） */
  renameTag: (tag: string, newTag: string) =>
    fetchJson<TagRenameResult>(`/api/tags/${encodeURIComponent(tag)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newTag }),
    }),
  fonts: () => fetchJson<FontEntry[]>('/api/fonts'),
  /** multipart 上传：FormData 由浏览器自动设 boundary，勿手动设 Content-Type（F1） */
  importFont: (name: string, file: File) => {
    const form = new FormData()
    form.append('name', name)
    form.append('file', file)
    return fetchJson<FontEntry>('/api/fonts', { method: 'POST', body: form })
  },
  deleteFont: (id: string) =>
    fetchJson<{ ok: boolean }>(`/api/fonts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
