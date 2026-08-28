<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import TagBadge from '../components/TagBadge.vue'
import MarkdownViewer from '../components/MarkdownViewer.vue'
import { api, type Board, type NoteDetailRaw } from '../api'

const route = useRoute()
const note = ref<NoteDetailRaw | null>(null)
const error = ref('')
const loading = ref(true)

async function load() {
  const board = route.params.board as Board
  const slug = route.params.slug as string
  loading.value = true
  error.value = ''
  try {
    note.value = await api.note(board, slug)
  } catch (e) {
    note.value = null
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => route.params, load)
</script>

<template>
  <div class="note-page">
    <p v-if="error" class="error">
      <strong>词条不存在或加载失败</strong>
      <span>{{ error }}</span>
    </p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <article v-else-if="note" class="note">
      <header class="note-header">
        <div class="note-head-main">
          <h1 class="note-title">{{ note.title }}</h1>
          <p v-if="note.ipa" class="ipa">{{ note.ipa }}</p>
          <div class="note-tags">
            <TagBadge v-for="tag in note.tags" :key="tag" :tag="tag" />
          </div>
          <dl class="note-meta">
            <div v-if="note.source"><dt>来源</dt><dd>{{ note.source }}</dd></div>
            <div><dt>创建</dt><dd>{{ note.created }}</dd></div>
            <div><dt>更新</dt><dd>{{ note.updated }}</dd></div>
          </dl>
        </div>
        <RouterLink :to="`/v/${note.board}/${note.slug}/edit`" class="edit-link">编辑</RouterLink>
      </header>

      <MarkdownViewer :body="note.body" />
    </article>
  </div>
</template>

<style scoped>
.note-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-7) 0;
}

.error strong {
  color: var(--color-text);
}

.note {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-7) var(--space-7) var(--space-7);
  box-shadow: var(--shadow-sm);
}

.note-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.note-head-main {
  min-width: 0;
}

.note-title {
  font-size: 1.7rem;
  font-weight: 700;
  margin: 0 0 var(--space-3);
  letter-spacing: -0.01em;
}

.ipa {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: 1.05rem;
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.note-meta {
  display: flex;
  gap: var(--space-6);
  margin: 0;
  padding: var(--space-3) 0 0;
  border-top: 1px solid var(--color-border);
}

.note-meta > div {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.note-meta dt {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.note-meta dd {
  margin: 0;
  font-size: 0.88rem;
  color: var(--color-text);
}

.edit-link {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-4);
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.edit-link:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.note-body {
  margin-top: var(--space-6);
}

@media (max-width: 767px) {
  .note {
    padding: 20px;
  }

  .note-title {
    font-size: 1.4rem;
  }

  .note-meta {
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-5);
  }
}
</style>
