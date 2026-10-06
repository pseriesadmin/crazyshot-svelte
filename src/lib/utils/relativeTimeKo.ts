/** ISO 시각 → "방금 전 / N분 전 / N시간 전 / N일 전 / 날짜" (크레이지로그 목록 relativeTime과 동일 규칙) */
export function formatRelativeTimeKo(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff  = now - t
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins  <  1) return '방금 전'
  if (hours <  1) return `${mins}분 전`
  if (days  <  1) return `${hours}시간 전`
  if (days  < 30) return `${days}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}
