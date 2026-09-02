<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { aggregateTags, type TagCount } from '../lib/search'
import { tagRegistryRef, getTagRegistry, upsertTag } from '../lib/tagRegistry'
import { tagColorIndex } from '../lib/tagColor'
import EmptyState from '../components/EmptyState.vue'
import TagPalette from '../components/TagPalette.vue'
import { useStaggerArm, STAGGER_CAP } from '../lib/stagger'

/**
 * 标签页 = 色卡墙（v1.1 体验迭代第 2–5 轮；第 5 轮按用户决定回退至方案 A 原全染设计）：
 * union 全量标签一卡一位——卡体 .tag-pair-N 全染洗底（文字色经继承），整卡 stretched-link
 * 进详情，卡内色板点色即改（pulse 脉冲）；末尾虚线幽灵卡承担创建（upsert 语义不变）。
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

/** 排序：常用（count 降序+名称）/ 名称；偏好 localStorage 记忆（密度同款守卫） */
type SortMode = 'used' | 'name'
const sort = ref<SortMode>('used')
try {
  const saved = localStorage.getItem('en_tool:tag-sort')
  if (saved === 'used' || saved === 'name') sort.value = saved
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
  const list = [...unionTags.value]
  if (sort.value === 'name') return list.sort((a, b) => a.tag.localeCompare(b.tag))
  return list.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
})

const filtered = computed<TagCount[]>(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return sortedTags.value
  return sortedTags.value.filter((t) => t.tag.toLowerCase().includes(q))
})

const colorIndex = (tag: string) => tagColorIndex(tag)

// ---------- 入场 stagger（同 NoteList 配方：cap 前携带递增内联 delay，祖先 stagger-arm 门控） ----------

const play = (i: number) => i < STAGGER_CAP

/** 卡内联注入 --card-hue/--card-wash（该卡文字色/洗底），供 tokens.css 的 --card-sheen
 * 渐层按卡取色；stagger delay 一并注入 */
function cardStyle(tag: string, i: number): Record<string, string> {
  const style: Record<string, string> = {
    '--card-hue': `var(--tag-${colorIndex(tag)}-c)`,
    '--card-wash': `var(--tag-${colorIndex(tag)}-bg)`,
  }
  if (play(i)) style.animationDelay = `calc(var(--stagger-step) * ${i})`
  return style
}

// ---------- 卡内点色即改（B6：per-tag 锁——跨卡可并发，序列号守卫在 lib 层兜底乱序） ----------

const pendingTags = ref<string[]>([])
const recolorError = ref('')

async function recolor(tag: string, color: number): Promise<void> {
  if (pendingTags.value.includes(tag)) return
  pendingTags.value = [...pendingTags.value, tag]
  recolorError.value = ''
  try {
    await upsertTag(tag, color)
  } catch (e) {
    recolorError.value = `「${tag}」改色失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    pendingTags.value = pendingTags.value.filter((t) => t !== tag)
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
    // 成功反馈 = 墙内新卡出现 / 既有卡即时换色；清筛选保证新卡可见
    await upsertTag(tag, newColor.value)
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
          <span
            class="seg-thumb"
            :class="{ 'seg-right': sort === 'used' }"
            aria-hidden="true"
          ></span>
          <button
            v-for="m in ([['name', '名称'], ['used', '常用']] as const)"
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
          :style="cardStyle(t.tag, i)"
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

/* 排序切换（Board .seg 同族视觉）：灰底轨道 + 白底滑块（等宽双格 + translateX 滑动） */
.seg {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: stretch;
  padding: 3px;
  background: var(--color-surface-2);
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.seg-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
}

.seg-thumb.seg-right {
  transform: translateX(100%);
}

.sort-chip {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 4px 12px;
  font-size: var(--text-xs);
  font-family: inherit;
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}

.sort-chip:hover {
  color: var(--color-text);
}

/* 活动段的白底/边框/阴影由滑块层承担，文字保持 accent */
.sort-chip.active {
  color: var(--color-accent);
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

/* 滑块滑动（UX 打磨）：回弹曲线，reduced-motion 直跳不动画 */
@media (prefers-reduced-motion: no-preference) {
  .seg-thumb {
    transition: transform var(--duration-slow) var(--ease-spring);
  }
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

/* 全染色卡（v1.1 迭代⑤按用户决定回退至方案 A 原设计）：底色/文字色来自 tokens.css
   的 .tag-pair-N 全局应用类（scoped 不设 background/color）；文字色经继承覆盖卡内
   全部子元素 */
.tag-card {
  --swatch-ring-gap: transparent; /* 选中脉冲环缺口透出卡体洗底 */
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  /* 渐层（迭代⑦）：--card-sheen 由 tokens.css 按主题定义，端点色经内联
     --card-hue/--card-wash 随卡取色；只叠 background-image，不碰全局洗底 background-color */
  background-image: var(--card-sheen);
  transition: transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

/* hover 与 TagBadge 同策略：叠加 --tag-hover-overlay 强化洗底 + 轻浮起 */
/* hover 强化层：::before 叠加 --tag-hover-overlay——若直接改 background-image 会
   整体替换 --card-sheen 渐层，故独立为透明度过渡的覆盖层（pointer-events 穿透） */
.tag-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--radius-md);
  background: var(--tag-hover-overlay);
  opacity: 0;
  transition: opacity var(--duration-fast) var(--ease-out);
  pointer-events: none;
}

.tag-card:hover {
  transform: translateY(-1px);
}

.tag-card:hover::before {
  opacity: 1;
}

/* 两段式卡头（迭代⑥恢复③排布）：名称左·元信息右 */
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

/* 色板行：迷你胶囊 2×4 网格直接躺在卡面上（无托盘），pulse 选中环缺口透出卡体底色 */
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

/* 色板行：色点直接排布于洗底（v1.1 迭代⑤回退方案 A 原设计），pulse 选中环缺口透出洗底 */
/* 控制区白托盘（迭代③形态）：surface 胶囊让色点脱离卡体洗底，点距均分铺满 */
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

/* 幽灵新建卡：虚线占位 → 点击原位展开表单；不设 min-height——Grid 行内默认
   拉伸使其与同行标签卡等高（设了会撑高所在行，行高不一致） */
.ghost-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  /* 与标签卡自然高度（卡头+托盘，81px）对齐：单独成行时不矮于其他行；
     同行有标签卡时 Grid 拉伸本已等高。卡面结构变更时需同步此值 */
  min-height: 81px;
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
