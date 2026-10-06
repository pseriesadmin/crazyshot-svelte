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
