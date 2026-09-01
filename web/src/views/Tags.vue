<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { aggregateTags, type TagCount } from '../lib/search'
import { api } from '../api'
import { tagRegistryRef, getTagRegistry, applyTagRegistry } from '../lib/tagRegistry'
import { tagColorIndex } from '../lib/tagColor'
import EmptyState from '../components/EmptyState.vue'
import TagPalette from '../components/TagPalette.vue'

const tags = ref<TagCount[]>([])
const loading = ref(true)
const error = ref('')

/** 注册表响应式镜像（main.ts 预载；此处再次调用兜底预载失败后的重试，缓存命中零成本） */
const registry = computed(() => tagRegistryRef.value)

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

/** 云标签 = union(笔记聚合, 注册表)：聚合 count 优先，注册表独有标签补 count=0
 *（「未使用」标记），沿用 count 降序、同数标签升序（0 自然沉底） */
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

const registryNames = computed(() => Object.keys(registry.value).sort((a, b) => a.localeCompare(b)))

/** 字号按词条数在 0.85–1.5rem 间线性加权（下限 1：注册表 count=0 引入零计数域，防除零） */
const maxCount = computed(() => {
  const counts = tags.value.map((t) => t.count)
  return Math.max(...counts, 1)
})

function fontSize(count: number): string {
  const ratio = Math.max(0, count) / maxCount.value
  return `${(0.85 + ratio * 0.65).toFixed(2)}rem`
}

// ---------- ① 新增 / 改色区块（upsert 语义，无 409 分支） ----------

const newName = ref('')
const newColor = ref(0)
const creating = ref(false)
const feedback = ref<{ ok: boolean; text: string } | null>(null)

async function submitCreate(): Promise<void> {
  if (creating.value) return
  const tag = newName.value.trim()
  feedback.value = null
  // 非法输入前端先拦（与服务端校验同规则）；>32 不设 maxlength 硬截断，保留内联报错
  if (!tag) {
    feedback.value = { ok: false, text: '标签名不能为空白' }
    return
  }
  if (tag.length > 32) {
    feedback.value = { ok: false, text: '标签名不能超过 32 字符' }
    return
  }
  creating.value = true
  try {
    // 存在性判定在 POST 前对 union 取：笔记携带或注册表已有 = 「已存在，已更新颜色」
    const existed = unionTags.value.some((t) => t.tag === tag)
    const reg = await api.upsertTag(tag, newColor.value)
    applyTagRegistry(reg)
    feedback.value = {
      ok: true,
      text: existed ? `「${tag}」已存在，已更新颜色` : `已创建标签「${tag}」`,
    }
    newName.value = ''
  } catch (e) {
    feedback.value = { ok: false, text: `提交失败：${e instanceof Error ? e.message : String(e)}` }
  } finally {
    creating.value = false
  }
}

// ---------- ③ 自定义颜色行（常显色板，点色即 POST，无展开/收起步骤） ----------

const recoloring = ref(false)
const recolorErrorFor = ref<string | null>(null)
const recolorError = ref('')

/** 注册表标签当前词条数（0 = 未使用），用于行内元信息与云标签呼应 */
function countOf(name: string): number {
  return unionTags.value.find((t) => t.tag === name)?.count ?? 0
}

