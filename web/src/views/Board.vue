<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import NoteList from '../components/NoteList.vue'
import { api, type Board, type NoteMeta } from '../api'

const props = defineProps<{ board: Board }>()

const boardLabels: Record<Board, string> = {
  vocab: '词汇 · Vocab',
  phrase: '短语 · Phrase',
  sentence: '长难句 · Sentence',
  grammar: '语法 · Grammar',
}

const notes = ref<NoteMeta[]>([])
const loading = ref(true)
const error = ref('')

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

onMounted(load)
watch(() => props.board, load)
</script>

<template>
  <div class="board-page">
    <header class="board-header">
      <h1 class="board-title">{{ boardLabels[board] }}</h1>
      <p class="board-meta">{{ notes.length }} 条词条</p>
    </header>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <NoteList v-else :notes="notes" />
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
  margin-bottom: var(--space-6);
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

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}
</style>
