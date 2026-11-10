// 상담 응대시간 안내 — 채팅창 노출 문구 + 자동 노출 시간대 규칙 (2026-11-10, Stephen 지시)
// CMS 푸시알림 설정 '상담 응대시간' 탭(저장)과 고객 채팅창(노출 판정)이 같은 규칙을 쓴다. 순수 함수 — 서버·화면 공용.

export const CONSULT_NOTICE_MAX = 50

// 한글(완성형·자모) + 영문 + 숫자 + 특수문자(공백 포함 ASCII 인쇄 문자). 줄바꿈·이모지·기타 문자는 불가.
const DISALLOWED_CHARS = /[^ -~ㄱ-ㆎ가-힣]/g
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface ConsultHours {
  message: string
  /** 'HH:MM' (KST, 24시간제) */
  start: string
  end: string
}

/** 입력 중 허용되지 않는 글자를 즉시 걸러내고 50자로 자른다. */
export function sanitizeConsultNotice(raw: string): string {
  return raw.replace(DISALLOWED_CHARS, '').slice(0, CONSULT_NOTICE_MAX)
}

export function isValidConsultTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v)
}

export function timeToMinutes(v: string): number {
  const m = TIME_RE.exec(v)
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
}

export type ConsultHoursValidation = { ok: true; value: ConsultHours } | { ok: false; error: string }

/** 저장 값 검증(화면·서버 공통). 문구가 비어 있으면 '설정 삭제'이므로 호출 전에 따로 처리한다. */
export function validateConsultHours(input: { message: unknown; start: unknown; end: unknown }): ConsultHoursValidation {
  if (typeof input.message !== 'string') return { ok: false, error: '노출 문구가 올바르지 않습니다.' }
  const message = input.message.trim()
  if (message === '') return { ok: false, error: '노출 문구를 입력해 주세요.' }
  if (message.length > CONSULT_NOTICE_MAX) return { ok: false, error: `노출 문구는 ${CONSULT_NOTICE_MAX}자 이내로 입력해 주세요.` }
  if (sanitizeConsultNotice(message) !== message) return { ok: false, error: '노출 문구는 한글·영문·숫자·특수문자만 입력할 수 있습니다.' }
  if (!isValidConsultTime(input.start) || !isValidConsultTime(input.end)) return { ok: false, error: '시작·종료 시각을 선택해 주세요.' }
  if (input.start === input.end) return { ok: false, error: '시작과 종료 시각은 서로 달라야 합니다.' }
  return { ok: true, value: { message, start: input.start, end: input.end } }
}

/** 저장소(cms_settings.value)에서 읽은 값을 안전하게 해석한다. 형식이 어긋나면 null(= 설정 없음). */
export function parseConsultHours(raw: unknown): ConsultHours | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const v = validateConsultHours({ message: r.message, start: r.start, end: r.end })
  return v.ok ? v.value : null
}

/**
 * 지금(minutesOfDay, KST 기준 0~1439)이 노출 시간대 안인지. [start, end) 구간이며 종료가 시작보다 이르면 자정을 넘기는 구간이다(예: 22:00~09:00).
 */
export function isWithinConsultWindow(minutesOfDay: number, start: string, end: string): boolean {
  const s = timeToMinutes(start)
  const e = timeToMinutes(end)
  if (s < 0 || e < 0 || s === e) return false
  return s < e ? minutesOfDay >= s && minutesOfDay < e : minutesOfDay >= s || minutesOfDay < e
}

/** 한국 시각(KST) 기준 현재 시각의 분 단위 값. */
export function kstMinutesOfDay(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

/** 지금 채팅창에 보여줄 문구. 설정이 없거나 시간대 밖이면 null. */
export function activeConsultNotice(cfg: ConsultHours | null, now: Date = new Date()): string | null {
  if (!cfg) return null
  return isWithinConsultWindow(kstMinutesOfDay(now), cfg.start, cfg.end) ? cfg.message : null
}
