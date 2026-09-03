import { shallowRef } from 'vue'
import { api, type FontEntry } from '../api'

/**
 * 阅读排版偏好 + 导入字体客户端（F1）：完全纯前端偏好（/api/settings 强校验只收
 * lanEnabled），三键 localStorage 照 theme/tts 先例：
 *   en_tool:reading-font  ''（默认衬线栈）| 'sans'（无衬线）| 导入字体 id
 *   en_tool:reading-size  sm | md | lg（正文 14.5/17/19px，移动端 14.5/16/17.5）
 *   en_tool:reading-line  tight | normal | loose（1.6/1.8/2.0）
 *
 * 生效机制（三个写入面，改动须同步）：
 * - 字号/行距 → documentElement 的 data-reading-size/line 属性，tokens.css 属性
 *   选择器覆盖 --note-body-size/--note-line-height；index.html 防闪内联脚本读同一
 *   组 localStorage 键先设同款属性（E5：仅字号/行距进防闪，字体族是 webfont 异步
 *   加载无防闪收益），本模块启动时幂等重设并校验合法值。
 * - 字体族 → --font-serif 内联变量栈首插入：默认栈串从 CSSOM 读 tokens.css 的
 *   --font-serif 定义（唯一来源，勿硬编码副本）；'sans' 直接引用 var(--font-sans)。
 * - @font-face → 动态 <style id="dynamic-font-faces">，内容来自 GET /api/fonts/css
 *   聚合，列表变更后重注入（不用 head 静态 link，刷新语义可控）。
 *
 * 列表缓存照 tagRegistry 模式：Promise 缓存 + readingFontsRef shallowRef 镜像 +
 * mutationSeq 乱序守卫；BroadcastChannel（en_tool:reading-font）页签互通知 +
 * focus/visibility 5s 节流重拉，非安全上下文自动降级。
 */

export type ReadingSize = 'sm' | 'md' | 'lg'
export type ReadingLine = 'tight' | 'normal' | 'loose'
/** 正文字体偏好：'' = 默认衬线；'sans' = 无衬线；其余 = 导入字体 id */
export type ReadingFontPref = '' | 'sans' | string
/** 导入字体覆盖范围（F1 追加，用户拍板）：all=全部字符；cjk=仅中文（英文回落默认衬线栈）；
 * latin=仅英文（中文回落思源宋体）。实现 = 服务端按 unicode-range 过滤聚合 CSS，
 * 切换零成本（不分片产物不变）；仅对导入字体有意义，预设时置灰 */
export type ReadingFontScope = 'all' | 'cjk' | 'latin'
/** 另一侧字体（F1 追加方案 B）：scope=cjk|latin 时被导入字体让出的那侧用哪个栈——
 * '' = 默认衬线栈（现状回落）；'sans' = 无衬线栈（var(--font-sans)）。scope=all 时无意义被忽略 */
export type ReadingFallback = '' | 'sans'

const FONT_KEY = 'en_tool:reading-font'
const SIZE_KEY = 'en_tool:reading-size'
const LINE_KEY = 'en_tool:reading-line'
const SCOPE_KEY = 'en_tool:reading-font-scope'
const FALLBACK_KEY = 'en_tool:reading-fallback'

const SIZE_VALUES: readonly ReadingSize[] = ['sm', 'md', 'lg']
const LINE_VALUES: readonly ReadingLine[] = ['tight', 'normal', 'loose']
const SCOPE_VALUES: readonly ReadingFontScope[] = ['all', 'cjk', 'latin']

export const readingFontsRef = shallowRef<FontEntry[]>([])

let listPromise: Promise<FontEntry[]> | null = null
let mutationSeq = 0

function apply(list: FontEntry[]): FontEntry[] {
  readingFontsRef.value = list
  return list
}

