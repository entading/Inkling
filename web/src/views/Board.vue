<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NoteList from '../components/NoteList.vue'
import AZIndex from '../components/AZIndex.vue'
import { api, type Board, type NoteDetail, type NoteMeta } from '../api'
import { getSearchIndex, searchBoard } from '../lib/search'

const props = defineProps<{ board: Board }>()

const route = useRoute()

const boardLabels: Record<Board, string> = {
  vocab: '词汇 · Vocab',
  phrase: '短语 · Phrase',
  sentence: '长难句 · Sentence',
  grammar: '语法 · Grammar',
}

const notes = ref<NoteMeta[]>([])
const loading = ref(true)
const error = ref('')

const query = ref('')
const fulltext = ref(false)
const indexData = ref<NoteDetail[] | null>(null)
const indexError = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    notes.value = await api.notes(props.board)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 全文模式需要正文，从 search-index（缓存的 Promise）取本板块数据 */
async function loadIndex() {
  if (indexData.value || indexError.value) return
  try {
    indexData.value = await getSearchIndex()
  } catch (e) {
    indexError.value = `全文索引加载失败：${e instanceof Error ? e.message : String(e)}`
  }
}

const filtered = computed<NoteMeta[]>(() => {
  const q = query.value.trim()
  if (!q) return notes.value
  return searchBoard(notes.value, q, indexData.value?.filter((n) => n.board === props.board) ?? null, {
    fulltext: fulltext.value,
  })
})

function syncFromRoute() {
  const q = route.query.q
  const ft = route.query.fulltext
  query.value = typeof q === 'string' ? q : ''
  fulltext.value = ft === '1' || ft === 'true'
  if (fulltext.value) void loadIndex()
}

function toggleFulltext() {
  fulltext.value = !fulltext.value
  if (fulltext.value) void loadIndex()
}

onMounted(() => {
  void load()
  syncFromRoute()
})
watch(() => props.board, load)
watch(() => route.query, syncFromRoute)
</script>

<template>
  <div class="board-page">
    <header class="board-header">
      <h1 class="board-title">{{ boardLabels[board] }}</h1>
      <p class="board-meta">{{ filtered.length }} / {{ notes.length }} 条词条</p>
    </header>

    <div class="board-search">
      <svg class="board-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
      <input
        v-model="query"
        class="board-search-input"
        type="text"
        placeholder="在本板块内过滤（标题 / 标签 / 音标 / 来源）"
        aria-label="板块内搜索"
      />
      <button
        type="button"
        class="chip"
        :class="{ active: fulltext }"
        :aria-pressed="fulltext"
        @click="toggleFulltext"
      >
        全文
      </button>
    </div>
    <p v-if="indexError" class="error">{{ indexError }}</p>
    <p v-else-if="fulltext && !indexData && query.trim()" class="hint">全文索引加载中…</p>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <p v-else-if="query.trim() && filtered.length === 0" class="hint">没有匹配「{{ query.trim() }}」的词条</p>
    <AZIndex v-else-if="board === 'vocab'" :notes="filtered" />
    <NoteList v-else :notes="filtered" />
  </div>
</template>

<style scoped>
.board-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.board-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.board-title {
  font-size: 1.4rem;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}

.board-meta {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.board-search {
  position: relative;
  margin-bottom: var(--space-6);
}

.board-search-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.board-search-input {
  width: 100%;
  padding: 10px 44px 10px 38px;
  font-size: 0.95rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.board-search-input::placeholder {
  color: var(--color-text-secondary);
}

.board-search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.chip {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  padding: 2px 10px;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.chip:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.chip.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}
</style>
