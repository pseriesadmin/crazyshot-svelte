// chatChime.ts — 새 채팅 알림 '딩동' 소리 (2026-10-20, Stephen 지시)
// 음원 파일 없이 브라우저 오디오(Web Audio)로 맑은 종소리 '딩동'(2026-10-20 Stephen 선택 — 높은 '딩' → 낮은 '동', 긴 여운)을 만든다. 실패해도 화면 동작에는 영향이 없다(fail-soft).
// 브라우저 정책상 사용자가 화면을 한 번도 누르지 않았다면 소리가 막힐 수 있다 — 이 경우 조용히 건너뛴다.

const LAST_KEY = 'cms-chat-chime-at'
/** 같은 시각 가까이 열린 여러 탭이 동시에 울리거나, 연속 도착으로 소리가 겹치는 것을 막는 최소 간격 */
export const CHIME_MIN_GAP_MS = 700

/** 최근 소리 재생 시각(lastAt)과 지금(now)을 비교해 재생해도 되는지 판단 — 순수 함수 */
export function shouldPlayChime(now: number, lastAt: number | null): boolean {
  if (lastAt === null || !Number.isFinite(lastAt)) return true
  return now - lastAt >= CHIME_MIN_GAP_MS || now < lastAt
}

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? ('webkitAudioContext' in window ? (window.webkitAudioContext as typeof AudioContext) : undefined)
      if (!Ctor) return null
      ctx = new Ctor()
    }
    return ctx
  } catch {
    return null
  }
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, peak: number): void {
  // 기본음(사인파) + 종의 비정수 배음(약 2.76배, 아주 작게)을 겹쳐 금속 종 같은 맑은 여운을 만든다
  for (const [mul, vol, len] of [[1, 1, 1], [2.76, 0.12, 0.45]] as const) {
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * mul, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peak * vol, start + 0.01) // 종을 치는 순간 — 빠른 어택
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur * len) // 길게 사라지는 여운(배음은 더 빨리 사라짐)
    osc.connect(gain).connect(ac.destination)
    osc.start(start)
    osc.stop(start + dur * len + 0.05)
  }
}

let primed = false

/** 브라우저는 사용자가 화면을 누르기 전에는 소리를 막는다 — 첫 클릭·키 입력 때 오디오를 미리 깨워 두어, 나중에 알림이 올 때 바로 울리게 한다(여러 번 불러도 한 번만 등록). */
export function primeChatChime(): void {
  if (primed || typeof window === 'undefined') return
  primed = true
  const wake = () => {
    const ac = getContext()
    if (ac && ac.state === 'suspended') void ac.resume().catch(() => {})
    if (ac && ac.state === 'running') {
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
  }
  window.addEventListener('pointerdown', wake)
  window.addEventListener('keydown', wake)
}

function schedule(ac: AudioContext): void {
  const t = ac.currentTime + 0.02
  // 맑은 종소리 '딩동' — 높은 '딩'(레6) → 0.3초 뒤 낮은 '동'(라5), 여운은 약 1.5초
  tone(ac, 1174.7, t, 1.3, 0.28)
  tone(ac, 880, t + 0.3, 1.5, 0.28)
}

/** 알림 소리 재생. 재생을 시작했으면 true, 건너뛰었으면(최근 재생·소리 막힘 등) false */
export function playChatChime(): boolean {
  try {
    const now = Date.now()
    let last: number | null = null
    try {
      const raw = localStorage.getItem(LAST_KEY)
      last = raw ? Number(raw) : null
    } catch { /* 저장소를 못 읽어도 재생은 계속 */ }
    if (!shouldPlayChime(now, last)) return false

    const ac = getContext()
    if (!ac || ac.state === 'closed') return false

    if (ac.state === 'suspended') {
      // 아직 깨어나지 않았다면 깨운 뒤 재생 — 브라우저가 거절하면(화면을 한 번도 누르지 않은 경우) 조용히 건너뛰고 기록도 남기지 않는다
      void ac.resume().then(() => {
        if (ac.state !== 'running') return
        try { localStorage.setItem(LAST_KEY, String(Date.now())) } catch { /* 무시 */ }
        schedule(ac)
      }).catch(() => {})
      return true
    }

    try { localStorage.setItem(LAST_KEY, String(now)) } catch { /* 무시 */ }
    schedule(ac)
    return true
  } catch {
    return false
  }
}
