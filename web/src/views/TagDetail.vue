<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NoteList from '../components/NoteList.vue'
import TagPalette from '../components/TagPalette.vue'
import { BOARD_LABELS, BOARD_ORDER, getSearchIndex } from '../lib/search'
import { tagRegistryRef, upsertTag, renameTag, deleteTag } from '../lib/tagRegistry'
import { tagColorIndex } from '../lib/tagColor'
import type { NoteDetail } from '../api'
import { useStaggerArm } from '../lib/stagger'

const route = useRoute()
const router = useRouter()

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

// ---------- 自定义颜色（v1.1 体验迭代）：注册表优先、djb2 回落，点色即改 ----------

const currentColor = computed(() => tagColorIndex(tag.value))

const recoloring = ref(false)
const recolorError = ref('')

async function recolor(color: number): Promise<void> {
  if (recoloring.value) return
  recoloring.value = true
  recolorError.value = ''
  try {
    await upsertTag(tag.value, color)
  } catch (e) {
    recolorError.value = `改色失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    recoloring.value = false
  }
}

// ---------- 标签管理（v1.1 T2）：重命名 / 深度删除，内联展开面板，影响面三段式 ----------
// 影响面 = 本页词条清单（groups 即跨板块持有者），面板内再次明示数量与逐条清单；
// 禁用 window.confirm（IAB 假死根因），确认一律内联两段式。

const panel = ref<'none' | 'rename' | 'delete'>('none')

/** 影响面扁平清单（删除面板逐条呈现；App.vue 路由 key=route.path 保证换标签整页重挂载，
 * 数据恒与本页标签一致，无 stale 窗口） */
const impact = computed(() =>
  groups.value.flatMap((g) =>
    g.notes.map((n) => ({ board: n.board, label: g.label, slug: n.slug, title: n.title })),
  ),
)

const indexLoaded = computed(() => !loading.value && !error.value)

function togglePanel(which: 'rename' | 'delete'): void {
  if (panel.value === which) {
    panel.value = 'none'
    return
  }
  panel.value = which
  renameError.value = ''
  deleteError.value = ''
  if (which === 'rename') {
    newName.value = tag.value
    void nextTick(() => renameInput.value?.focus())
  }
}

function closePanel(): void {
  panel.value = 'none'
  renameError.value = ''
  deleteError.value = ''
}

// —— 重命名：注册表键 + 携带词条同步改名 ——

const renameInput = ref<HTMLInputElement | null>(null)
const newName = ref('')
const renamePending = ref(false)
const renameError = ref('')

const renameHint = computed(() =>
  impact.value.length > 0
    ? `将同步更新 ${impact.value.length} 个携带词条的 frontmatter，并把注册表条目一并改名（清单见下）。`
    : '该标签未被任何词条携带，将只更新注册表条目。',
)

/** 前端先拦（与服务端同规则）；服务端仍为权威校验 */
function validateNewName(raw: string): string {
  const name = raw.trim()
  if (!name) return '标签名不能为空白'
  if (name.length > 32) return '标签名不能超过 32 字符'
  if (name.normalize('NFC') === tag.value.normalize('NFC')) return '新名称与当前名称相同'
  return ''
}

async function submitRename(): Promise<void> {
  if (renamePending.value) return
  renameError.value = validateNewName(newName.value)
  if (renameError.value) return
  const name = newName.value.trim()
  // 冲突早检（NFC 归一，口径与服务端一致）：注册表已有 / 任一词条已携带
  if (tagRegistryRef.value[name.normalize('NFC')]) {
    renameError.value = `注册表中已存在标签「${name}」，合并请手工进行`
    return
  }
  if ((index.value ?? []).some((n) => n.tags.some((t) => t.normalize('NFC') === name.normalize('NFC')))) {
    renameError.value = `已有词条携带标签「${name}」，合并请手工进行`
    return
  }
  renamePending.value = true
  try {
    await renameTag(tag.value, name)
    // 换路径即整页重挂载（路由 key=route.path）：新名详情页全新拉取（注册表已在
    // lib 层应用，搜索索引已在 lib 层失效）
    void router.replace(`/tags/${encodeURIComponent(name)}`)
  } catch (e) {
    renameError.value = e instanceof Error ? e.message : String(e)
  } finally {
    renamePending.value = false
  }
}

// —— 深度删除：注册表条目 + 全部携带词条的标签项 ——

const deletePending = ref(false)
const deleteError = ref('')

async function submitDelete(): Promise<void> {
  if (deletePending.value) return
  deletePending.value = true
  deleteError.value = ''
  try {
    // warnings（部分成功）不在此强提示：词条清单/卡片计数即真实状态
    await deleteTag(tag.value)
    void router.push('/tags')
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deletePending.value = false
  }
}

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

    <!-- 设置卡（T2 收尾打磨）：取色与管理合并单卡，行间嵌线分隔（与 rename-panel 分隔线同语言）；
         索引加载失败时只保留取色行、隐藏管理行（宁缺勿错删） -->
    <section class="tag-settings" aria-label="标签设置">
      <div class="settings-row row-color">
        <span class="row-label">颜色</span>
        <TagPalette :model-value="currentColor" @select="recolor" />
        <span v-if="recolorError" class="recolor-error" role="alert">{{ recolorError }}</span>
      </div>
      <template v-if="indexLoaded">
        <div class="settings-row row-manage">
          <span class="row-label">管理</span>
          <div class="manage-actions">
            <button
              type="button"
              class="manage-btn"
              :class="{ active: panel === 'rename' }"
              :aria-expanded="panel === 'rename'"
              @click="togglePanel('rename')"
            >
              重命名
            </button>
            <button
              type="button"
              class="manage-btn is-danger"
              :class="{ active: panel === 'delete' }"
              :aria-expanded="panel === 'delete'"
              @click="togglePanel('delete')"
            >
              删除标签
            </button>
          </div>
        </div>

        <!-- 重命名面板：预填当前名，Enter 提交 / Esc 取消 -->
        <form v-if="panel === 'rename'" class="rename-panel" @submit.prevent="submitRename">
          <input
            ref="renameInput"
            v-model="newName"
            class="rename-input"
            type="text"
            placeholder="新标签名（不超过 32 字符）"
            aria-label="新标签名"
            @keydown.esc.prevent="closePanel"
          />
          <p class="panel-hint">{{ renameHint }}</p>
          <p v-if="renameError" class="panel-error" role="alert">{{ renameError }}</p>
          <div class="panel-actions">
            <button type="button" class="panel-cancel" @click="closePanel">取消</button>
            <button type="submit" class="panel-submit" :disabled="renamePending">确认执行</button>
          </div>
        </form>

        <!-- 删除面板：危险底色 + 影响面逐条清单，实底红确认 -->
        <div v-if="panel === 'delete'" class="delete-panel">
          <p class="delete-warning">
            将从 {{ impact.length }} 个词条中移除该标签，并删除注册表条目（颜色设置随之失效）。此操作不可撤销。
          </p>
          <p v-if="impact.length === 0" class="panel-hint">
            该标签未被任何词条携带，将只从注册表移除。
          </p>
          <ul v-else class="impact-list">
            <li v-for="n in impact" :key="`${n.board}/${n.slug}`" class="impact-item">
              <span class="impact-board">{{ n.label }}</span>
              <RouterLink :to="`/v/${n.board}/${encodeURIComponent(n.slug)}`" class="impact-link">
                {{ n.title }}
              </RouterLink>
            </li>
          </ul>
          <p v-if="deleteError" class="panel-error" role="alert">{{ deleteError }}</p>
          <div class="panel-actions">
            <button type="button" class="panel-cancel" @click="closePanel">取消</button>
            <button type="button" class="panel-confirm" :disabled="deletePending" @click="submitDelete">
              确认删除
            </button>
          </div>
        </div>
      </template>
    </section>

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
  margin-bottom: var(--space-4);
}

/* 设置卡（T2 收尾打磨）：取色与管理合并单卡，行间嵌线分隔——分隔线与
   rename-panel 的 border-top 同语言，全卡统一 inset 嵌线节奏 */
.tag-settings {
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-6);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.settings-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}

.settings-row + .settings-row {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.row-label {
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

/* 管理行按钮右置（原 manage-head 的两端对齐语义） */
.row-manage .manage-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.recolor-error {
  font-size: var(--text-sm);
  color: var(--color-danger);
}

/* 管理按钮常态同「编辑」描边语言；danger 变体 hover/active 走危险色 */
.manage-btn {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  line-height: 1.6;
  font-family: inherit;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.manage-btn:hover,
.manage-btn.active {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.manage-btn.is-danger:hover,
.manage-btn.is-danger.active {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.panel-hint {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.panel-error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--color-danger);
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.panel-cancel {
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

.panel-cancel:hover {
  color: var(--color-text);
}

/* 提交按钮沿用描边反转语言（.ghost-submit 同族） */
.panel-submit {
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

.panel-submit:hover {
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.panel-submit:disabled,
.panel-confirm:disabled {
  opacity: 0.6;
  cursor: default;
}

/* 重命名面板表单行 */
.rename-panel {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.rename-input {
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

.rename-input::placeholder {
  color: var(--color-text-secondary);
}

.rename-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

/* 删除面板：danger-soft 底 + 危险描边（.missing-banner 同族语言） */
.delete-panel {
  margin-top: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
}

.delete-warning {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.delete-warning + .panel-hint,
.delete-warning + .impact-list {
  margin-top: var(--space-2);
}

/* 影响面清单：板块徽标 + 词条链接（与反向引用面板同款结构语言） */
.impact-list {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.impact-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
  min-width: 0;
}

.impact-board {
  flex-shrink: 0;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
}

.impact-link {
  color: var(--color-danger);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}

.impact-link:hover {
  opacity: 0.8;
}

/* 实底红确认（NoteView .delete-btn.confirm 同族） */
.panel-confirm {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--color-on-accent);
  background: var(--color-danger);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.panel-confirm:hover {
  opacity: 0.9;
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

/* 按压反馈（§6）：新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .manage-btn:active,
  .panel-cancel:active,
  .panel-submit:active,
  .panel-confirm:active {
    transform: scale(0.98);
  }
}
</style>
