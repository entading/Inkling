<script setup lang="ts">
import { RouterLink } from 'vue-router'
import EmptyState from './EmptyState.vue'
import TagBadge from './TagBadge.vue'
import type { NoteMeta } from '../api'

defineProps<{ notes: NoteMeta[] }>()
</script>

<template>
  <ul v-if="notes.length" class="note-list">
    <li v-for="note in notes" :key="`${note.board}/${note.slug}`">
      <!-- 行内标题与标签均为独立链接，避免 <a> 嵌套 -->
      <div class="note-row">
        <RouterLink
          :to="`/v/${note.board}/${encodeURIComponent(note.slug)}`"
          class="row-main row-title-link"
        >
          <span class="row-title">{{ note.title }}</span>
          <span v-if="note.ipa" class="row-ipa">{{ note.ipa }}</span>
          <span v-if="note.source" class="row-source">{{ note.source }}</span>
        </RouterLink>
        <div class="row-side">
          <span class="row-board">{{ note.board === 'sentence' ? '长难句' : note.board === 'grammar' ? '语法' : note.board === 'phrase' ? '短语' : '词汇' }}</span>
          <TagBadge v-for="tag in note.tags.slice(0, 3)" :key="tag" :tag="tag" />
          <span class="row-updated">{{ note.updated }}</span>
        </div>
      </div>
    </li>
  </ul>
  <EmptyState
    v-else
    title="暂无词条"
    description="这里还没有内容，新建一条开始沉淀。"
  >
    <RouterLink to="/new" class="empty-cta">＋ 新建词条</RouterLink>
  </EmptyState>
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

.row-title-link {
  text-decoration: none;
  color: var(--color-text);
}

.row-title-link:hover .row-title {
  color: var(--color-accent);
}

.row-title {
  font-weight: 500;
  font-size: var(--text-md);
  /* 超长不可断词标题折行而非撑破：否则 min-content 沿 flex 链（span 子项 min-width:auto）
  顶开 .note-row 造成文档级横滚（同阅读页 .note-title 的 M1 同款处理） */
  overflow-wrap: anywhere;
}

.row-ipa {
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.row-source {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 弹性填充项：行宽不足时由 source 独自吸收挤压（截断省略），
  避免标题/ipa 被挤出断词；超长标题则被钳到剩余宽度内折行 */
  flex: 1 1 0;
  min-width: 0;
}

.row-side {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.row-board {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
}

.row-updated {
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.empty-cta {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  text-decoration: none;
  transition: opacity 0.15s ease;
}

.empty-cta:hover {
  opacity: 0.88;
}

@media (max-width: 767px) {
  /* 窄屏侧栏行内容放不下时允许换行：标题一行，板块/标签/日期换行排 */
  .note-row {
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2) var(--space-4);
  }

  .row-side {
    flex-wrap: wrap;
    /* flex-shrink:0 的 flex item 按 max-content 计宽，3 个长标签时超出视口；
    封顶后 flex-wrap 才会生效改为换行 */
    max-width: 100%;
  }
}
</style>
