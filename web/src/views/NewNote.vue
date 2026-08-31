<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiError, api, type Board } from '../api'
import { BOARD_LABELS, BOARD_ORDER, invalidateSearchIndex } from '../lib/search'

const route = useRoute()
const router = useRouter()

const board = ref<Board>('vocab')
const title = ref('')
const slug = ref('')
const tagsInput = ref('')
const source = ref('')

const slugTouched = ref(false)
const submitting = ref(false)
const formError = ref('')
const slugError = ref('')

function isBoard(v: string): v is Board {
  return (BOARD_ORDER as string[]).includes(v)
}

onMounted(() => {
  // 支持板块页「新建」带当前板块进入（?board=xxx）
  const q = route.query.board
  if (typeof q === 'string' && isBoard(q)) board.value = q
  // 支持 wiki 缺失链接跳入预填（?slug=&title=）；slug 预填视为已手动编辑，防 title blur 时推导覆盖
  const qSlug = route.query.slug
  if (typeof qSlug === 'string' && qSlug.trim()) {
    slug.value = qSlug
    slugTouched.value = true
  }
  const qTitle = route.query.title
  if (typeof qTitle === 'string' && qTitle.trim()) title.value = qTitle
})

/** slug 由 title 推导：英文小写化，保留字母数字与中文，其余折叠为连字符 */
function deriveSlug(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

function onTitleBlur() {
  if (!slugTouched.value) slug.value = deriveSlug(title.value)
}

async function submit() {
  formError.value = ''
  slugError.value = ''
  const t = title.value.trim()
  if (!t) {
    formError.value = '请填写标题'
    return
  }
  const s = slug.value.trim() || deriveSlug(t)
  if (!s) {
    formError.value = '无法从标题推导 slug，请手动填写一个'
    return
  }
  slug.value = s
  const tags = tagsInput.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean)
  submitting.value = true
  try {
    await api.createNote({
      board: board.value,
      slug: s,
      title: t,
      tags,
      source: source.value.trim() || undefined,
    })
    // 写盘成功，使前端搜索/标签缓存失效（/tags、搜索立即可见新词条）
    invalidateSearchIndex()
    // 生成骨架后进入编辑页
    void router.push(`/v/${board.value}/${encodeURIComponent(s)}/edit`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (e instanceof ApiError && e.status === 409) {
      // slug 冲突：停在表单提示改 slug
      slugError.value = msg
    } else {
      formError.value = msg
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="new-note-page">
    <header class="page-header">
      <h1 class="page-title">新建词条</h1>
      <p class="page-desc">选好板块、填上标题即可生成骨架进入编辑；正文完全自由，随时可改。</p>
    </header>

    <form class="form-card" @submit.prevent="submit">
      <div class="form-row">
        <label class="form-label" for="new-board">板块</label>
        <select id="new-board" v-model="board" class="form-input">
          <option v-for="b in BOARD_ORDER" :key="b" :value="b">{{ BOARD_LABELS[b] }}</option>
        </select>
      </div>

      <div class="form-row">
        <label class="form-label" for="new-title">标题</label>
        <input
          id="new-title"
          v-model="title"
          class="form-input"
          type="text"
          placeholder="如：abandon / 非谓语动词"
          autocomplete="off"
          @blur="onTitleBlur"
        />
      </div>

      <div class="form-row">
        <label class="form-label" for="new-slug">slug</label>
        <input
          id="new-slug"
          v-model="slug"
          class="form-input"
          :class="{ invalid: slugError }"
          type="text"
          placeholder="留空则由标题自动生成"
          autocomplete="off"
          spellcheck="false"
          @input="slugTouched = true"
        />
        <p class="form-hint">文件名，板块内唯一；可含中文与字母数字</p>
        <p v-if="slugError" class="form-error">{{ slugError }}</p>
      </div>

      <div class="form-row">
        <label class="form-label" for="new-tags">标签</label>
        <input
          id="new-tags"
          v-model="tagsInput"
          class="form-input"
          type="text"
          placeholder="逗号分隔，如：cet6, 高频"
          autocomplete="off"
        />
      </div>

      <div class="form-row">
        <label class="form-label" for="new-source">来源</label>
        <input
          id="new-source"
          v-model="source"
          class="form-input"
          type="text"
          placeholder="可选，如：2024 考研阅读 Text 2"
          autocomplete="off"
        />
      </div>

      <p v-if="formError" class="form-error">{{ formError }}</p>

      <div class="form-actions">
        <RouterLink to="/" class="cancel-link">取消</RouterLink>
        <button type="submit" class="submit-btn" :disabled="submitting">
          {{ submitting ? '创建中…' : '创建并编辑' }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.new-note-page {
  max-width: 560px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--space-5);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  margin: 0 0 var(--space-2);
  letter-spacing: -0.01em;
}

.page-desc {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-base);
}

.form-card {
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.form-row {
  margin-bottom: var(--space-4);
}

.form-label {
  display: block;
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  font-size: var(--text-base);
  font-family: inherit;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--focus-ring);
}

.form-input.invalid {
  border-color: var(--color-danger);
}

.form-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.form-error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--color-danger);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-4);
  margin-top: var(--space-5);
}

.cancel-link {
  color: var(--color-text-secondary);
  font-size: var(--text-base);
  text-decoration: none;
}

.cancel-link:hover {
  color: var(--color-text);
}

.submit-btn {
  padding: var(--space-2) var(--space-5);
  font-size: var(--text-base);
  font-family: inherit;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-on-accent);
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.submit-btn:hover {
  opacity: 0.88;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 767px) {
  .form-card {
    padding: var(--space-4);
  }
}
</style>
