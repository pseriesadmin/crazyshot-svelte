// src/lib/utils/deliveryCarrierMethods.ts
// 배송송출연동 관리 — 배송업체 연동 칩에 보여줄 대여 방식 선택 (2026-10-27, Stephen 지시)
//
// 배송업체(현재 두발히어로) 연동은 배송형(is_delivery_type) 방식에서만 의미가 있다. 방문·퀵·무인보관함 칩까지 보이면
// 잘못 켤 수 있으므로 배송형 방식만 칩으로 보여준다. 단, 이미 켜져 있는 방식은 배송형 지정이 풀렸더라도 계속 보여
// "켜진 채 화면에서 사라져 끌 수 없는" 상태가 생기지 않게 한다.
// 제휴 배송업체가 늘면 업체마다 같은 함수를 자기 켜짐 판정(isOn)으로 호출한다.

export function carrierVisibleMethods<T extends { is_delivery_type: boolean }>(
  methods: readonly T[],
  isOn: (m: T) => boolean,
): T[] {
  return methods.filter((m) => m.is_delivery_type || isOn(m))
}
