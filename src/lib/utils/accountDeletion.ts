// 회원 삭제·탈퇴 공통 — 차단 사유 문구 (Migration #763, 2026-10-24)
// DB의 private.account_deletion_blockers가 돌려주는 코드를 화면에 보여줄 문구로 바꾼다. 코드 목록은 DB와 같아야 한다.
// 서버(CMS 삭제 액션)와 화면(본인 탈퇴)이 함께 쓰므로 $lib/utils에 둔다.
export const ACCOUNT_DELETION_BLOCKER_LABELS: ReadonlyMap<string, string> = new Map([
  ['active_rental', '진행 중인 대여'],
  ['return_inspection', '반납 후 검수·이슈가 끝나지 않은 대여'],
  ['active_subscription', '이용 중인 구독'],
])

export function describeDeletionBlockers(codes: unknown): string {
  const list = Array.isArray(codes) ? codes.map(String) : []
  return list.map((c) => ACCOUNT_DELETION_BLOCKER_LABELS.get(c) ?? c).join(', ')
}
