// offHoursTime.ts — 질문 속 시각을 공식 영업시간과 비교해 "영업 외 시간"이면 표식 단어를 붙인다 (순수 함수, 서버 전용)
//
// 왜 필요한가: 빠른답변 매처(matchCannedResponse)는 "11시" 같은 숫자 표현을 질문 핵심 단어에서 제외한다(날짜·수량 표현 필터).
//   그래서 "밤 11시에 대여 가능해요?"는 일반어("대여")만 남아 어떤 답변과도 매칭되지 않았다.
//   여기서 시각을 직접 읽어 영업시간 밖이면 표식 단어(OFF_HOURS_MARKER)를 질문 끝에 붙이고, 영업 외 안내 FAQ가 그 단어를 키워드로 가진다.
//
// 공식 영업시간: 오전 09:00 ~ 오후 10:00 (빠른답변 '운영시간 안내'·상담 가능 시간과 같음). [09:00, 22:00) 이 영업 중이다.
// 판정하는 표현: ① 오전/오후/새벽/아침/저녁/밤/낮 + N시(M분) ② 13~24시·0시 ③ HH:MM. 오전/오후가 불명확한 "10시"는 판정하지 않는다(오탐 방지).

export const OFFICE_OPEN_HOUR = 9
export const OFFICE_CLOSE_HOUR = 22
/** 영업 외 시각이 감지됐을 때 질문 끝에 붙이는 표식. 다른 FAQ 키워드와 겹치지 않는 고유 단어여야 한다. */
export const OFF_HOURS_MARKER = '영업외시간대'

export interface ClockTime { hour: number; minute: number }

/** 영업시간 밖인지: [OPEN:00, CLOSE:00) 이 영업 중. 24시(=1440분)와 0시는 영업 외. */
export function isOutsideOfficeHours(hour: number, minute: number): boolean {
  const t = hour * 60 + minute
  return t < OFFICE_OPEN_HOUR * 60 || t >= OFFICE_CLOSE_HOUR * 60
}

type Prefix = '오전' | '오후' | '새벽' | '아침' | '저녁' | '밤' | '낮'

/** 시간대 말머리 + 12시간제 시각 → 24시간제 시. 확정 불가면 null. */
function toHour24(prefix: Prefix | undefined, h: number): number | null {
  if (h < 0 || h > 24) return null
  if (!prefix) return h === 0 || h >= 13 ? h : null // 접두어 없는 1~12시는 오전/오후를 알 수 없다
  switch (prefix) {
    case '오전': return h === 12 ? 0 : h
    case '오후': return h < 12 ? h + 12 : h
    case '새벽': return h === 12 ? 0 : h
    case '아침': return h
    case '저녁': return h < 12 ? h + 12 : h
    case '낮': return h < 12 && h !== 0 ? (h >= 11 ? h : h + 12) : h
    case '밤': return h === 12 ? 0 : h >= 6 && h < 12 ? h + 12 : h
  }
}

const PREFIX_RE = '(오전|오후|새벽|아침|저녁|밤|낮)'
// N시(M분) — "24시간"·"12시간" 같은 기간 표현은 제외
// 숫자 앞 경계(?<!\d): "100시"가 뒤의 "00시"(0시)로 읽히는 오탐 방지(QA 마이너 1)
const KOREAN_CLOCK = new RegExp(`(?:${PREFIX_RE}\\s*)?(?<!\\d)(\\d{1,2})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분)?`, 'g')
// HH:MM — 앞에 오전/오후 말머리가 붙을 수 있다
const COLON_CLOCK = new RegExp(`(?:${PREFIX_RE}\\s*)?(?<![\\d:])(\\d{1,2}):([0-5]\\d)(?![\\d:])`, 'g')

/** 실재하는 시각만 담는다: 분은 0~59, 24시는 분이 0일 때만("24:30"·"24시 30분"은 비정상 — QA 마이너 2). */
function pushValidClock(out: ClockTime[], hour: number | null, minute: number): void {
  if (hour === null || minute < 0 || minute > 59) return
  if (hour === 24 && minute !== 0) return
  out.push({ hour, minute })
}

/** 질문에서 "확정되는" 시각만 추출한다. */
export function extractClockHours(message: string): ClockTime[] {
  const out: ClockTime[] = []
  if (!message) return out
  for (const m of message.matchAll(KOREAN_CLOCK)) {
    pushValidClock(out, toHour24(m[1] as Prefix | undefined, Number(m[2])), m[3] ? Number(m[3]) : 0)
  }
  for (const m of message.matchAll(COLON_CLOCK)) {
    const raw = Number(m[2])
    pushValidClock(out, m[1] ? toHour24(m[1] as Prefix, raw) : raw <= 24 ? raw : null, Number(m[3]))
  }
  return out
}

// 단어형 영업 외 표현. "밤"은 한 글자라 매처가 버리므로 여기서 직접 읽는다(앞 글자가 한글이면 "율밤" 같은 단어라 제외).
const OFF_HOURS_WORD_RE = /새벽|심야|한밤|밤늦|늦은\s*(?:밤|시간)|이른\s*아침|아침\s*일찍|자정|야간|영업\s*시간\s*(?:외|이후|종료\s*후|이외)|영업\s*(?:끝난|종료\s*후)|(?<![가-힣])밤(?:중에?|에|이)(?![가-힣])/
// "새벽 촬영", "야간 촬영용 렌즈", "새벽배송" 처럼 시간대가 촬영·배송의 수식어인 문장은 영업 외 이용 질문이 아니다.
const OFF_HOURS_WORD_EXCLUDE_RE = /촬영|배송|영상|사진|야경|별\s*사진/

/** 단어형 영업 외 표현("새벽에", "심야에", "영업시간 외에" 등)이 있는지. 촬영·배송 맥락이면 false. */
export function hasOffHoursWord(message: string): boolean {
  if (!message) return false
  return OFF_HOURS_WORD_RE.test(message) && !OFF_HOURS_WORD_EXCLUDE_RE.test(message)
}

/** 영업 외 시각 또는 단어형 표현이 있으면 질문 끝에 표식을 붙여 돌려준다. 없거나 애매하면 원문 그대로. */
export function withOffHoursMarker(message: string): string {
  if (!message || message.includes(OFF_HOURS_MARKER)) return message
  const outsideClock = extractClockHours(message).some((t) => isOutsideOfficeHours(t.hour, t.minute))
  return outsideClock || hasOffHoursWord(message) ? `${message} ${OFF_HOURS_MARKER}` : message
}
