<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type ServerInfo } from '../api'
import { useTheme, type ThemePreference } from '../lib/theme'
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
}
</style>
