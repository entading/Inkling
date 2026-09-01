<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import CommandPalette from './components/CommandPalette.vue'
import FloatingActions from './components/FloatingActions.vue'
import Icon, { type IconName } from './components/Icon.vue'
import { boardRoutes } from './router'

const route = useRoute()

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

onMounted(() => window.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
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
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  background: var(--color-bg);
}

.sidebar {
  position: sticky;
  top: 0;
  align-self: flex-start;
  width: var(--sidebar-width);
  flex-shrink: 0;
  height: 100vh;
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
  .new-entry:active {
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

  .content {
    /* 底部余量 = 底导 72px + FAB 顶缘（120px）+ 16px 防遮挡（M5'）+ 安全区 */
    padding: var(--space-4) var(--space-5) calc(136px + env(safe-area-inset-bottom));
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
