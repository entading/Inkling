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
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export const api = {
  boards: () => fetchJson<BoardInfo[]>('/api/boards'),
  notes: (board: Board) => fetchJson<NoteMeta[]>(`/api/notes?board=${board}`),
  note: (board: Board, slug: string) =>
    fetchJson<NoteDetail>(`/api/notes/${board}/${encodeURIComponent(slug)}`),
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
