import { createApp } from 'vue'
import './styles/tokens.css'
import './styles/fonts.css'
import { useTheme } from './lib/theme'
import { getTagRegistry } from './lib/tagRegistry'
import { applyReadingPreferencesAtBoot, getReadingFonts } from './lib/readingFont'
import App from './App.vue'
import router from './router'

// 主题模块级单例尽早建立：data-theme 由 index.html 防闪脚本先行设置，此后由这里接管同步
useTheme()

// 阅读排版偏好启动应用：字号/行距 data 属性（防闪脚本已设，幂等重设 + 非法值修正）
// + 字体族栈首插入（E5：webfont 异步加载，不进防闪脚本，此处同步应用）
applyReadingPreferencesAtBoot()

// 标签注册表启动预载：未就绪期间取色回落 djb2，就绪后 shallowRef 驱动依赖 computed 重渲染修正；
// 失败静默（应用不阻塞，后续调用方 getTagRegistry 会重试）
void getTagRegistry().catch(() => {})

// 导入字体列表预载：就绪后 readingFontsRef 供设置页列表与 @font-face 动态注入；失败静默可重试
void getReadingFonts().catch(() => {})

createApp(App).use(router).mount('#app')
