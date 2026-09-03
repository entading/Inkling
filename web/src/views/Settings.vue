<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { api, type FontEntry, type ServerInfo } from '../api'
import { useTheme, type ThemePreference } from '../lib/theme'
import {
  deleteFont as deleteReadingFont,
  getFallbackPreference,
  getFontPreference,
  getLinePreference,
  getScopePreference,
  getSizePreference,
  importFont,
  readingFontsRef,
  refreshReadingFonts,
  setFallbackPreference,
  setFontPreference,
  setLinePreference,
  setScopePreference,
  setSizePreference,
  type ReadingFallback,
  type ReadingFontPref,
  type ReadingFontScope,
  type ReadingLine,
  type ReadingSize,
} from '../lib/readingFont'
import {
  clearSavedVoice,
  getSavedVoiceName,
  getVoices,
  isTtsSupported,
  saveVoiceName,
  speak,
} from '../lib/tts'

// ---------- 外观（主题）：纯前端偏好，存 localStorage en_tool:theme，不走 /api/settings ----------

const theme = useTheme()

const themeOptions: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const themeGroup = ref<HTMLElement | null>(null)

/** radiogroup 键盘模式：方向键循环移动并选中（roving tabindex，焦点跟随选中项） */
function onThemeKeydown(e: KeyboardEvent): void {
  const idx = themeOptions.findIndex((o) => o.value === theme.preference.value)
  if (idx < 0) return
  let delta = 0
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') delta = 1
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') delta = -1
  else return
  e.preventDefault()
  const next = themeOptions[(idx + delta + themeOptions.length) % themeOptions.length]
  theme.setPreference(next.value)
  requestAnimationFrame(() => {
    themeGroup.value
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [themeOptions.indexOf(next)]?.focus()
  })
}

const info = ref<ServerInfo | null>(null)
const loading = ref(true)
const error = ref('')

// ---------- 阅读排版（F1）：纯前端偏好，三键 localStorage + 导入字体列表 ----------

const fontPref = ref<ReadingFontPref>(getFontPreference())
const sizePref = ref<ReadingSize>(getSizePreference())
const linePref = ref<ReadingLine>(getLinePreference())

const fontPresetOptions: ReadonlyArray<{ value: ReadingFontPref; label: string }> = [
  { value: '', label: '默认衬线' },
  { value: 'sans', label: '无衬线' },
]
const sizeOptions: ReadonlyArray<{ value: ReadingSize; label: string }> = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '标准' },
  { value: 'lg', label: '大' },
]
const lineOptions: ReadonlyArray<{ value: ReadingLine; label: string }> = [
  { value: 'tight', label: '紧凑' },
  { value: 'normal', label: '标准' },
  { value: 'loose', label: '宽松' },
]

const readingFonts = computed(() => readingFontsRef.value)

// 正文字体选中态联动（复检修复）：lib 层死偏好回落（字体被他端删除）或删除正用字体后，
// 本页 ref 需同步清空，避免「无任何 radio 选中」的幽灵态；''/'sans' 无列表依赖不参与
watch([readingFonts, fontPref], ([list, pref]) => {
  if (pref && pref !== 'sans' && !list.some((f) => f.id === pref)) {
    fontPref.value = ''
  }
})

const fontGroup = ref<HTMLElement | null>(null)
const sizeGroup = ref<HTMLElement | null>(null)
const lineGroup = ref<HTMLElement | null>(null)
const scopeGroup = ref<HTMLElement | null>(null)
const fallbackGroup = ref<HTMLElement | null>(null)

/** radiogroup 通用键盘模式（theme-seg 同款 roving tabindex）：方向键循环移动并选中 */
function segKeydown(
  e: KeyboardEvent,
  values: readonly string[],
  current: string,
  apply: (v: string) => void,
  group: Ref<HTMLElement | null>,
): void {
  const idx = values.indexOf(current)
  if (idx < 0) return
  let delta = 0
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') delta = 1
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') delta = -1
  else return
  e.preventDefault()
  const next = values[(idx + delta + values.length) % values.length]
  apply(next)
  requestAnimationFrame(() => {
    group.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[values.indexOf(next)]?.focus()
  })
}

