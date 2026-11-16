// 배지 목록 품번 표기 — 배지목록을 만들 때 한 번 부여돼 영구히 고정되는 고유번호(Migration #831). 목록 순서·삭제와 무관.
export function formatBadgeNo(no: number): string {
  return `No.${String(no).padStart(3, '0')}`
}
