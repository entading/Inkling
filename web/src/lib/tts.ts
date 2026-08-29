/**
 * 浏览器 TTS 封装（M6）：原生 Web Speech API，零依赖、服务端零参与。
 * voice 偏好存 localStorage（每浏览器/每设备各自记忆，设计 5.8「音色随设备语音库」），
 * 不走 /api/settings——该接口强校验 body 只含 lanEnabled，且 voice 本就是设备级偏好。
 */

const VOICE_KEY = 'en_tool:tts:voice'

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// ---------- localStorage（try/catch 模式照抄 EditView 草稿，隐私模式静默降级） ----------

export function getSavedVoiceName(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

export function saveVoiceName(name: string): void {
  try {
    localStorage.setItem(VOICE_KEY, name)
  } catch {
    /* 存储不可用时静默跳过，不影响朗读 */
  }
}

export function clearSavedVoice(): void {
  try {
    localStorage.removeItem(VOICE_KEY)
  } catch {
    /* 同上 */
  }
}

// ---------- 语音列表 ----------

let voicesCache: SpeechSynthesisVoice[] | null = null
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

/**
 * 取语音列表。Chrome 首次 getVoices() 常为空（异步就绪），需 onvoiceschanged 后重取；
 * 结果模块级缓存，重复调用不重复请求。列表为空的环境每次都会重试（不缓存空结果）。
 */
export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!isTtsSupported()) return Promise.resolve([])
  if (voicesCache) return Promise.resolve(voicesCache)
  if (voicesPromise) return voicesPromise

  const synth = window.speechSynthesis
  voicesPromise = new Promise((resolve) => {
    let settled = false
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return
      settled = true
      if (voices.length > 0) voicesCache = voices
      voicesPromise = null
      resolve(voices)
    }
    const immediate = synth.getVoices()
    if (immediate.length > 0) {
      finish(immediate)
      return
    }
    // Chrome：语音列表异步就绪后触发 voiceschanged
    synth.addEventListener('voiceschanged', () => finish(synth.getVoices()), { once: true })
    // 兜底：个别环境不派发该事件，超时后取当前值（可能仍为空）
    window.setTimeout(() => finish(synth.getVoices()), 1500)
  })
  return voicesPromise
}

/**
 * 选出生效 voice：localStorage 命中（按 name 匹配）→ 首个 lang === 'en-US' → null。
 * 返回 null 时由 speak() 以 utterance.lang = 'en-US' 兜底——默认美音语义由 lang 保证，
 * 不写死任何 voice 名（不同设备语音库不同）。
 */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const saved = getSavedVoiceName()
  if (saved) {
    const hit = voices.find((v) => v.name === saved)
    if (hit) return hit
  }
  return voices.find((v) => v.lang === 'en-US') ?? null
}

// 模块加载即预热：等用户首次点击时缓存多半已就绪，speak() 同步取列表即可命中
if (isTtsSupported()) {
  void getVoices()
}

/** 朗读一段文本：先 cancel 打断上一段（speechSynthesis 是全局单例，连续点击不叠加） */
export function speak(text: string): void {
  if (!isTtsSupported()) return
  const trimmed = text.trim()
  if (!trimmed) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(trimmed)
  const voice = pickVoice(synth.getVoices())
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else {
    utterance.lang = 'en-US'
  }
  synth.speak(utterance)
}
