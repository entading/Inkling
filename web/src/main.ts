import { createApp } from 'vue'
import './styles/tokens.css'
import './styles/fonts.css'
import { useTheme } from './lib/theme'
import { getTagRegistry } from './lib/tagRegistry'
import App from './App.vue'
import router from './router'

// 主题模块级单例尽早建立：data-theme 由 index.html 防闪脚本先行设置，此后由这里接管同步
useTheme()

// 标签注册表启动预载：未就绪期间取色回落 djb2，就绪后 shallowRef 驱动依赖 computed 重渲染修正；
// 失败静默（应用不阻塞，后续调用方 getTagRegistry 会重试）
void getTagRegistry().catch(() => {})

createApp(App).use(router).mount('#app')
