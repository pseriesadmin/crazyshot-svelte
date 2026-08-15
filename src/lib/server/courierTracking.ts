// src/lib/server/courierTracking.ts
// 배송 추적 어댑터 인터페이스 — 1차 구현은 스텁 처리 (API 키 미확보 상태)
//
// 라이브 전환 방법:
//   1. 택배사 API 계약·키 발급 완료 후
//   2. 아래 getTrackingStatus() 함수 내부만 교체하면 됨 (인터페이스 불변)
//   3. $env/static/private에 COURIER_API_KEY 추가 후 실제 HTTP 호출로 대체

export interface TrackingStatus {
  /** 배송 상태 문자열 — 스텁: '연동 준비 중' / 라이브: '집화완료'|'배송중'|'배송완료' 등 */
  status: string
  /** 마지막 업데이트 시각 (ISO 8601) — 스텁: null */
  lastUpdate: string | null
  /** 택배사 상세 추적 URL — 스텁: null */
  detailUrl: string | null
}

/**
 * 택배사 코드와 운송장 번호로 현재 배송 상태를 조회한다.
 *
 * 1차 구현 (스텁):
 *  - courierCode/trackingNumber가 하나라도 없으면 null 반환
 *  - 둘 다 있어도 실제 HTTP 호출 없이 고정 스텁 값 반환
 *
 * 라이브 전환 시 이 함수 내부만 교체:
 *  const COURIER_API_KEY = ... from '$env/static/private'
 *  const res = await fetch(`https://api.smartdelivery.co.kr/...`)
 */
export async function getTrackingStatus(
  courierCode: string | null,
  trackingNumber: string | null,
): Promise<TrackingStatus | null> {
  if (!courierCode || !trackingNumber) return null

  // TODO: API 키 확보 후 아래 스텁을 실제 택배사 API 호출로 교체
  return {
    status: '연동 준비 중',
    lastUpdate: null,
    detailUrl: null,
  }
}
