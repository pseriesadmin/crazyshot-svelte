// 방문배송 정상영업시간(09:00~22:59) vs 영업외시간(23:00~08:59) 판정 공유 유틸.
// 영업외시간 + 수령/반납방식='visit'(방문대여) 조합은 무인보관함 인계로 부분 반영된다
// (DB의 pickup_method/return_method 값 자체는 'visit' 그대로 유지 — service-operations.md 대상).
// /cart(고객 시간선택 UI)와 CMS RentalDetailPanel(관리자 라벨·비밀번호 입력 UI) 양쪽에서
// 동일 로직을 재사용해 판정 기준의 드리프트를 방지한다.
export function isLockerHour(time: string | null | undefined): boolean {
  if (!time) return false
  const h = parseInt(time.slice(0, 2), 10)
  if (Number.isNaN(h)) return false
  return h === 23 || h < 9
}
