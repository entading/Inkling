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

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
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
  boards: () => get<BoardInfo[]>('/api/boards'),
  notes: (board: Board) => get<NoteMeta[]>(`/api/notes?board=${board}`),
  note: (board: Board, slug: string) =>
    get<NoteDetail>(`/api/notes/${board}/${encodeURIComponent(slug)}`),
  recent: (limit = 10) => get<NoteMeta[]>(`/api/recent?limit=${limit}`),
}
