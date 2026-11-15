// 배지 색상 보조 — HEX 검증·배경색 대비 글자색·KST 날짜 변환

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

export function isHexColor(v: string): boolean {
  return HEX_RE.test(v)
}

/** 배경색 위에서 읽히는 글자색(밝은 배경이면 짙은 글자, 아니면 흰색) */
export function badgeTextColor(bg: string): string {
  if (!isHexColor(bg)) return '#FFFFFF'
  const r = parseInt(bg.slice(1, 3), 16)
  const g = parseInt(bg.slice(3, 5), 16)
  const b = parseInt(bg.slice(5, 7), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#100B32' : '#FFFFFF'
}

/** 'YYYY-MM-DD'(KST) → 그날 시작/끝 timestamptz. 빈 값은 null */
export function kstDateToIso(date: string, edge: 'start' | 'end'): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return edge === 'start' ? `${date}T00:00:00+09:00` : `${date}T23:59:59+09:00`
}

/** timestamptz → KST 'YYYY-MM-DD'. 빈 값은 '' */
export function isoToKstDate(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
