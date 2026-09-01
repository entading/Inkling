<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import NoteList from '../components/NoteList.vue'
import { BOARD_LABELS, BOARD_ORDER, getSearchIndex } from '../lib/search'
import type { NoteDetail } from '../api'
import { useStaggerArm } from '../lib/stagger'

const route = useRoute()

interface Group {
  board: string
  label: string
  notes: NoteDetail[]
}

const loading = ref(true)
const error = ref('')
const index = ref<NoteDetail[] | null>(null)

// 入场 stagger 窗口（§6）：数据就绪后短暂挂 stagger-arm 祖先类，波浪后摘除
const staggerArm = useStaggerArm(loading)

// vue-router 已对 :tag 参数做过 URL 解码，直接使用即可（再解码会破坏含 % 的标签）
const tag = computed(() => String(route.params.tag ?? ''))

const total = computed(() =>
  index.value ? index.value.filter((n) => n.tags.includes(tag.value)).length : 0,
)

/** 按四板块分组，只渲染非空组 */
const groups = computed<Group[]>(() => {
  const data = index.value
  if (!data) return []
  const result: Group[] = []
  for (const board of BOARD_ORDER) {
    const notes = data.filter((n) => n.board === board && n.tags.includes(tag.value))
    if (notes.length > 0) {
      result.push({ board, label: BOARD_LABELS[board], notes })
    }
  }
  return result
})

onMounted(async () => {
  try {
    index.value = await getSearchIndex()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="tag-detail-page" :class="{ 'stagger-arm': staggerArm }">
    <header class="page-header">
      <h1 class="page-title">
        <span class="hash">#</span>{{ tag }}
      </h1>
      <p class="page-meta">{{ total }} 条词条</p>
    </header>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <p v-else-if="groups.length === 0" class="empty">
      标签「{{ tag }}」暂无词条，可能已被移除。
    </p>

    <template v-else>
      <section v-for="g in groups" :key="g.board" class="tag-group">
        <h2 class="tag-group-title">{{ g.label }}</h2>
        <NoteList :notes="g.notes" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.tag-detail-page {
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

.hash {
  color: var(--color-accent);
  margin-right: 2px;
}

.page-meta {
  color: var(--color-text-secondary);
  font-size: var(--text-base);
}

.tag-group {
  margin-bottom: var(--space-6);
}

.tag-group-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-lg);
  font-weight: 600;
}

.empty,
.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}

.empty {
  padding: var(--space-7) 0;
  text-align: center;
}
</style>
