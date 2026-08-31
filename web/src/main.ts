import { createApp } from 'vue'
import './styles/tokens.css'
import './styles/fonts.css'
import { useTheme } from './lib/theme'
import App from './App.vue'
import router from './router'

// 主题模块级单例尽早建立：data-theme 由 index.html 防闪脚本先行设置，此后由这里接管同步
useTheme()

createApp(App).use(router).mount('#app')
