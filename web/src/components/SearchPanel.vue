<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getSearchIndex, search, type SearchGroup } from '../lib/search'

const props = defineProps<{ autofocus?: boolean }>()

const router = useRouter()
const inputEl = ref<HTMLInputElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

const query = ref('')
const fulltext = ref(false)
const open = ref(false)
const loading = ref(false)
const error = ref('')
const groups = ref<SearchGroup[]>([])
const activeIndex = ref(-1)

/** 每次输入自增，抵消过期异步结果 */
let seq = 0
let debounceTimer: number | undefined

interface FlatItem {
  key: string
  type: 'note' | 'all'
  board: string
  slug?: string
}

const flatItems = computed<FlatItem[]>(() => {
  const items: FlatItem[] = []
  for (const g of groups.value) {
    // 组头（查看全部）在组内词条之前，与渲染顺序一致
    items.push({ key: `all-${g.board}`, type: 'all', board: g.board })
    for (const n of g.notes) {
      items.push({ key: `${n.board}/${n.slug}`, type: 'note', board: n.board, slug: n.slug })
    }
  }
  return items
})

function indexOfKey(key: string): number {
  return flatItems.value.findIndex((i) => i.key === key)
}

const hasQuery = computed(() => query.value.trim().length > 0)

function close() {
  open.value = false
  activeIndex.value = -1
}

/** 首次聚焦时惰性拉取索引；失败显示轻提示。
 * 加载中再次调用时共享等待同一个 Promise（getSearchIndex 自带缓存去重），
 * 仅发起方管理 loading/error；并发 run 靠外层 seq 守卫只放行最新 query */
async function ensureIndex(): Promise<boolean> {
  const initiator = !loading.value
  if (initiator) {
    loading.value = true
    error.value = ''
  }
  try {
    await getSearchIndex()
    return true
  } catch (e) {
    if (initiator) error.value = `搜索索引加载失败：${e instanceof Error ? e.message : String(e)}`
    return false
  } finally {
    if (initiator) loading.value = false
  }
}

async function run() {
  const mySeq = ++seq
  const q = query.value.trim()
  if (!q) {
    groups.value = []
    close()
    return
  }
  const ok = await ensureIndex()
  if (mySeq !== seq) return
  if (!ok) return
  try {
    const result = await search(q, { fulltext: fulltext.value })
    if (mySeq !== seq) return
    groups.value = result
    open.value = true
    activeIndex.value = flatItems.value.length ? 0 : -1
  } catch (e) {
    if (mySeq !== seq) return
    groups.value = []
    error.value = `搜索失败：${e instanceof Error ? e.message : String(e)}`
  }
}

function onInput() {
  clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(run, 200)
}

function toggleFulltext() {
  fulltext.value = !fulltext.value
  void run()
}

function go(item: FlatItem | undefined) {
  if (!item) return
  close()
  if (item.type === 'note') {
    if (!item.slug) return
    void router.push(`/v/${item.board}/${encodeURIComponent(item.slug)}`)
  } else {
    const base = `/${item.board}?q=${encodeURIComponent(query.value.trim())}`
    void router.push(fulltext.value ? `${base}&fulltext=1` : base)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!open.value || flatItems.value.length === 0) void run()
    else activeIndex.value = Math.min(activeIndex.value + 1, flatItems.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIndex.value >= 0) go(flatItems.value[activeIndex.value])
    else go(flatItems.value[0])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

watch(activeIndex, async (idx) => {
  if (idx < 0) return
  await nextTick()
  ;(listEl.value?.querySelector('.drop-item.active') as HTMLElement | undefined)?.scrollIntoView({
    block: 'nearest',
  })
})

function onDocumentClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) close()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  if (props.autofocus) inputEl.value?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  clearTimeout(debounceTimer)
})
</script>

<template>
  <div ref="rootEl" class="search-panel">
    <div class="search">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
      </svg>
      <input
        ref="inputEl"
        v-model="query"
        class="search-input"
        type="text"
        placeholder="搜索词汇、短语、长难句、语法……"
        aria-label="全局搜索"
        @input="onInput"
        @focus="ensureIndex"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="chip"
        :class="{ active: fulltext }"
        :aria-pressed="fulltext"
        @click="toggleFulltext"
      >
        全文
      </button>
    </div>

    <p v-if="error" class="search-error">{{ error }}</p>

    <ul v-if="open && hasQuery" ref="listEl" class="search-drop">
      <li v-if="groups.length === 0 && !loading" class="drop-empty">
        未找到匹配「{{ query.trim() }}」的词条
      </li>

      <template v-for="g in groups" :key="g.board">
        <li
          class="drop-group-header drop-item"
          :class="{ active: indexOfKey(`all-${g.board}`) === activeIndex }"
          @mouseenter="activeIndex = indexOfKey(`all-${g.board}`)"
          @mousedown.prevent
          @click="go({ key: `all-${g.board}`, type: 'all', board: g.board })"
        >
          <span class="group-label">{{ g.label }}</span>
          <span class="group-total">{{ g.total }} 条</span>
          <span class="group-more">查看全部</span>
        </li>
        <li
          v-for="n in g.notes"
          :key="`${n.board}/${n.slug}`"
          class="drop-item"
          :class="{ active: indexOfKey(`${n.board}/${n.slug}`) === activeIndex }"
          @mouseenter="activeIndex = indexOfKey(`${n.board}/${n.slug}`)"
          @mousedown.prevent
          @click="go({ key: `${n.board}/${n.slug}`, type: 'note', board: n.board, slug: n.slug })"
        >
          <span class="item-title">{{ n.title }}</span>
          <span v-if="n.ipa" class="item-ipa">{{ n.ipa }}</span>
        </li>
      </template>
    </ul>
  </div>
</template>

<style scoped>
.search-panel {
  position: relative;
  max-width: 560px;
}

.search {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: var(--color-text-secondary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 14px 76px 14px 44px;
  font-size: 1rem;
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.search-input::placeholder {
  color: var(--color-text-secondary);
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.chip {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  padding: 3px 10px;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.chip:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.chip.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.search-error {
  margin: var(--space-2) 0 0;
  max-width: 560px;
  font-size: 0.85rem;
  color: var(--color-danger);
}

.search-drop {
  position: absolute;
  left: 0;
  right: 0;
  z-index: var(--z-drop);
  max-height: 420px;
  overflow-y: auto;
  margin: var(--space-2) 0 0;
  padding: var(--space-2);
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.drop-group-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-1);
}

.group-label {
  font-weight: 600;
  font-size: 0.85rem;
}

.group-total {
  color: var(--color-text-secondary);
  font-size: 0.78rem;
}

.group-more {
  margin-left: auto;
  font-size: 0.82rem;
  color: var(--color-accent);
  text-decoration: none;
}

.group-more:hover {
  text-decoration: underline;
}

.drop-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.drop-item.active {
  background: var(--color-accent-soft);
}

.item-title {
  font-size: 0.93rem;
  font-weight: 500;
}

.item-ipa {
  color: var(--color-text-secondary);
  font-family: var(--font-ipa);
  font-style: italic;
  font-size: 0.82rem;
}

.drop-empty {
  padding: var(--space-4) var(--space-3);
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  text-align: center;
}

@media (max-width: 767px) {
  .search-panel {
    max-width: none;
  }

  .search-error {
    max-width: none;
  }

  .search-input {
    padding: 12px 72px 12px 40px;
    font-size: 0.98rem;
  }

  .search-icon {
    left: 12px;
  }
}
</style>
