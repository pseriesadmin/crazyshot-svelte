/**
 * kstDate.ts — 한국시간(KST, UTC+9) 기준 날짜·시각 문자열 헬퍼 (순수 함수)
 *
 * 서버가 어떤 타임존에서 실행되든(로컬 KST든 Vercel의 UTC든) 같은 결과를 내도록
 * Intl·로컬 getter에 의존하지 않고 UTC 오프셋(+9h)만 더한 뒤 UTC getter로 읽는다.
 * 한국은 서머타임이 없어 고정 오프셋으로 충분하다.
 */

const KST_OFFSET_MS = 9 * 3_600_000

function toKstParts(value: string | Date | null | undefined): {
  y: string; m: string; d: string; hh: string; mm: string
} | null {
  if (value == null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const k = new Date(date.getTime() + KST_OFFSET_MS)
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return {
    y: String(k.getUTCFullYear()),
    m: p2(k.getUTCMonth() + 1),
    d: p2(k.getUTCDate()),
    hh: p2(k.getUTCHours()),
    mm: p2(k.getUTCMinutes()),
  }
}

/** 순간(ISO 문자열·Date)을 KST 날짜 "YYYY.MM.DD"로. 잘못된 값은 '-'. */
export function formatKstDateDot(value: string | Date | null | undefined): string {
  const p = toKstParts(value)
  return p ? `${p.y}.${p.m}.${p.d}` : '-'
}

/** 순간(ISO 문자열·Date)을 KST "YYYY.MM.DD HH:mm"(24시간)으로. 잘못된 값은 '-'. */
export function formatKstDateTimeDot(value: string | Date | null | undefined): string {
  const p = toKstParts(value)
  return p ? `${p.y}.${p.m}.${p.d} ${p.hh}:${p.mm}` : '-'
}

/** 순간(ISO 문자열·Date)을 KST 날짜 "YYYY-MM-DD"로. 잘못된 값은 빈 문자열(입력 칸·확인 화면용). */
export function formatKstDateDash(value: string | Date | null | undefined): string {
  const p = toKstParts(value)
  return p ? `${p.y}-${p.m}-${p.d}` : ''
}

const KST_DATE_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/
const KST_TIME_PART_RE = /^\d{1,2}$/

/**
 * 시간대 표시가 없는 한국시간 문자열("2026-04-11 19:13:29", "2026.09.11", "2026/09/11 08:30")을 정확한 시각(ISO, UTC)으로 바꾼다.
 * 서버의 시간대(로컬 KST든 Vercel UTC든)와 무관하게 항상 한국시간(UTC+9)으로 해석한다 — new Date("2026-04-11 19:13:29")는
 * 서버 시간대를 따라 UTC 서버에서 9시간 뒤로 저장되던 결함(레거시 회원 CSV 가입 시각, 2026-10-29)의 원인이다.
 * 이미 시간대(Z·+09:00)가 붙은 ISO 문자열은 그대로 존중한다. 빈 값·잘못된 값·존재하지 않는 날짜는 null(오류를 던지지 않음).
 */
export function kstLocalToIso(value: string | null | undefined): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null

  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  const parts = s.split(/[ T]+/)
  if (parts.length > 2) return null
  const m = KST_DATE_RE.exec(parts[0])
  if (!m) return null
  const t = parts.length === 2 ? parts[1].split(':') : null
  if (t && ((t.length !== 2 && t.length !== 3) || !t.every((x) => KST_TIME_PART_RE.test(x)) || t[1].length !== 2 || (t[2] !== undefined && t[2].length !== 2))) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const hh = t ? Number(t[0]) : 0
  const mm = t ? Number(t[1]) : 0
  const ss = t && t[2] !== undefined ? Number(t[2]) : 0
  if (hh > 23 || mm > 59 || ss > 59) return null

  const utcMs = Date.UTC(y, mo - 1, d, hh, mm, ss)
  const check = new Date(utcMs)
  // 2026-02-30 처럼 존재하지 않는 날짜는 Date 가 다음 달로 넘기므로 되읽어 같은지 확인한다
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  return new Date(utcMs - KST_OFFSET_MS).toISOString()
}
