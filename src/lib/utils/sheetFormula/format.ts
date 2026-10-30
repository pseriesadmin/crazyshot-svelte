/**
 * format.ts — 수식 결과의 표시 형식(숫자·날짜) 처리 (2026-10-29)
 *
 * 엑셀은 날짜를 "일련번호"(1899-12-30 기준 일수)로 저장하고 서식으로 보여 준다. 우리 칸 값은 보이는 글자라서, 수식이 날짜 칸을
 * 참조하면 글자("2026.10.19")를 일련번호로 되돌려 계산하고 결과를 칸의 서식으로 다시 글자로 만든다.
 */
import * as XLSX from 'xlsx'

const DAY_MS = 86_400_000
const EPOCH = Date.UTC(1899, 11, 30)

/** 날짜 → 엑셀 일련번호 */
export function dateToSerial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS)
}

/** 엑셀 일련번호 → {y,m,d} (UTC 기준) */
export function serialToDate(serial: number): { y: number; m: number; d: number } {
  const dt = new Date(EPOCH + Math.floor(serial) * DAY_MS)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

/** 보이는 날짜 글자("2026.10.19", "2026-10-19", "2026/10/19", "2026년 10월 19일") → 일련번호. 날짜가 아니면 null */
export function parseDateText(text: string): number | null {
  const m = /^\s*(\d{4})\s*(?:[./-]|년)\s*(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})\s*일?\s*$/.exec(text)
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const serial = dateToSerial(y, mo, d)
  const back = serialToDate(serial)
  return back.y === y && back.m === mo && back.d === d ? serial : null
}

/**
 * 엑셀 내장 서식 번호 중 나라·언어마다 달라지는 27~33번의 한국어 판 표시 형식(엑셀 한국어 판 기준으로 추정한 값).
 * 라이브러리는 이 번호를 미국식으로 풀어 버려(m/d/yy) 한국어 파일의 날짜가 달라 보인다.
 */
export const KOREAN_BUILTIN_FORMATS: Record<number, string> = {
  27: 'yyyy"년" mm"월"',
  28: 'mm"월" dd"일"',
  29: 'mm"월" dd"일"',
  30: 'mm-dd-yy',
  31: 'yyyy"년" mm"월" dd"일"',
  32: 'hh"시" mm"분"',
  33: 'hh"시" mm"분" ss"초"',
}

/** 서식 코드가 날짜/시간 서식인지(따옴표·대괄호 안 글자는 제외하고 y m d h s 가 있는지) */
export function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt) return false
  const stripped = fmt.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  return /[ymdhs]/i.test(stripped)
}

/** 숫자를 서식으로 표시. 서식이 없거나 해석 실패 시 "일반" 서식(최대 15자리) */
export function formatNumber(n: number, fmt?: string): string {
  if (!Number.isFinite(n)) return '#NUM!'
  if (fmt && fmt.toLowerCase() !== 'general') {
    try {
      return XLSX.SSF.format(fmt, n)
    } catch {
      /* 아래 일반 서식으로 */
    }
  }
  const rounded = Number(n.toPrecision(15))
  return String(rounded)
}