export function getReadingFonts(): Promise<FontEntry[]> {
  if (!listPromise) {
    const issuedAt = mutationSeq
    listPromise = api.fonts().then((list) => {
      if (issuedAt === mutationSeq) {
        apply(list)
        void injectFontCss()
        // 死偏好校验：指向已不存在（被他端/他页签删除）的字体 id → 回落默认。
        // 每次真实拉取都会经过这里（缓存命中不走此路，但缓存失效必然重拉），无环：
        // setFontPreference 的广播对端 resync 后校验通过不再广播
        const pref = getFontPreference()
        if (pref && pref !== 'sans' && !list.some((f) => f.id === pref)) {
          setFontPreference('')
        }
      }
      return list
    }).catch((e) => {
      listPromise = null
      throw e
    })
  }
  return listPromise
}

function invalidateReadingFonts(): void {
  listPromise = null
}

/** 失效并重拉（设置页分片轮询/主动刷新用） */
export function refreshReadingFonts(): Promise<FontEntry[]> {
  invalidateReadingFonts()
  return getReadingFonts()
}

/** 导入（轮询到 ready 前 @font-face 不可用；列表本地即时插入 pending 条目） */
export async function importFont(name: string, file: File): Promise<FontEntry> {
  const seq = ++mutationSeq
  const entry = await api.importFont(name, file)
  if (seq === mutationSeq) {
    invalidateReadingFonts()
    readingFontsRef.value = [entry, ...readingFontsRef.value]
    broadcast()
  }
  return entry
}

/** 删除：正在使用的字体偏好自动回落默认；@font-face 注入随之刷新移除 */
export async function deleteFont(id: string): Promise<void> {
  const seq = ++mutationSeq
  await api.deleteFont(id)
  if (seq === mutationSeq) {
    invalidateReadingFonts()
    readingFontsRef.value = readingFontsRef.value.filter((f) => f.id !== id)
    if (getFontPreference() === id) setFontPreference('')
    void injectFontCss()
    broadcast()
  }
}

// ---------- 偏好读写 ----------

export function getFontPreference(): ReadingFontPref {
  try {
    return localStorage.getItem(FONT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setFontPreference(pref: ReadingFontPref): void {
  try {
    localStorage.setItem(FONT_KEY, pref)
  } catch { /* 隐私模式等：本次会话内仍生效 */ }
  applyFontFamily(pref)
  broadcast()
}

export function getSizePreference(): ReadingSize {
  try {
    const v = localStorage.getItem(SIZE_KEY)
    if (v && SIZE_VALUES.includes(v as ReadingSize)) return v as ReadingSize
  } catch { /* 隐私模式 */ }
  return 'md'
}

export function setSizePreference(v: ReadingSize): void {
  try {
    localStorage.setItem(SIZE_KEY, v)
  } catch { /* 隐私模式 */ }
  document.documentElement.dataset.readingSize = v
  broadcast()
}

export function getLinePreference(): ReadingLine {
  try {
    const v = localStorage.getItem(LINE_KEY)
    if (v && LINE_VALUES.includes(v as ReadingLine)) return v as ReadingLine
  } catch { /* 隐私模式 */ }
  return 'normal'
}

export function setLinePreference(v: ReadingLine): void {
  try {
    localStorage.setItem(LINE_KEY, v)
  } catch { /* 隐私模式 */ }
  document.documentElement.dataset.readingLine = v
  broadcast()
}

export function getScopePreference(): ReadingFontScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY)
    if (v && SCOPE_VALUES.includes(v as ReadingFontScope)) return v as ReadingFontScope
  } catch { /* 隐私模式 */ }
  return 'all'
}

export function setScopePreference(v: ReadingFontScope): void {
  try {
    localStorage.setItem(SCOPE_KEY, v)
  } catch { /* 隐私模式 */ }
  // css 注入内容随 scope 变化：直接重注入（fetch 读本函数刚写入的最新 scope）
  void injectFontCss()
  broadcast()
}

export function getFallbackPreference(): ReadingFallback {
  try {
    const v = localStorage.getItem(FALLBACK_KEY)
    if (v === 'sans') return v
    if (v === '') return v
  } catch { /* 隐私模式 */ }
  return ''
}

