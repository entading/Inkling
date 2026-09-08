<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { api } from './api'
import CommandPalette from './components/CommandPalette.vue'
import FloatingActions from './components/FloatingActions.vue'
import Icon, { type IconName } from './components/Icon.vue'
import { isDesktop } from './lib/desktop'
import { pingServer, serverOnline } from './lib/serverStatus'
import { boardRoutes } from './router'

const route = useRoute()

// ---------- 服务断连横幅（E2）：api 层网络失败置离线，「重试」主动探测 ----------
// 文案双态：桌面态引导重启应用，网页态引导确认桌面应用在运行（勿出现 host:port 措辞）

const serverBannerText = isDesktop
  ? '无法连接到 Inkling 服务，请重启应用'
  : '无法连接到 Inkling 服务，请确认桌面应用是否在运行'

const retrying = ref(false)

async function retryConnection(): Promise<void> {
  retrying.value = true
  await pingServer()
  retrying.value = false
}

// ---------- 首启轻引导（E4 S2，向导取消后的替代）：桌面态 + 默认数据目录 + 四板块全空 +
// 未关闭过才出现。App 级横幅保证任何路由可见；关闭持久化 localStorage（桌面态专属语义）。
// 网页态零请求零渲染；桌面态条件不满足（已配目录/已有词条）也不出现 ----------

const ONBOARDING_KEY = 'en_tool:desktop:onboarding-dismissed'

function readOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1'
  } catch {
    return false
  }
}

const onboardingDismissed = ref(readOnboardingDismissed())
const onboardingIsDefault = ref(false)
const onboardingAllEmpty = ref(false)

const showOnboarding = computed(
  () => isDesktop && !onboardingDismissed.value && onboardingIsDefault.value && onboardingAllEmpty.value,
)

function dismissOnboarding(): void {
  onboardingDismissed.value = true
  try {
    localStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
    /* 隐私模式等写入失败：仅本次会话生效 */
  }
}

/** 导航图标（§4）：侧栏与底部导航共用一份映射，颜色随 RouterLink 的 currentColor 变化 */
const NAV_ICONS: Record<string, IconName> = {
  '/': 'home',
  '/vocab': 'book',
  '/phrase': 'link',
  '/sentence': 'align-left',
  '/grammar': 'graduation-cap',
  '/tags': 'tag',
  '/settings': 'settings',
}

// ---------- 命令面板（§7）：全局 Ctrl/Cmd+K 触发 + 侧栏入口 ----------

const paletteOpen = ref(false)

/** kbd 文案按平台：Apple 系 ⌘K，其余 Ctrl K（UA 检测，仅用于展示，监听两侧都收） */
const isApplePlatform = /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
const kbdHint = isApplePlatform ? '⌘K' : 'Ctrl K'

