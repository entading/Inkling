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
}