async function recolor(name: string, color: number): Promise<void> {
  if (recoloring.value) return
  recoloring.value = true
  recolorErrorFor.value = null
  recolorError.value = ''
  try {
    const reg = await api.upsertTag(name, color)
    applyTagRegistry(reg)
  } catch (e) {
    recolorErrorFor.value = name
    recolorError.value = `改色失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    recoloring.value = false
  }
}
</script>

<template>
  <div class="tags-page">
    <header class="page-header">
      <h1 class="page-title">标签</h1>
      <p class="page-meta">{{ unionTags.length }} 个标签</p>
    </header>

    <!-- ① 新增 / 指定颜色区块（v1.1）：upsert——新名称即创建，已有名称则更新颜色 -->
    <section class="create-block" aria-label="创建或改色标签">
      <div class="create-row">
        <input
          v-model="newName"
          class="create-input"
          type="text"
          placeholder="标签名（不超过 32 字符）"
          aria-label="标签名"
          @keydown.enter="submitCreate"
        />
        <TagPalette :model-value="newColor" @select="newColor = $event" />
        <button type="button" class="submit-btn" :disabled="creating" @click="submitCreate">
          创建标签
        </button>
      </div>
      <p class="create-hint">新名称将创建标签并应用所选颜色；输入已有名称则把该标签更新为所选颜色。</p>
      <p v-if="feedback" class="feedback" :class="feedback.ok ? 'is-ok' : 'is-error'" role="status">
        {{ feedback.text }}
      </p>
    </section>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>
    <template v-else>
      <!-- ② 云标签 = union(笔记聚合, 注册表)；count=0 挂「未使用」标记 -->
      <div v-if="unionTags.length" class="tag-cloud">
        <RouterLink
          v-for="t in unionTags"
          :key="t.tag"
          :to="`/tags/${encodeURIComponent(t.tag)}`"
          class="cloud-tag"
          :class="`tag-pair-${tagColorIndex(t.tag)}`"
          :style="{ fontSize: fontSize(t.count) }"
          :title="t.count === 0 ? '注册表标签，尚未用于任何词条' : `${t.count} 条词条`"
        >
          {{ t.tag }}
          <span v-if="t.count === 0" class="cloud-unused">未使用</span>
          <span v-else class="cloud-count">{{ t.count }}</span>
        </RouterLink>
      </div>
      <EmptyState
        v-else
        title="暂无标签"
        description="给词条加上标签，或在上方直接创建标签。"
      />
    </template>

    <!-- ③ 自定义颜色：常显色板行，点色即改（详情页 /tags/:tag 亦提供同款取色行） -->
    <section v-if="!loading && !error && unionTags.length" class="registry-manage" aria-label="自定义颜色标签">
      <h2 class="section-title">自定义颜色</h2>
      <p class="section-hint">点击色块立即改色；颜色即时生效并跨设备持久化。</p>
      <div v-if="registryNames.length" class="registry-list">
        <div v-for="name in registryNames" :key="name" class="color-row">
          <span
            class="row-chip"
            :class="`tag-pair-${registry[name].color}`"
            :title="countOf(name) === 0 ? '注册表标签，尚未用于任何词条' : `${countOf(name)} 条词条`"
          >
            {{ name }}
            <span v-if="countOf(name) === 0" class="row-unused">未使用</span>
            <span v-else class="row-count">{{ countOf(name) }}</span>
          </span>
          <TagPalette :model-value="registry[name].color" @select="recolor(name, $event)" />
          <span v-if="recolorErrorFor === name" class="row-error" role="alert">{{ recolorError }}</span>
        </div>
      </div>
      <p v-else class="section-empty">
        尚无自定义颜色的标签——在上方为标签命名并选色后，可在此随时调整。
      </p>
    </section>
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

/* ① 新增 / 改色区块：卡片容器，行内排布（移动端换行） */
.create-block {
  padding: var(--space-4);
  margin-bottom: var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.create-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.create-input {
  flex: 1;
  min-width: 200px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-base);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.create-input::placeholder {
  color: var(--color-text-secondary);
}

.create-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

/* 提交按钮沿用 .empty-clear 同族语言：描边，hover 反转为实底 */
.submit-btn {
  padding: var(--space-2) var(--space-4);
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

.submit-btn:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.create-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.feedback {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
}

.feedback.is-ok {
  color: var(--color-accent);
}

.feedback.is-error {
  color: var(--color-danger);
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
}

/* 底色/文字色由 tokens.css 的 .tag-pair-N 提供（注册表优先，hash 回落，与 TagBadge 同源） */
.cloud-tag {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 2px 12px;
  border-radius: var(--radius-full);
  line-height: 1.8;
  text-decoration: none;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

/* hover 与 TagBadge 同策略：叠加 --tag-hover-overlay 强化，不动文字色 */
.cloud-tag:hover {
  background-image: linear-gradient(var(--tag-hover-overlay), var(--tag-hover-overlay));
}

.cloud-count {
  font-size: 0.7em;
  opacity: 0.7;
}

/* 注册表独有标签（count=0）的视觉标记：描边小徽标，继承当前标签色 */
.cloud-unused {
  font-size: 0.7em;
  padding: 0 6px;
  border: 1px solid currentColor;
  border-radius: var(--radius-full);
  opacity: 0.75;
  line-height: 1.5;
}

/* ③ 注册表标签改色区块 */
.registry-manage {
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-border);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0 0 var(--space-1);
}

.section-hint {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  margin: 0 0 var(--space-4);
}

.registry-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 常显色板行：chip（当前色）+ 色板同行铺开，点色即改，无展开/收起步骤 */
.color-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}

/* 行首 chip：底色/文字色由 .tag-pair-N 提供，scoped 不设 background/color */
.row-chip {
  padding: 3px 14px;
  font-size: var(--text-sm);
  border-radius: var(--radius-full);
  min-width: 88px;
  text-align: center;
}

.row-count {
  font-size: 0.7em;
  opacity: 0.7;
  margin-left: 4px;
}

.row-unused {
  font-size: 0.7em;
  padding: 0 6px;
  margin-left: 4px;
  border: 1px solid currentColor;
  border-radius: var(--radius-full);
  opacity: 0.75;
}

.row-error {
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.section-empty {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}

@media (max-width: 767px) {
  .page-header {
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }
}

/* 按压反馈（§6）：新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .submit-btn:active {
    transform: scale(0.98);
  }
}
</style>