function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  if (!isDesktop) return
  // 轻引导条件探测：boards 计数 + 数据目录形态；任一失败则横幅不出现（断连另有全局信号）
  void (async () => {
    try {
      const [boards, dd] = await Promise.all([api.boards(), api.dataDir().catch(() => null)])
      onboardingAllEmpty.value = boards.every((b) => b.count === 0)
      onboardingIsDefault.value = dd?.isDefault === true
    } catch {
      /* 服务不可达：不显示 */
    }
  })()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <div class="app-root">
    <!-- 服务断连横幅（E2）：全局叠加信号，不替代各视图的 loading/error 态 -->
    <div v-if="!serverOnline" class="server-banner" role="alert">
      <span class="server-banner-dot" aria-hidden="true"></span>
      <p class="server-banner-text">{{ serverBannerText }}</p>
      <button
        type="button"
        class="server-banner-retry"
        :disabled="retrying"
        @click="retryConnection"
      >
        {{ retrying ? '重试中…' : '重试' }}
      </button>
    </div>

    <!-- 首启轻引导（E4 S2）：条件全满足才出现（探测完成前不渲染，防闪烁）；去设置直达 -->
    <div v-if="showOnboarding" class="onboard-banner" role="status">
      <p class="onboard-text">
        首次使用？可在 设置 → 数据目录 选择你的笔记文件夹（支持 Obsidian 等已有 Markdown 目录）
      </p>
      <span class="onboard-actions">
        <RouterLink to="/settings" class="onboard-go">去设置</RouterLink>
        <button type="button" class="onboard-close" aria-label="关闭引导" @click="dismissOnboarding">
          ×
        </button>
      </span>
    </div>

    <div class="layout">
    <aside class="sidebar">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">I</span>
        <span class="brand-name">Inkling</span>
      </RouterLink>

      <!-- 命令面板入口（§7）：nav-item 同款视觉，kbd 提示快捷键 -->
      <button type="button" class="search-entry" @click="paletteOpen = true">
        <Icon name="search" :size="16" />
        <span>搜索</span>
        <kbd class="kbd-hint">{{ kbdHint }}</kbd>
      </button>

      <!-- 新建词条入口（UX 打磨）：全站常驻主操作，与搜索入口同宽堆叠；
           移动端侧栏整体隐藏，新建由 FAB 承担 -->
      <RouterLink to="/new" class="new-entry">
        <Icon name="plus" :size="16" />
        <span>新建词条</span>
      </RouterLink>

      <nav class="nav">
        <!-- 分区分组（UX 打磨）：导航顶部嵌线，与动作区（搜索/新建）分界、与下方「更多」对称 -->
        <div class="nav-sep">导航</div>
        <RouterLink to="/" class="nav-item" exact-active-class="active">
          <Icon :name="NAV_ICONS['/']" :size="16" />
          <span>首页</span>
        </RouterLink>
        <RouterLink
          v-for="r in boardRoutes"
          :key="r.path"
          :to="r.path"
          class="nav-item"
          active-class="active"
        >
          <Icon :name="NAV_ICONS[r.path]" :size="16" />
          <span>{{ r.label }}</span>
        </RouterLink>

        <!-- 分区分组（UX 打磨）：文字嵌线（两侧伪元素拉线），库内容与工具区（标签/设置）分界 -->
        <div class="nav-sep">更多</div>

        <RouterLink to="/tags" class="nav-item" active-class="active">
          <Icon :name="NAV_ICONS['/tags']" :size="16" />
          <span>标签</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-item" active-class="active">
          <Icon :name="NAV_ICONS['/settings']" :size="16" />
          <span>设置</span>
        </RouterLink>
      </nav>

      <p class="sidebar-foot">Markdown 文件即数据</p>
    </aside>

    <main class="content">
      <!-- 页面转场（§6）：out-in 顺序播放入场 fade；key=route.path——query 变化
           （板块页搜索）不触发转场属预期，路由间才转场 -->
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>

    <!-- 命令面板（§7）：Teleport body，全键盘可用 -->
    <CommandPalette :open="paletteOpen" @close="paletteOpen = false" />

    <!-- 浮动操作（M5'）：移动端 FAB 新建 + 桌面/移动回顶 -->
    <FloatingActions />

    <!-- 移动端底部导航：替代桌面侧边栏（设计 3.3），标签/设置收进首页右上角菜单 -->
    <nav class="bottom-nav" aria-label="移动端主导航">
      <RouterLink to="/" class="bottom-item" exact-active-class="active">
        <Icon :name="NAV_ICONS['/']" :size="20" />
        <span>首页</span>
      </RouterLink>
      <RouterLink
        v-for="r in boardRoutes"
        :key="r.path"
        :to="r.path"
        class="bottom-item"
        active-class="active"
      >
        <Icon :name="NAV_ICONS[r.path]" :size="20" />
        <span>{{ r.label }}</span>
      </RouterLink>
    </nav>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* 服务断连横幅（E2）：全局叠加信号，in-flow 置于布局之上 */
.server-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--color-warning-soft);
  border-bottom: 1px solid var(--color-warning);
}

.server-banner-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-warning);
}

.server-banner-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.server-banner-retry {
  flex: none;
  margin-left: auto;
  padding: var(--space-1) var(--space-3);
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-warning);
  background: var(--color-surface);
  border: 1px solid var(--color-warning);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.server-banner-retry:hover:not(:disabled) {
  color: var(--color-on-accent);
  background: var(--color-warning);
}

.server-banner-retry:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 首启轻引导（E4 S2）：与断连横幅同构（in-flow 置于布局之上），强调色系表达「可行动」 */
.onboard-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--color-accent-soft);
  border-bottom: 1px solid var(--color-accent);
}