function selectFontPreset(v: ReadingFontPref): void {
  fontPref.value = v
  setFontPreference(v)
}

function onFontSegKeydown(e: KeyboardEvent): void {
  segKeydown(e, fontPresetOptions.map((o) => o.value), fontPref.value, (v) => selectFontPreset(v), fontGroup)
}

function onSizeSegKeydown(e: KeyboardEvent): void {
  segKeydown(
    e,
    sizeOptions.map((o) => o.value),
    sizePref.value,
    (v) => {
      sizePref.value = v as ReadingSize
      setSizePreference(v as ReadingSize)
    },
    sizeGroup,
  )
}

function onLineSegKeydown(e: KeyboardEvent): void {
  segKeydown(
    e,
    lineOptions.map((o) => o.value),
    linePref.value,
    (v) => {
      linePref.value = v as ReadingLine
      setLinePreference(v as ReadingLine)
    },
    lineGroup,
  )
}

// —— 覆盖范围（F1 追加）：仅对导入字体有意义，预设（默认衬线/无衬线）时置灰 ——

const scopePref = ref<ReadingFontScope>(getScopePreference())
const scopeEnabled = computed(() => fontPref.value !== '' && fontPref.value !== 'sans')

const scopeOptions: ReadonlyArray<{ value: ReadingFontScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'cjk', label: '仅中文' },
  { value: 'latin', label: '仅英文' },
]

function selectScope(v: ReadingFontScope): void {
  scopePref.value = v
  setScopePreference(v)
}

function onScopeSegKeydown(e: KeyboardEvent): void {
  if (!scopeEnabled.value) return
  segKeydown(
    e,
    scopeOptions.map((o) => o.value),
    scopePref.value,
    (v) => selectScope(v as ReadingFontScope),
    scopeGroup,
  )
}

// —— 另一侧字体（方案 B）：scope=cjk|latin 时被导入字体让出的那侧用衬线还是无衬线。
// 行常驻（不 v-if）：切覆盖范围/正文字体时下方内容不跳动（复检交互优化），
// 非生效态整块置灰禁用，与 scope-off 同款视觉语言 ——

const fallbackPref = ref<ReadingFallback>(getFallbackPreference())
const fallbackEnabled = computed(
  () => fontPref.value !== '' && fontPref.value !== 'sans' && scopePref.value !== 'all',
)
const fallbackHint = computed(() => {
  if (fontPref.value === '' || fontPref.value === 'sans') return '选中导入字体后生效'
  if (scopePref.value === 'all') return '覆盖范围为全部时由导入字体接管'
  return scopePref.value === 'cjk' ? '作用于英文与共用标点' : '作用于中文与全角标点'
})

const fallbackOptions: ReadonlyArray<{ value: ReadingFallback; label: string }> = [
  { value: '', label: '默认衬线' },
  { value: 'sans', label: '无衬线' },
]

function selectFallback(v: ReadingFallback): void {
  fallbackPref.value = v
  setFallbackPreference(v)
}

function onFallbackSegKeydown(e: KeyboardEvent): void {
  if (!fallbackEnabled.value) return
  segKeydown(
    e,
    fallbackOptions.map((o) => o.value),
    fallbackPref.value,
    (v) => selectFallback(v as ReadingFallback),
    fallbackGroup,
  )
}

// 跨页签偏好同步（复检修复）：他页签改偏好必然广播 → 本页签 resync 重拉列表
// （readingFontsRef 引用更新）→ 此时从 localStorage 全量重读偏好，
// 保证 seg 选中态与真实存储一致（否则残留他页签改动前的高亮）
watch(readingFontsRef, () => {
  fontPref.value = getFontPreference()
  sizePref.value = getSizePreference()
  linePref.value = getLinePreference()
  scopePref.value = getScopePreference()
  fallbackPref.value = getFallbackPreference()
})

