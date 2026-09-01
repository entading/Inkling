<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
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
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">I</span>
        <span class="brand-name">Inkling</span>
      </RouterLink>

      <nav class="nav">
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
  background: var(--color-accent);
  color: var(--color-on-accent);
  font-weight: 700;
  display: grid;
  place-items: center;
}

.brand-name {
  font-weight: 600;
  font-size: var(--text-lg);
  letter-spacing: 0.01em;
}

.nav {
  margin-top: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: 2px;
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
}

.bottom-nav {
  display: none;
}

@media (max-width: 767px) {
  .sidebar {
    display: none;
  }

  .content {
    padding: var(--space-4) var(--space-5) calc(72px + env(safe-area-inset-bottom));
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
