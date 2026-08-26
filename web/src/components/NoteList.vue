<script setup lang="ts">
import { RouterLink } from 'vue-router'
import TagBadge from './TagBadge.vue'
import type { NoteMeta } from '../api'

defineProps<{ notes: NoteMeta[] }>()
</script>

<template>
  <ul v-if="notes.length" class="note-list">
    <li v-for="note in notes" :key="`${note.board}/${note.slug}`">
      <RouterLink
        :to="`/v/${note.board}/${encodeURIComponent(note.slug)}`"
        class="note-row"
      >
        <div class="row-main">
          <span class="row-title">{{ note.title }}</span>
          <span v-if="note.ipa" class="row-ipa">{{ note.ipa }}</span>
          <span v-if="note.source" class="row-source">{{ note.source }}</span>
        </div>
        <div class="row-side">
          <span class="row-board">{{ note.board === 'sentence' ? '长难句' : note.board === 'grammar' ? '语法' : note.board === 'phrase' ? '短语' : '词汇' }}</span>
          <TagBadge v-for="tag in note.tags.slice(0, 3)" :key="tag" :tag="tag" />
          <span class="row-updated">{{ note.updated }}</span>
        </div>
      </RouterLink>
    </li>
  </ul>
  <p v-else class="empty">暂无词条</p>
</template>

<style scoped>
.note-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.note-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--color-text);
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    transform 0.15s ease;
}

.note-row:hover {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.row-main {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  min-width: 0;
}

.row-title {
  font-weight: 500;
  font-size: 0.98rem;
}

.row-ipa {
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: 0.88rem;
}

.row-source {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.row-board {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
}

.row-updated {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.empty {
  color: var(--color-text-secondary);
  text-align: center;
  padding: var(--space-7) 0;
}
</style>
