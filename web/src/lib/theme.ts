import { computed, watch } from 'vue'
import { useLocalStorage, useMediaQuery } from '@vueuse/core'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/** 偏好 key 精确约定（勿改）：en_tool:theme ∈ system/light/dark，默认 system */
const THEME_KEY = 'en_tool:theme'
const TRANSITION_CLASS = 'theme-transitioning'
/** 略长于 --duration-base(200ms)，保证过渡跑完再摘类 */
const TRANSITION_MS = 240

const THEME_VALUES: readonly ThemePreference[] = ['system', 'light', 'dark']

// 模块级单例（项目无 Pinia）：任意处 import 拿到同一份状态
const stored = useLocalStorage<ThemePreference>(THEME_KEY, 'system')
const systemDark = useMediaQuery('(prefers-color-scheme: dark)')

/** 存储里出现非法值（手改/旧数据）时一律回落 system，不进解析逻辑 */
const preference = computed<ThemePreference>(() =>
  THEME_VALUES.includes(stored.value) ? stored.value : 'system',
)

const resolved = computed<ResolvedTheme>(() => {
  if (preference.value === 'system') return systemDark.value ? 'dark' : 'light'
  return preference.value
})

let transitionTimer: number | undefined

/** 写偏好并触发一次全局平滑过渡（reduced-motion 由 tokens.css 的媒体查询守卫兜底） */
function setPreference(next: ThemePreference): void {
  const html = document.documentElement
  window.clearTimeout(transitionTimer)
  html.classList.add(TRANSITION_CLASS)
  transitionTimer = window.setTimeout(() => html.classList.remove(TRANSITION_CLASS), TRANSITION_MS)
  stored.value = next
}

// resolved 任何变化（含 system 态跟随系统）即时写 DOM；index.html 防闪脚本已先设过同一值，此处幂等
watch(
  resolved,
  (theme) => {
    document.documentElement.dataset.theme = theme
  },
  { immediate: true },
)

export function useTheme() {
  return { preference, resolved, setPreference }
}