// —— 导入字体：选文件 → 内联命名表单 → 上传（禁 window 弹窗，T2 同款内联交互） ——

const fileInput = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingName = ref('')
const importing = ref(false)
const importError = ref('')
const deletingId = ref('')

function onFileChosen(e: Event): void {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = '' // 允许重选同一文件
  importError.value = ''
  if (!file) return
  pendingFile.value = file
  // 码点截断（spread 而非 slice）：含代理对的字体名（扩展 CJK/emoji）不会被切成半字符
  pendingName.value = [...file.name.replace(/\.(ttf|otf|woff2)$/i, '')].slice(0, 32).join('')
}

async function confirmImport(): Promise<void> {
  if (!pendingFile.value || importing.value) return
  const name = pendingName.value.trim()
  if (name.length < 1 || name.length > 32) {
    importError.value = '字体名称必须为 1–32 个字符'
    return
  }
  importing.value = true
  importError.value = ''
  try {
    await importFont(name, pendingFile.value)
    pendingFile.value = null
    pendingName.value = ''
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e)
  } finally {
    importing.value = false
  }
}

function cancelImport(): void {
  pendingFile.value = null
  pendingName.value = ''
  importError.value = ''
}

async function removeFontEntry(id: string): Promise<void> {
  if (deletingId.value) return
  deletingId.value = id
  importError.value = ''
  try {
    await deleteReadingFont(id)
    // 正用字体被删时 lib 已回落默认并重应用；本页选中态同步
    if (fontPref.value === id) fontPref.value = ''
  } catch (e) {
    importError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deletingId.value = ''
  }
}

function resetReading(): void {
  fontPref.value = ''
  sizePref.value = 'md'
  linePref.value = 'normal'
  scopePref.value = 'all'
  fallbackPref.value = ''
  setFontPreference('')
  setSizePreference('md')
  setLinePreference('normal')
  setScopePreference('all')
  setFallbackPreference('')
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function statusLabel(f: FontEntry): string {
  if (f.status === 'pending') return '分片中…'
  if (f.status === 'failed') return '失败'
  return `${f.chunkCount} 片`
}

// 分片轮询：列表存在 pending 条目时每 2s 重拉，ready/failed 由轮询呈现（E1 异步任务）
let pollTimer: number | undefined
watch(
  readingFonts,
  (list) => {
    const hasPending = list.some((f) => f.status === 'pending')
    if (hasPending && pollTimer === undefined) {
      pollTimer = window.setInterval(() => void refreshReadingFonts().catch(() => {}), 2000)
    } else if (!hasPending && pollTimer !== undefined) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
})

/** 切换进行中：禁用开关，等待服务端后台完成 close→listen 后核对实际状态 */
const pending = ref(false)
const fail = ref('')

// ---------- 发音（TTS）：纯浏览器端偏好，voice 存 localStorage 不走 /api/settings ----------

const ttsSupported = isTtsSupported()
const voices = ref<SpeechSynthesisVoice[]>([])
const voicesLoading = ref(ttsSupported)
/** 空字符串 = 未指定（默认美音 en-US 兜底），与 tts.pickVoice 的回落语义一致 */
const selectedVoiceName = ref('')

/** en-* 语音排前（排序稳定，组内保持系统顺序） */
function sortVoices(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...list].sort((a, b) => {
    const ae = a.lang.toLowerCase().startsWith('en') ? 0 : 1
    const be = b.lang.toLowerCase().startsWith('en') ? 0 : 1
    return ae - be
  })
}

function onVoiceChange(): void {
  if (selectedVoiceName.value) saveVoiceName(selectedVoiceName.value)
  else clearSavedVoice()
}

function previewVoice(): void {
  speak('Hello! This is a preview of the selected voice.')
}

