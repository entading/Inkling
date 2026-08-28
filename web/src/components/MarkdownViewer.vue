<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../lib/markdown'

const props = defineProps<{ body: string }>()

const html = computed(() => renderMarkdown(props.body))
</script>

<template>
  <div class="note-body" v-html="html" />
</template>

<style scoped>
/* 样式迁自 NoteView.vue（M4 抽组件），阅读页与编辑页预览共用 */
.note-body {
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