.onboard-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.onboard-actions {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.onboard-go {
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-on-accent);
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.onboard-go:hover {
  opacity: 0.88;
}

.onboard-close {
  flex: none;
  width: 26px;
  height: 26px;
  font-size: var(--text-lg);
  line-height: 1;
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.onboard-close:hover {
  color: var(--color-text);
  background: var(--color-surface-2);
}

.onboard-close:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.layout {
  flex: 1;
  display: flex;
  background: var(--color-bg);
}

.sidebar {
  position: sticky;
  /* 吸附点/高度与 body 8px 浮卡边距协调（UX 打磨修复）：top 8px 保持浮卡边距视觉，
     高度扣除上下边距（8×2）——100vh 直用会底部溢出视口 8px 且滚到底被父容器拖出视口顶（跳动） */
  top: var(--space-2);
  align-self: flex-start;
  width: var(--sidebar-width);
  flex-shrink: 0;
  height: calc(100vh - var(--space-4));
  padding: var(--space-6) var(--space-4);
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  text-decoration: none;
  color: var(--color-text);
  padding: var(--space-2) var(--space-3);
}

.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  background: var(--gradient-brand);
  color: var(--color-on-accent);
  font-family: var(--font-serif);
  font-size: var(--text-lg);
  font-weight: 700;
  display: grid;
  place-items: center;
}

.brand-name {
  font-weight: 600;
  font-size: var(--text-lg);
  letter-spacing: 0.01em;
}

/* 命令面板入口（§7）：nav-item 同款视觉；kbd 靠右提示快捷键 */
.search-entry {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: calc(100% - var(--space-4) * 2);
  margin: var(--space-5) var(--space-4) 0;
  padding: var(--space-2) var(--space-3);
  font-family: inherit;
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.search-entry:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.kbd-hint {
  margin-left: auto;
  padding: 0 var(--space-1);
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

/* 新建词条入口（UX 打磨）：强调色实心，1px 同色描边对齐 search-entry 盒高 */
.new-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: calc(100% - var(--space-4) * 2);
  margin: var(--space-2) var(--space-4) 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--color-on-accent);
  background: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  text-decoration: none;
  transition: opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.new-entry:hover {
  opacity: 0.88;
}

.nav {
  /* 顶部间距交给首个 .nav-sep 的 margin（嵌线紧随新建按钮之后），避免双重叠加 */
  margin-top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 分区分组（UX 打磨）：文字嵌线——两侧 ::before/::after 拉出 1px 线，文字居中；
   默认上 12px（组内分隔，如「更多」），下 8px 接组内首项 */
.nav-sep {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: var(--space-3) var(--space-3) var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

/* 段落级嵌线（导航列表第一条，紧随动作区）单独拉开节奏至 24px */
.nav-sep:first-child {
  margin-top: var(--space-5);
}

.nav-sep::before,
.nav-sep::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--color-border);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  text-decoration: none;
  font-size: var(--text-base);
  transition: background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.nav-item:hover {
  background: var(--color-bg);
  color: var(--color-text);
}

.nav-item.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 500;
}

.sidebar-foot {
  margin-top: auto;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  padding: 0 var(--space-3);
}

.content {
  flex: 1;
  min-width: 0;
  padding: var(--space-6) var(--space-7);
}

/* 页面转场（§6 决策 #3）：入场 fade + 4px 上移，各 160ms；
   与全部新增动画一致包在 no-preference 内（reduced-motion 直切无过渡） */
@media (prefers-reduced-motion: no-preference) {
  .page-enter-active,
  .page-leave-active {
    transition: opacity var(--duration-page) var(--ease-out),
      transform var(--duration-page) var(--ease-out);
  }

  .page-enter-from {
    opacity: 0;
    transform: translateY(4px);
  }

  .page-leave-to {
    opacity: 0;
    transform: translateY(-4px);
  }

  .search-entry:active,
  .new-entry:active,
  .onboard-go:active {
    transform: scale(0.98);
  }
}

.bottom-nav {
  display: none;
}

@media (max-width: 767px) {
  .sidebar {
    display: none;
  }

  .onboard-banner {
    flex-wrap: wrap;
  }

  .content {
    /* 底部余量 = 底导 72px + FAB 顶缘（120px）+ 16px 防遮挡（M5'）+ 安全区；
       左右 16px（UX 打磨，原 24）：移动端正文列增宽 */
    padding: var(--space-4) var(--space-4) calc(136px + env(safe-area-inset-bottom));
  }

  .bottom-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-nav);
    display: flex;
    height: 56px;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
  }

  .bottom-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-out);
  }

  .bottom-item.active {
    color: var(--color-accent);
    font-weight: 500;
  }
}
</style>
