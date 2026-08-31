<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { aggregateTags, type TagCount } from '../lib/search'
import EmptyState from '../components/EmptyState.vue'
import { tagPairIndex } from '../lib/tagColor'

const tags = ref<TagCount[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    tags.value = await aggregateTags()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

/** 字号按词条数在 0.85–1.5rem 间线性加权 */
const maxCount = computed(() => {
  const counts = tags.value.map((t) => t.count)
  return counts.length ? Math.max(...counts) : 1
})

function fontSize(count: number): string {
  const ratio = count / maxCount.value
  return `${(0.85 + ratio * 0.65).toFixed(2)}rem`
}
</script>

<template>
  <div class="tags-page">
    <header class="page-header">
      <h1 class="page-title">标签</h1>
      <p class="page-meta">{{ tags.length }} 个标签</p>
    </header>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <EmptyState
      v-else-if="tags.length === 0"
      title="暂无标签"
      description="给词条加上标签后会出现在这里。"
    />

    <div v-else class="tag-cloud">
      <RouterLink
        v-for="t in tags"
        :key="t.tag"
        :to="`/tags/${encodeURIComponent(t.tag)}`"
        class="cloud-tag"
        :class="`tag-pair-${tagPairIndex(t.tag)}`"
        :style="{ fontSize: fontSize(t.count) }"
        :title="`${t.count} 条词条`"
      >
        {{ t.tag }}
        <span class="cloud-count">{{ t.count }}</span>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.tags-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-6);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}

.page-meta {
  color: var(--color-text-secondary);
  font-size: var(--text-base);
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
}

/* 底色/文字色由 tokens.css 的 .tag-pair-N 提供（hash 稳定取色，与 TagBadge 同源） */
.cloud-tag {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 2px 12px;
  border-radius: var(--radius-full);
  line-height: 1.8;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

/* hover 与 TagBadge 同策略：叠加 --tag-hover-overlay 强化，不动文字色 */
.cloud-tag:hover {
  background-image: linear-gradient(var(--tag-hover-overlay), var(--tag-hover-overlay));
}

.cloud-count {
  font-size: 0.7em;
  opacity: 0.7;
}

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}
</style>
