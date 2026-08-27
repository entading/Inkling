<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import MarkdownIt from 'markdown-it'
import TagBadge from '../components/TagBadge.vue'
import { api, type Board, type NoteDetail } from '../api'

const route = useRoute()
const note = ref<NoteDetail | null>(null)
const error = ref('')
const loading = ref(true)

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

const html = computed(() => (note.value ? md.render(note.value.body) : ''))

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
      </header>

      <div class="note-body" v-html="html" />
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

.note-body {
  margin-top: var(--space-6);
  line-height: 1.8;
  font-size: 1rem;
  color: var(--color-text);
}

.note-body :deep(h1) {
  font-size: 1.35rem;
  margin: 1.6em 0 0.6em;
}

.note-body :deep(h2) {
  font-size: 1.15rem;
  margin: 1.5em 0 0.5em;
}

.note-body :deep(h3) {
  font-size: 1.05rem;
}

.note-body :deep(p) {
  margin: 0.6em 0;
}

.note-body :deep(ul),
.note-body :deep(ol) {
  margin: 0.6em 0;
  padding-left: 1.6em;
}

.note-body :deep(li) {
  margin: 0.3em 0;
}

.note-body :deep(blockquote) {
  margin: 0.8em 0;
  padding: 0.4em 1em;
  border-left: 3px solid var(--color-accent);
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

.note-body :deep(code) {
  padding: 0.15em 0.4em;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 0.9em;
}

.note-body :deep(pre) {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  overflow-x: auto;
}

.note-body :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
}

.note-body :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(59, 130, 246, 0.3);
}

.note-body :deep(a:hover) {
  border-bottom-color: var(--color-accent);
}

.note-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.95em;
}

.note-body :deep(th),
.note-body :deep(td) {
  border: 1px solid var(--color-border);
  padding: var(--space-2) var(--space-3);
  text-align: left;
}

.note-body :deep(th) {
  background: var(--color-bg);
}

.note-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: var(--space-5) 0;
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

  .note-body {
    font-size: 0.95rem;
  }

  /* 宽表格在窄屏转为块级滚动容器，避免横向撑破页面 */
  .note-body :deep(table) {
    display: block;
    overflow-x: auto;
  }
}
</style>
