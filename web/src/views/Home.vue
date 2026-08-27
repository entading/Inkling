<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import NoteList from '../components/NoteList.vue'
import SearchPanel from '../components/SearchPanel.vue'
import { api, type BoardInfo, type NoteMeta } from '../api'

const boards = ref<BoardInfo[]>([])
const recent = ref<NoteMeta[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    ;[boards.value, recent.value] = await Promise.all([
      api.boards(),
      api.recent(10),
    ])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="home">
    <p class="eyebrow">个人英语学习知识沉淀库</p>
    <h1 class="title">今天想查点什么？</h1>

    <SearchPanel autofocus />

    <p v-if="error" class="error">加载失败：{{ error }}（请确认服务端已启动）</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <template v-else>
      <h2 class="section-title">板块</h2>
      <div class="boards">
        <RouterLink
          v-for="b in boards"
          :key="b.board"
          :to="`/${b.board}`"
          class="board-card"
        >
          <span class="board-label">{{ b.label }}</span>
          <span class="board-count">{{ b.count }}<span class="unit">条</span></span>
        </RouterLink>
      </div>

      <h2 class="section-title">最近添加</h2>
      <NoteList :notes="recent" />
    </template>
  </div>
</template>

<style scoped>
.home {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.title {
  font-size: 1.6rem;
  font-weight: 600;
  margin: var(--space-2) 0 var(--space-6);
  letter-spacing: -0.01em;
}

.search-panel {
  margin-bottom: var(--space-7);
}

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: var(--space-7) 0 var(--space-4);
}

.boards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.board-card {
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  text-decoration: none;
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  transition: border-color 0.15s ease, box-shadow 0.15s ease,
    transform 0.15s ease;
}

.board-card:hover {
  border-color: var(--color-accent);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.board-label {
  font-weight: 600;
  font-size: 1rem;
}

.board-count {
  color: var(--color-accent);
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.unit {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--color-text-secondary);
  margin-left: 2px;
}

.eyebrow {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin: 0 0 var(--space-2);
}

.hint {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}
</style>
