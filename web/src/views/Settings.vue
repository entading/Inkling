<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api, type ServerInfo } from '../api'

const info = ref<ServerInfo | null>(null)
const loading = ref(true)
const error = ref('')

/** 切换进行中：禁用开关，等待服务端后台完成 close→listen 后核对实际状态 */
const pending = ref(false)
const fail = ref('')

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
  font-size: 1.4rem;
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
  font-size: 1.1rem;
  font-weight: 600;
}

.desc {
  margin: 0 0 var(--space-3);
  color: var(--color-text-secondary);
  font-size: 0.9rem;
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
  display: block;
  width: 44px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--color-border);
  transition: background-color 0.2s ease;
}

.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-full);
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease;
}

.switch input:checked + .track {
  background: var(--color-accent);
}

.switch input:checked ~ .thumb {
  transform: translateX(20px);
}

.switch input:disabled + .track {
  opacity: 0.5;
}

.switch-state {
  font-size: 0.95rem;
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
  font-size: 0.95rem;
  color: var(--color-accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(59, 130, 246, 0.3);
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
  background: #fff;
}

.path {
  display: block;
  padding: var(--space-3);
  font-size: 0.88rem;
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
  font-size: 0.85rem;
}

.kv dd {
  margin: 0;
  font-size: 0.9rem;
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
