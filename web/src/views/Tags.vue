<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { aggregateTags, type TagCount } from '../lib/search'

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
    <p v-else-if="tags.length === 0" class="hint">暂无标签，给词条加上标签后会出现在这里。</p>

    <div v-else class="tag-cloud">
      <RouterLink
        v-for="t in tags"
        :key="t.tag"
        :to="`/tags/${encodeURIComponent(t.tag)}`"
        class="cloud-tag"
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
  font-size: 1.4rem;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}

.page-meta {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
}

.cloud-tag {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 2px 12px;
  border-radius: var(--radius-full);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  line-height: 1.8;
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.cloud-tag:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
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
