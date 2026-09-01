<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { aggregateTags, type TagCount } from '../lib/search'
import { api } from '../api'
import { tagRegistryRef, getTagRegistry, applyTagRegistry } from '../lib/tagRegistry'
import { tagColorIndex } from '../lib/tagColor'
import EmptyState from '../components/EmptyState.vue'
import TagPalette from '../components/TagPalette.vue'
import { useStaggerArm, STAGGER_CAP } from '../lib/stagger'

/**
 * 标签页 = 色卡墙（v1.1 体验迭代第 2 轮，方案 A·全染）：
 * 云标签与自定义颜色区合并为一张画布——每张全染色卡承担颜色身份（tag-pair 洗底）、
 * 浏览导航（整卡 stretched-link 进详情）与改色（卡内常显色板）三职；末尾虚线
 * 幽灵卡承担创建（点击原位展开表单，upsert 语义不变）。
 */

const tags = ref<TagCount[]>([])
const loading = ref(true)
const error = ref('')

/** 注册表响应式镜像（main.ts 预载；此处再次调用兜底预载失败后的重试，缓存命中零成本） */
const registry = computed(() => tagRegistryRef.value)

const staggerArm = useStaggerArm(loading)

onMounted(async () => {
  void getTagRegistry().catch(() => {})
  try {
    tags.value = await aggregateTags()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

/** 色卡墙数据 = union(笔记聚合, 注册表)：聚合 count 优先，注册表独有补 count=0，
 * 沿用 count 降序、同数标签升序 */
const unionTags = computed<TagCount[]>(() => {
  const merged = new Map<string, number>()
  for (const t of tags.value) merged.set(t.tag, t.count)
  for (const name of Object.keys(registry.value)) {
    if (!merged.has(name)) merged.set(name, 0)
  }
  return [...merged.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
})

// ---------- 页面级筛选与排序（作用于色卡墙） ----------

const filter = ref('')

/** 排序：常用（count 降序+名称）/ 名称 / 自定义优先（同组内按常用序）；偏好 localStorage 记忆（密度同款守卫） */
type SortMode = 'used' | 'name' | 'custom'
const sort = ref<SortMode>('used')
try {
  const saved = localStorage.getItem('en_tool:tag-sort')
  if (saved === 'used' || saved === 'name' || saved === 'custom') sort.value = saved
} catch {
  /* 存储不可用（隐私模式等）时用默认常用序 */
}

function setSort(mode: SortMode): void {
  sort.value = mode
  try {
    localStorage.setItem('en_tool:tag-sort', mode)
  } catch {
    /* 同上 */
  }
}

const sortedTags = computed<TagCount[]>(() => {
  const base = (a: TagCount, b: TagCount) => b.count - a.count || a.tag.localeCompare(b.tag)
  const list = [...unionTags.value]
  if (sort.value === 'name') return list.sort((a, b) => a.tag.localeCompare(b.tag))
  if (sort.value === 'custom') {
    return list.sort((a, b) => {
      const ca = a.tag in registry.value ? 1 : 0
      const cb = b.tag in registry.value ? 1 : 0
      return cb - ca || base(a, b)
    })
  }
  return list.sort(base)
})

const filtered = computed<TagCount[]>(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return sortedTags.value
  return sortedTags.value.filter((t) => t.tag.toLowerCase().includes(q))
})

const isCustom = (tag: string) => tag in registry.value
const colorIndex = (tag: string) => tagColorIndex(tag)

// ---------- 入场 stagger（同 NoteList 配方：cap 前携带递增内联 delay，祖先 stagger-arm 门控） ----------

const play = (i: number) => i < STAGGER_CAP
const delay = (i: number) => ({ animationDelay: `calc(var(--stagger-step) * ${i})` })

// ---------- 卡内点色即改 ----------

const recoloring = ref(false)
const recolorError = ref('')

async function recolor(tag: string, color: number): Promise<void> {
  if (recoloring.value) return
  recoloring.value = true
  recolorError.value = ''
  try {
    const reg = await api.upsertTag(tag, color)
    applyTagRegistry(reg)
  } catch (e) {
    recolorError.value = `「${tag}」改色失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    recoloring.value = false
  }
}

// ---------- 幽灵卡：创建标签（upsert——已有名称则更新其颜色） ----------

const formOpen = ref(false)
const pending = ref(false)
const newName = ref('')
const newColor = ref(0)
const formFeedback = ref<{ ok: boolean; text: string } | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

async function openCreate(): Promise<void> {
  formOpen.value = true
  await nextTick()
  nameInput.value?.focus()
}

function closeCreate(): void {
  formOpen.value = false
  newName.value = ''
  newColor.value = 0
  formFeedback.value = null
}

async function submitCreate(): Promise<void> {
  if (pending.value) return
  const tag = newName.value.trim()
  formFeedback.value = null
  // 非法输入前端先拦（与服务端校验同规则）；>32 不设 maxlength 硬截断，保留内联报错
  if (!tag) {
    formFeedback.value = { ok: false, text: '标签名不能为空白' }
    return
  }
  if (tag.length > 32) {
    formFeedback.value = { ok: false, text: '标签名不能超过 32 字符' }
    return
  }
  pending.value = true
  try {
    const reg = await api.upsertTag(tag, newColor.value)
    applyTagRegistry(reg)
    // 成功反馈 = 墙内新卡出现 / 既有卡即时换色；清筛选保证新卡可见
    filter.value = ''
    closeCreate()
  } catch (e) {
    formFeedback.value = {
      ok: false,
      text: `提交失败：${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="tags-page">
    <header class="page-header">
      <div class="page-titles">
        <h1 class="page-title">标签</h1>
        <p class="page-meta">{{ unionTags.length }} 个标签</p>
      </div>
      <div class="header-tools">
        <div class="seg" role="group" aria-label="排序方式">
          <button
            v-for="m in ([['custom', '自定义'], ['name', '名称'], ['used', '常用']] as const)"
            :key="m[0]"
            type="button"
            class="sort-chip"
            :class="{ active: sort === m[0] }"
            :aria-pressed="sort === m[0]"
            @click="setSort(m[0])"
          >
            {{ m[1] }}
          </button>
        </div>
        <input
          v-model="filter"
          class="wall-search"
          type="text"
          placeholder="筛选标签…"
          aria-label="筛选标签"
        />
      </div>
    </header>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <template v-else>
      <EmptyState
        v-if="unionTags.length === 0"
        title="暂无标签"
        description="给词条加上标签，或点击下方「＋ 新建标签」直接创建。"
      />

      <!-- 色卡墙：union 全量标签。整卡 stretched-link 进详情，卡内色板点色即改 -->
      <div
        v-if="unionTags.length || formOpen"
        class="card-wall"
        :class="{ 'stagger-arm': staggerArm }"
      >
        <p v-if="filtered.length === 0" class="no-match">
          没有匹配「{{ filter.trim() }}」的标签
        </p>

        <article
          v-for="(t, i) in filtered"
          :key="t.tag"
          class="tag-card"
          :class="[`tag-pair-${colorIndex(t.tag)}`, { 'card-in': play(i) }]"
          :style="play(i) ? delay(i) : undefined"
        >
          <div class="card-head">
            <h3 class="card-name">
              <RouterLink :to="`/tags/${encodeURIComponent(t.tag)}`" class="card-link">
                {{ t.tag }}
              </RouterLink>
            </h3>
            <p class="card-meta">
              <span v-if="t.count === 0" class="card-badge">未使用</span>
              <span v-else class="card-count">{{ t.count }} 条</span>
              <span
                v-if="!isCustom(t.tag)"
                class="card-badge"
                title="颜色由系统自动分配，点下方色块可自定义"
              >
                自动
              </span>
            </p>
          </div>
          <TagPalette
            class="card-palette"
            :model-value="colorIndex(t.tag)"
            size="sm"
            pulse
            @select="recolor(t.tag, $event)"
          />
        </article>

        <!-- 幽灵新建卡：默认虚线占位，点击原位展开表单 -->
        <article v-if="!formOpen" class="ghost-card">
          <button type="button" class="ghost-btn" @click="openCreate">＋ 新建标签</button>
        </article>
        <article v-else class="ghost-card is-form">
          <input
            ref="nameInput"
            v-model="newName"
            class="ghost-input"
            type="text"
            placeholder="标签名（不超过 32 字符）"
            aria-label="标签名"
            @keydown.enter="submitCreate"
            @keydown.esc.prevent="closeCreate"
          />
          <TagPalette :model-value="newColor" size="sm" @select="newColor = $event" />
          <p class="ghost-hint">新名称将创建标签；输入已有名称则把该标签更新为所选颜色。</p>
          <p v-if="formFeedback" class="ghost-feedback" :class="formFeedback.ok ? 'is-ok' : 'is-error'" role="status">
            {{ formFeedback.text }}
          </p>
          <div class="ghost-actions">
            <button type="button" class="ghost-cancel" @click="closeCreate">取消</button>
            <button type="button" class="ghost-submit" :disabled="pending" @click="submitCreate">
              创建标签
            </button>
          </div>
        </article>
      </div>

      <p v-if="recolorError" class="error" role="alert">{{ recolorError }}</p>
    </template>
  </div>
</template>

<style scoped>
.tags-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.page-titles {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.header-tools {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
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

/* 排序切换（Board .seg 同族视觉）：灰底轨道 + 活动段浮起 */
.seg {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--color-surface-2);
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.sort-chip {
  padding: 4px 12px;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.sort-chip:hover {
  color: var(--color-text);
}

.sort-chip.active {
  color: var(--color-accent);
  background: var(--color-surface);
  border-color: var(--color-border);
  box-shadow: var(--shadow-sm);
}

.wall-search {
  width: 100%;
  max-width: 220px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.wall-search::placeholder {
  color: var(--color-text-secondary);
}

.wall-search:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.card-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(212px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}

/* 全染色卡：底色/文字色来自 tokens.css 的 .tag-pair-N 全局应用类（scoped 不设
   background/color，特异性会压过全局类）；文字色经继承覆盖卡内全部子元素 */
.tag-card {
  --swatch-ring-gap: transparent; /* 选中环缺口透出卡体洗底而非页面底色 */
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

/* hover 与 TagBadge 同策略：叠加 --tag-hover-overlay 强化洗底 + 轻浮起 */
.tag-card:hover {
  transform: translateY(-1px);
  background-image: linear-gradient(var(--tag-hover-overlay), var(--tag-hover-overlay));
}

/* 两段式卡面：信息行（名称左·元信息右）+ 控制区（托盘色板） */
.card-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.card-name {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  overflow-wrap: anywhere;
  flex: 1;
  min-width: 0;
}

/* 整卡可点（NoteList stretched-link 同配方）：名称链接伪元素铺满整卡，
   色板按钮定位提升保持浮在拉伸层之上（DOM 在后 + z 抬升） */
.card-link {
  color: inherit;
  text-decoration: none;
}

.card-link::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--radius-md);
}

.card-link:focus-visible {
  outline: none;
}

.card-link:focus-visible::after {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.card-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  font-size: var(--text-xs);
}

.card-count {
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}

.card-badge {
  padding: 0 8px;
  border: 1px solid currentColor;
  border-radius: var(--radius-full);
  opacity: 0.8;
  line-height: 1.6;
}

/* 控制区托盘：surface 底胶囊让色点脱离卡体洗底（对比根除模糊），点距均分铺满 */
.card-palette {
  position: relative;
  z-index: var(--z-rail);
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  background: var(--color-surface);
  border-radius: var(--radius-full);
}

/* 幽灵新建卡：虚线占位 → 点击原位展开表单 */
.ghost-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: 104px;
  padding: var(--space-4);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-out);
}

.ghost-card:hover {
  border-color: var(--color-accent);
}

.ghost-btn {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}

.ghost-card:hover .ghost-btn {
  color: var(--color-accent);
}

.ghost-card.is-form {
  align-items: stretch;
  background: var(--color-surface);
  border-style: solid;
}

.ghost-input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.ghost-input::placeholder {
  color: var(--color-text-secondary);
}

.ghost-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.ghost-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.ghost-feedback {
  margin: 0;
  font-size: var(--text-xs);
}

.ghost-feedback.is-ok {
  color: var(--color-accent);
}

.ghost-feedback.is-error {
  color: var(--color-danger);
}

.ghost-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.ghost-cancel {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}

.ghost-cancel:hover {
  color: var(--color-text);
}

/* 提交按钮沿用描边反转语言（.empty-clear/.submit-btn 同族） */
.ghost-submit {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.ghost-submit:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.ghost-submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.no-match {
  grid-column: 1 / -1;
  margin: 0;
  padding: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  text-align: center;
}

@media (max-width: 767px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .header-tools {
    flex-wrap: wrap;
  }

  .wall-search {
    flex: 1;
    min-width: 140px;
    max-width: none;
  }
}

/* 按压反馈与入场 stagger（§6）：新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .ghost-btn:active,
  .ghost-submit:active,
  .ghost-cancel:active {
    transform: scale(0.98);
  }

  .stagger-arm .card-in {
    animation: card-in var(--duration-slow) var(--ease-out) backwards;
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
}
</style>
