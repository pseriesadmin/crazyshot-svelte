// 반납 일시(반납일 + 반납시각, KST) 도래 판정 — DB private.rental_return_due(Migration #735)와 같은 규칙이어야 한다.
// 반납시각이 없거나 형식 오류면 18:00, 24:00은 그날 끝(반납일 당일에는 아직 도래 전)으로 본다.
export function isReturnDue(endDate: string | null | undefined, returnTime: string | null | undefined, now: Date = new Date()): boolean {
  const day = (endDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  const today = kst.toISOString().slice(0, 10)
  if (day < today) return true
  if (day > today) return false
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(returnTime ?? '')
  const dueMin = m ? Number(m[1]) * 60 + Number(m[2]) : 18 * 60
  return kst.getUTCHours() * 60 + kst.getUTCMinutes() >= dueMin
}