export function setFallbackPreference(v: ReadingFallback): void {
  try {
    localStorage.setItem(FALLBACK_KEY, v)
  } catch { /* 隐私模式 */ }
  // 另一侧栈拼进 --font-serif：重应用（scope=all 或正文字体非导入时键值保留但不生效）
  applyFontFamily(getFontPreference())
  broadcast()
}

/** 启动应用（main.ts 调用）：与 index.html 防闪脚本同语义，幂等重设 + 非法值修正 */
export function applyReadingPreferencesAtBoot(): void {
  document.documentElement.dataset.readingSize = getSizePreference()
  document.documentElement.dataset.readingLine = getLinePreference()
  applyFontFamily(getFontPreference())
}

/** 栈首插入：导入字体确定性 family（服务端 family = inkling-font-<id>），缺字回落思源宋体分片 */
function applyFontFamily(pref: ReadingFontPref): void {
  const rootStyle = document.documentElement.style
  if (pref === '') {
    rootStyle.removeProperty('--font-serif')
    return
  }
  if (pref === 'sans') {
    rootStyle.setProperty('--font-serif', 'var(--font-sans)')
    return
  }
  const font = readingFontsRef.value.find((f) => f.id === pref)
  const family = font?.family ?? `inkling-font-${pref}`
  // base 必须读 --font-serif-base（tokens.css 拆分的唯一串源）：读 --font-serif 会拿到
  // 自己上次 setProperty 写入的内联污染串（R-3：SPA 连续切换下栈首无限增殖 + 无衬线残留）
  const base = getComputedStyle(document.documentElement).getPropertyValue('--font-serif-base').trim()
  if (!base) {
    // tokens.css 尚未就绪（CSSOM 未含定义）：等 load 后重试（正常时序到不了这里）
    if (document.readyState === 'loading') {
      window.addEventListener('load', () => applyFontFamily(pref), { once: true })
    }
    return
  }
  // 另一侧字体（方案 B）：scope=cjk|latin 时被让出的那侧按 fallback 偏好听栈——
  // '' = 默认衬线栈（现状回落）；'sans' = 无衬线栈。scope=all 时导入字体全量接管，忽略 fallback
  const scope = getScopePreference()
  const tail =
    scope !== 'all' && getFallbackPreference() === 'sans' ? 'var(--font-sans)' : base
  rootStyle.setProperty('--font-serif', `'${family}', ${tail}`)
}

// ---------- @font-face 动态注入 ----------

const DYNAMIC_CSS_ID = 'dynamic-font-faces'

async function injectFontCss(): Promise<void> {
  try {
    // scope 过滤由服务端执行（cjk/latin 分片取舍）；跨页签 scope 同步走
    // broadcast → resync → getReadingFonts 重拉 → 本函数（读彼时最新 scope）
    const res = await fetch(`/api/fonts/css?scope=${getScopePreference()}`)
    const css = res.ok ? await res.text() : ''
    let el = document.getElementById(DYNAMIC_CSS_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = DYNAMIC_CSS_ID
      document.head.appendChild(el)
    }
    el.textContent = css
  } catch {
    /* 服务不可达：保留旧注入内容，下次列表刷新重试 */
  }
}

// ---------- 跨页签同步（tagRegistry 同款：BroadcastChannel + focus/visibility 节流） ----------

let channel: BroadcastChannel | null = null
let lastSyncAt = 0

function resync(): void {
  invalidateReadingFonts()
  void getReadingFonts().catch(() => {})
  // localStorage 跨页签共享：他页签改的偏好在此页签即时重应用
  applyReadingPreferencesAtBoot()
}

try {
  channel = new BroadcastChannel('en_tool:reading-font')
  channel.onmessage = () => resync()
} catch {
  /* 无 BroadcastChannel（局域网 http 非安全上下文等）：仅靠 focus/visibility 重拉 */
}

function broadcast(): void {
  channel?.postMessage(Date.now())
}

function resyncThrottled(): void {
  // focus 与 visibilitychange 切页签时常同时触发，5s 节流防重复拉取
  if (Date.now() - lastSyncAt < 5000) return
  lastSyncAt = Date.now()
  resync()
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', resyncThrottled)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resyncThrottled()
  })
}