if (ttsSupported) {
  selectedVoiceName.value = getSavedVoiceName() ?? ''
  void getVoices().then((list) => {
    voices.value = sortVoices(list)
    voicesLoading.value = false
    // 已保存的 voice 在当前设备语音库中不存在时回落默认（pickVoice 同样会忽略它）
    if (selectedVoiceName.value && !list.some((v) => v.name === selectedVoiceName.value)) {
      selectedVoiceName.value = ''
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    info.value = await api.serverInfo()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function toggleLan() {
  if (!info.value || pending.value) return
  const target = !info.value.lanEnabled
  pending.value = true
  fail.value = ''
  try {
    // 应答反映目标状态；实际切换在服务端应答后后台执行，短暂延迟后核对
    const next = await api.updateSettings(target)
    info.value = next
    await sleep(800)
    let current: ServerInfo | null = null
    for (let i = 0; i < 3 && !current; i++) {
      try {
        current = await api.serverInfo()
      } catch {
        // 切换间隙服务端短暂不可达，稍后重试
        await sleep(400)
      }
    }
    if (current) {
      info.value = current
      if (current.lanEnabled !== target) {
        fail.value = '切换失败，服务端已回滚（可能端口被占用），请重试。'
      }
    }
  } catch (e) {
    fail.value = e instanceof Error ? e.message : String(e)
  } finally {
    pending.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="settings-page">
    <header class="page-header">
      <h1 class="page-title">设置</h1>
    </header>

    <!-- 外观为纯前端能力，不依赖服务端：error / 加载中时同样可用 -->
    <section class="card">
      <h2 class="card-title">外观</h2>
      <p class="desc">
        界面配色主题。「跟随系统」时自动与操作系统的深浅色设置保持一致，偏好保存在当前浏览器。
      </p>
      <div
        ref="themeGroup"
        class="theme-seg"
        role="radiogroup"
        aria-label="界面主题"
        @keydown="onThemeKeydown"
      >
        <button
          v-for="opt in themeOptions"
          :key="opt.value"
          type="button"
          role="radio"
          class="theme-opt"
          :class="{ active: theme.preference.value === opt.value }"
          :aria-checked="theme.preference.value === opt.value"
          :tabindex="theme.preference.value === opt.value ? 0 : -1"
          @click="theme.setPreference(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </section>

    <!-- 阅读排版为纯前端能力，不依赖服务端：error / 加载中时同样可用；导入字体存服务端全设备共用 -->
    <section class="card">
      <h2 class="card-title">阅读排版</h2>
      <p class="desc">
        阅读页正文的字体、字号与行距，编辑页预览同步生效。偏好保存在当前浏览器（不同设备各自记忆），
        导入的字体保存在服务端、所有设备共用。
      </p>

      <div class="reading-block">
        <span class="reading-label">正文字体</span>
        <div
          ref="fontGroup"
          class="reading-seg"
          :style="{ '--seg-cols': 2, '--seg-index': fontPref === 'sans' ? 1 : 0 }"
          role="radiogroup"
          aria-label="正文字体"
          @keydown="onFontSegKeydown"
        >
          <span class="seg-thumb" :class="{ 'seg-thumb-none': fontPref !== '' && fontPref !== 'sans' }" aria-hidden="true" />
          <button
            v-for="opt in fontPresetOptions"
            :key="opt.value || 'serif'"
            type="button"
            role="radio"
            class="theme-opt"
            :class="{ active: fontPref === opt.value }"
            :aria-checked="fontPref === opt.value"
            :tabindex="fontPref === opt.value ? 0 : -1"
            @click="selectFontPreset(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="reading-block scope-block" :class="{ 'scope-off': !scopeEnabled }">
        <span class="reading-label">覆盖范围</span>
        <div
          ref="scopeGroup"
          class="reading-seg"
          :style="{ '--seg-cols': scopeOptions.length, '--seg-index': Math.max(0, scopeOptions.findIndex(o => o.value === scopePref)) }"
          role="radiogroup"
          aria-label="导入字体覆盖范围"
          @keydown="onScopeSegKeydown"
        >
          <span class="seg-thumb" aria-hidden="true" />
          <button
            v-for="opt in scopeOptions"
            :key="opt.value"
            type="button"
            role="radio"
            class="theme-opt"
            :disabled="!scopeEnabled"
            :class="{ active: scopeEnabled && scopePref === opt.value }"
            :aria-checked="scopePref === opt.value"
            :tabindex="scopeEnabled && scopePref === opt.value ? 0 : -1"
            @click="selectScope(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <span v-if="!scopeEnabled" class="scope-hint">选中导入字体后生效</span>
      </div>

      <div class="reading-block scope-block" :class="{ 'scope-off': !fallbackEnabled }">
        <span class="reading-label">另一侧字体</span>
        <div
          ref="fallbackGroup"
          class="reading-seg"
          :style="{ '--seg-cols': fallbackOptions.length, '--seg-index': Math.max(0, fallbackOptions.findIndex(o => o.value === fallbackPref)) }"
          role="radiogroup"
          aria-label="另一侧字体"
          @keydown="onFallbackSegKeydown"
        >
          <span class="seg-thumb" aria-hidden="true" />
          <button
            v-for="opt in fallbackOptions"
            :key="opt.value || 'serif'"
            type="button"
            role="radio"
            class="theme-opt"
            :disabled="!fallbackEnabled"
            :class="{ active: fallbackEnabled && fallbackPref === opt.value }"
            :aria-checked="fallbackPref === opt.value"
            :tabindex="fallbackEnabled && fallbackPref === opt.value ? 0 : -1"
            @click="selectFallback(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <span class="scope-hint">{{ fallbackHint }}</span>
      </div>

      <ul v-if="readingFonts.length > 0" class="font-list">
        <li
          v-for="f in readingFonts"
          :key="f.id"
          class="font-row"
          :class="{ selected: fontPref === f.id, dimmed: f.status !== 'ready' }"
        >
          <button
            type="button"
            class="font-pick"
            :disabled="f.status !== 'ready'"
            :title="f.status === 'failed' ? f.error : undefined"
            @click="selectFontPreset(f.id)"
          >
            <span class="font-name">{{ f.name }}</span>
            <span class="font-meta">{{ formatSize(f.sizeBytes) }} · {{ statusLabel(f) }}</span>
            <span v-if="fontPref === f.id" class="font-inuse">使用中</span>
          </button>
          <button
            type="button"
            class="font-del"
            :disabled="deletingId === f.id"
            :aria-label="`删除字体 ${f.name}`"
            @click="removeFontEntry(f.id)"
          >
            {{ deletingId === f.id ? '删除中…' : '删除' }}
          </button>
        </li>
      </ul>
      <p v-if="importError" class="error import-error">{{ importError }}</p>

      <div v-if="pendingFile" class="import-row">
        <input
          v-model="pendingName"
          class="import-name"
          maxlength="32"
          placeholder="字体名称"
          aria-label="字体名称"
          @keydown.enter="confirmImport"
        />
        <button type="button" class="import-confirm" :disabled="importing" @click="confirmImport">
          {{ importing ? '上传分片中…' : '确认导入' }}
        </button>
        <button type="button" class="import-cancel" :disabled="importing" @click="cancelImport">
          取消
        </button>
      </div>
      <div v-else class="import-row">
        <button type="button" class="import-btn" @click="fileInput?.click()">＋ 导入字体</button>
        <span class="import-hint">支持 .ttf / .otf / .woff2，≤30MB；中文大字体分片约需十几秒</span>
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".ttf,.otf,.woff2"
        class="file-hidden"
        aria-hidden="true"
        tabindex="-1"
        @change="onFileChosen"
      />

      <div class="reading-block">
        <span class="reading-label">字号</span>
        <div
          ref="sizeGroup"
          class="reading-seg"
          :style="{ '--seg-cols': sizeOptions.length, '--seg-index': Math.max(0, sizeOptions.findIndex(o => o.value === sizePref)) }"
          role="radiogroup"
          aria-label="正文字号"
          @keydown="onSizeSegKeydown"
        >
          <span class="seg-thumb" aria-hidden="true" />
          <button
            v-for="opt in sizeOptions"
            :key="opt.value"
            type="button"
            role="radio"
            class="theme-opt"
            :class="{ active: sizePref === opt.value }"
            :aria-checked="sizePref === opt.value"
            :tabindex="sizePref === opt.value ? 0 : -1"
            @click="sizePref = opt.value; setSizePreference(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="reading-block">
        <span class="reading-label">行距</span>
        <div
          ref="lineGroup"
          class="reading-seg"
          :style="{ '--seg-cols': lineOptions.length, '--seg-index': Math.max(0, lineOptions.findIndex(o => o.value === linePref)) }"
          role="radiogroup"
          aria-label="正文行距"
          @keydown="onLineSegKeydown"
        >
          <span class="seg-thumb" aria-hidden="true" />
          <button
            v-for="opt in lineOptions"
            :key="opt.value"
            type="button"
            role="radio"
            class="theme-opt"
            :class="{ active: linePref === opt.value }"
            :aria-checked="linePref === opt.value"
            :tabindex="linePref === opt.value ? 0 : -1"
            @click="linePref = opt.value; setLinePreference(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="reading-sample" aria-hidden="true">
        <p>
          The quick brown fox jumps over the lazy dog.
          敏捷的棕色狐狸跳过了懒惰的狗 —— Serif 0123 教学排版样张。
        </p>
      </div>

      <div class="reading-reset-row">
        <button type="button" class="reset-btn" @click="resetReading">恢复默认</button>
      </div>
    </section>

    <p v-if="error" class="error">加载失败：{{ error }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <template v-else-if="info">
      <section class="card">
        <h2 class="card-title">局域网访问</h2>
        <p class="desc">
          默认只允许本机浏览器访问；开启后同一 Wi-Fi 下的手机可通过下方地址访问。
          知识库仍保存在本机，手机只是查看端。默认不开启，重启服务后关闭。
        </p>

        <div class="switch-row">
          <label class="switch">
            <input
              type="checkbox"
              aria-label="局域网访问"
              :checked="info.lanEnabled"
              :disabled="pending"
              @change="toggleLan"
            />
            <span class="track"><span class="thumb" /></span>
          </label>
          <span class="switch-state">
            {{ pending ? '切换中…' : info.lanEnabled ? '已开启' : '未开启' }}
          </span>
        </div>

        <p v-if="fail" class="error">{{ fail }}</p>

        <template v-if="info.lanEnabled">
          <p class="desc">手机访问地址（扫码或输入）：</p>
          <ul class="url-list">
            <li v-for="u in info.urls" :key="u">
              <a :href="u" target="_blank" rel="noopener" class="url-link">{{ u }}</a>
            </li>
          </ul>
          <img v-if="info.qrDataUrl" :src="info.qrDataUrl" class="qr" alt="手机访问二维码" />
          <p class="desc">打开微信或手机相机的扫码功能即可打开知识库。</p>
        </template>
        <p v-else class="desc">开启后此处会显示手机可用的地址与二维码。</p>
      </section>

      <section class="card">
        <h2 class="card-title">数据目录</h2>
        <p class="desc">笔记以 Markdown 文件保存在以下目录，可整体迁移或手工增删：</p>
        <code class="path">{{ info.notesDir }}</code>
      </section>

      <section class="card">
        <h2 class="card-title">服务信息</h2>
        <dl class="kv">
          <div><dt>监听地址</dt><dd>{{ info.host }}:{{ info.port }}</dd></div>
          <div><dt>访问地址</dt><dd>{{ info.urls.find(u => u.includes('localhost')) }}</dd></div>
        </dl>
      </section>

      <section v-if="ttsSupported" class="card">
        <h2 class="card-title">发音（TTS）</h2>
        <p class="desc">
          词条朗读与选中朗读使用浏览器内置语音合成，默认美音（en-US）。
          语音选择保存在当前浏览器，不同设备各自记忆。
        </p>
        <div class="tts-row">
          <label class="tts-field">
            <span class="tts-label">语音</span>
            <select
              v-model="selectedVoiceName"
              class="tts-select"
              :disabled="voicesLoading"
              @change="onVoiceChange"
            >
              <option value="">默认（美音）</option>
              <option v-for="(v, i) in voices" :key="`${i}-${v.name}`" :value="v.name">
                {{ v.name }} ({{ v.lang }})
              </option>
            </select>
          </label>
          <button type="button" class="tts-preview" :disabled="voicesLoading" @click="previewVoice">
            试听
          </button>
        </div>
        <p v-if="voicesLoading" class="desc tts-note">加载语音列表…</p>
        <p v-else-if="voices.length === 0" class="desc tts-note">
          当前浏览器未提供任何语音，朗读将使用系统默认音色。
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: var(--content-max-width);
  margin: 0 auto;
}

.page-header {
  margin-bottom: var(--space-5);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}

.card {
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.card-title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-lg);
  font-weight: 600;
}

.theme-seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.theme-opt {
  padding: var(--space-1) var(--space-4);
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.theme-opt:hover {
  color: var(--color-text);
}

.theme-opt.active {
  color: var(--color-text);
  font-weight: 500;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.theme-opt:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.desc {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--text-base);
  line-height: 1.6;
}

.switch-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.switch {
  position: relative;
  display: inline-block;
  cursor: pointer;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.track {
  position: relative;
  display: block;
  width: 44px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-border);
  transition: background-color var(--duration-base) var(--ease-out);
}

.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-slow) var(--ease-spring);
}

.switch input:checked + .track {
  background: var(--color-accent);
}

/* thumb 是 track 的子元素（非 input 兄弟）：选中态经 track 后代选择传导（修复白胶囊不滑动） */
.switch input:checked + .track .thumb {
  transform: translateX(20px);
}

.switch input:disabled + .track {
  opacity: 0.5;
}

.switch-state {
  font-size: var(--text-base);
  font-weight: 500;
}

.url-list {
  margin: 0 0 var(--space-3);
  padding-left: 1.4em;
}

.url-list li {
  margin: var(--space-1) 0;
}

.url-link {
  font-size: var(--text-base);
  color: var(--color-accent);
  text-decoration: none;
  border-bottom: 1px solid var(--wiki-underline);
  overflow-wrap: anywhere;
}

.qr {
  display: block;
  width: 200px;
  height: 200px;
  margin: var(--space-2) 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  background: var(--color-surface);
}

.path {
  display: block;
  padding: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-wrap: anywhere;
}

.kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.kv > div {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.kv dt {
  flex: none;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.kv dd {
  margin: 0;
  font-size: var(--text-base);
}

.tts-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.tts-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  flex: 1;
}

.tts-label {
  flex: none;
  font-size: var(--text-base);
  color: var(--color-text-secondary);
}

.tts-select {
  flex: 1;
  min-width: 0;
  max-width: 420px;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-base);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.tts-select:hover:not(:disabled) {
  border-color: var(--color-accent);
}

.tts-select:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.tts-select:disabled {
  color: var(--color-text-secondary);
  cursor: default;
}

.tts-preview {
  flex: none;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-base);
  color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.tts-preview:hover:not(:disabled) {
  color: var(--color-on-accent);
  background: var(--color-accent);
}

.tts-preview:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 按压反馈（§6）：全部新增动画统一包在 no-preference 内 */
@media (prefers-reduced-motion: no-preference) {
  .tts-preview:active {
    transform: scale(0.98);
  }
}

.tts-note {
  margin-top: var(--space-3);
  margin-bottom: 0;
}

.hint,
.error {
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-danger);
}

@media (max-width: 767px) {
  .card {
    padding: var(--space-4);
  }

  /* 阅读排版（F1）：窄屏下标签与控件纵向堆叠，行内表单换行 */
  .reading-block {
    flex-wrap: wrap;
  }

  .import-name {
    flex: 1;
    width: auto;
    min-width: 0;
  }
}

/* —— 覆盖范围（F1 追加）———————————————————————————— */
/* 预设（默认衬线/无衬线）无覆盖概念：整块降透明 + 按钮禁用，scope 偏好值保留待切换 */
.scope-block.scope-off {
  opacity: 0.5;
}

.scope-block.scope-off .theme-opt {
  cursor: default;
}

.scope-hint {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

@media (max-width: 767px) {
  .scope-block {
    flex-wrap: wrap;
  }
}

/* —— 阅读排版 seg 滑块（复检交互优化）——Board .seg-thumb 配方移植、N 格通用：
   等宽 grid（按钮 min-width 保底）+ thumb 白底承担选中视觉、按钮只留 accent 字色；
   位移过渡 --duration-slow + --ease-spring 且必须包 no-preference（reduced-motion 直跳） */
.reading-seg {
  position: relative;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding: 3px;
  background: var(--color-surface-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.reading-seg .seg-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc((100% - 6px) / var(--seg-cols));
  transform: translateX(calc(var(--seg-index) * 100%));
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
}

@media (prefers-reduced-motion: no-preference) {
  .reading-seg .seg-thumb {
    transition: transform var(--duration-slow) var(--ease-spring),
      opacity var(--duration-base) var(--ease-out);
  }
}

/* 选中导入字体时正文字体组两个预设均未选：thumb 淡出（停在原格会误导为已选） */
.reading-seg .seg-thumb-none {
  opacity: 0;
}

.reading-seg .theme-opt {
  position: relative;
  min-width: 5.5em;
  text-align: center;
}

.reading-seg .theme-opt.active {
  background: transparent;
  box-shadow: none;
  color: var(--color-accent);
}

@media (prefers-reduced-motion: no-preference) {
  .reading-seg .theme-opt:active {
    transform: scale(0.98);
  }
}

/* —— 阅读排版（F1）———————————————————————————————— */

.reading-block {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.reading-label {
  flex: none;
  min-width: 4em;
  font-size: var(--text-base);
  color: var(--color-text-secondary);
}

.font-list {
  list-style: none;
  margin: 0 0 var(--space-3);
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.font-row {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--color-border);
}

.font-row:last-child {
  border-bottom: none;
}

.font-row.selected {
  background: var(--color-accent-soft);
}

.font-row.dimmed {
  opacity: 0.55;
}

.font-pick {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.font-pick:disabled {
  cursor: default;
}

.font-pick:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.font-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--color-text);
}

.font-meta {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.font-inuse {
  flex: none;
  font-size: var(--text-xs);
  color: var(--color-accent);
}

.font-del {
  flex: none;
  padding: 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-left: 1px solid var(--color-border);
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-out);
}

.font-del:hover:not(:disabled) {
  color: var(--color-danger);
}

.import-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.import-btn {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-accent);
  background: transparent;
  border: 1px dashed var(--color-accent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.import-btn:hover {
  color: var(--color-on-accent);
  background: var(--color-accent);
  border-style: solid;
}

.import-name {
  width: 200px;
  max-width: 100%;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.import-name:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.import-confirm,
.import-cancel {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: opacity var(--duration-fast) var(--ease-out);
}

.import-confirm {
  color: var(--color-on-accent);
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
}

.import-cancel {
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
}

.import-confirm:disabled,
.import-cancel:disabled {
  opacity: 0.5;
  cursor: default;
}

.import-hint {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.import-error {
  margin: calc(var(--space-1) * -1) 0 var(--space-2);
  font-size: var(--text-sm);
}

/* 隐藏的文件选择 input：保留可访问性语义但不可见（视觉入口是「＋ 导入字体」按钮） */
.file-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.reading-sample {
  margin: 0 0 var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-serif);
  font-size: var(--note-body-size);
  line-height: var(--note-line-height);
  color: var(--color-text);
}

.reading-sample p {
  margin: 0;
}

.reading-reset-row {
  display: flex;
  justify-content: flex-end;
}

.reset-btn {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: var(--wiki-underline);
  text-underline-offset: 3px;
  transition: color var(--duration-fast) var(--ease-out);
}

.reset-btn:hover {
  color: var(--color-text);
}
</style>
