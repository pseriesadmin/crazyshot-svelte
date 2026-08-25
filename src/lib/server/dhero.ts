// src/lib/server/dhero.ts
// 두발히어로(dhero) 배송사 API 클라이언트
// 인증: Bearer 토큰 + spotCode(출발지 코드)
// 테스트: https://partner-api.dev.dhero.kr
// 운영:   https://partner-api.prod.dhero.kr
//
// 패턴: 토스페이먼츠 클라이언트(payment/confirm)와 동일하게
//   - $env/dynamic/private 전용 (클라이언트 번들 노출 절대 금지)
//   - 네트워크 오류(fetch throw) vs API 4xx 오류(statusCode+message) 구분 처리
//   - 모든 호출부에서 try/catch fail-soft 감싸기를 강제 (이 모듈은 throw만 함)

import { env } from '$env/dynamic/private'
export { DHERO_STATUS_LABEL } from '$lib/utils/dheroLabels'

// ── 에러 타입 ────────────────────────────────────────────────────────────────

export class DheroApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'DheroApiError'
  }
}

export class DheroNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DheroNetworkError'
  }
}

// ── 응답 타입 ────────────────────────────────────────────────────────────────

export interface DheroDeliveryResponse {
  bookId: string
  dongGroup: string | null
  addressNotSupported: boolean
  refinedAddress?: string
  refinedAddressDetail?: string
  refinedPostalCode?: string
  // PDF 스펙: 배송접수 응답에도 placePageUrl이 포함될 수 있음(수령희망위치 등록 URL)
  // 채팅 알림(dhero_place_guide)에 활용 — 없으면 null/undefined로 알림 생략(fail-soft)
  placePageUrl?: string | null
  [key: string]: unknown
}

export interface DheroDeliveryStatus {
  bookId: string
  status: number // 0=예약 1=수거배차 2=수거완료 3=입고 4=출고 5=배송완료 6=반송완료 7=분실 8=배송대기 12=배송연기
  statusText?: string
  deliveryRiderName?: string | null
  deliveryRiderMobile?: string | null
  placePageUrl?: string | null
  reviewUrl?: string | null
  problemUrl?: string | null
  deliveredPageUrl?: string | null
  sentBackReason?: string | null
  lostReason?: string | null
  delayedDeliveries?: Array<{ reason: string; [key: string]: unknown }>
  pickupScheduledAt?: string | null
  pickupCompletedAt?: string | null
  warehousingAt?: string | null
  deliveryStartedAt?: string | null
  deliveryCompletedAt?: string | null
  [key: string]: unknown
}

export interface DheroTrackingDetail {
  status: string // PICKUP_SCHEDULED | PICKUP_COMPLETED | WAREHOUSED | DELIVERY_STARTED | DELIVERY_COMPLETED | DELIVERY_RETURNED | DELIVERY_LOST | DELIVERY_CANCELED
  riderName?: string | null
  riderMobile?: string | null
  processedAt?: string | null
  [key: string]: unknown
}

export interface DheroTrackingResponse {
  deliveryStatus: string
  trackingDetails: DheroTrackingDetail[]
}

export interface DheroAddressValidateResponse {
  valid: boolean
  dongGroup?: string | null
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

function getCredentials(): { baseUrl: string; token: string; spotCode: string } {
  const baseUrl  = env.DHERO_API_BASE_URL
  const token    = env.DHERO_TOKEN
  const spotCode = env.DHERO_SPOT_CODE

  if (!baseUrl || !token || !spotCode) {
    throw new DheroNetworkError('두발히어로 환경변수가 설정되지 않았습니다(DHERO_API_BASE_URL/DHERO_TOKEN/DHERO_SPOT_CODE)')
  }
  return { baseUrl, token, spotCode }
}

async function dheroFetch<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const { baseUrl, token } = getCredentials()
  const url = `${baseUrl}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new DheroNetworkError(`두발히어로 API 네트워크 오류: ${msg}`)
  }

  if (response.status === 201 || response.ok) {
    // 204 No Content 처리
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  let errMsg = `두발히어로 API 오류 (HTTP ${response.status})`
  let errCode: string | undefined
  try {
    const errBody = await response.json() as { message?: string; code?: string; error?: string }
    errMsg = errBody.message ?? errBody.error ?? errMsg
    errCode = errBody.code
  } catch {
    // JSON 파싱 실패 시 기본 메시지 유지
  }
  throw new DheroApiError(errMsg, response.status, errCode)
}

// ── 공개 API 함수 ────────────────────────────────────────────────────────────

/**
 * 배송접수 — POST /deliveries
 * 성공 시 bookId(운송장 번호) 반환.
 * print:'r' — 동일 orderIdFromCorp 중복 접수 시 기존 데이터 반환(EC-4 중복접수 방지).
 */
export async function createDelivery(params: {
  receiverName: string
  receiverMobile: string
  receiverAddress: string
  receiverAddressDetail: string
  receiverAddressPostalCode: string
  productName: string
  orderIdFromCorp: string
  // PDF 선택 필드 — memoFromCustomer: rental_reservations.notes(고객 요청사항) 매핑
  // frontdoorPassword: rental_reservations.locker_password는 무인보관함(locker) 전용 필드라
  //   일반 두발히어로 배송의 공동현관비밀번호에 재사용하는 것은 의미적으로 부적절하다.
  //   현재 일반 배송용 공동현관비밀번호를 수집하는 DB 컬럼이 없으며, 고객 입력 UI도 없다.
  //   신규 컬럼 도입 시 마이그레이션 + cart/account UI 변경이 동반되므로, 이번 스코프에서는
  //   생략하고 API에 보내지 않는다(두발히어로 API는 이 필드를 선택으로 처리).
  //   향후 별도 아젠다로 notes 또는 신규 컬럼을 통해 수집 후 연동 가능.
  memoFromCustomer?: string | null
}): Promise<DheroDeliveryResponse> {
  const { spotCode } = getCredentials()
  const { memoFromCustomer, ...rest } = params
  return dheroFetch<DheroDeliveryResponse>('POST', '/deliveries', {
    spotCode,
    ...rest,
    ...(memoFromCustomer ? { memoFromCustomer } : {}),
    print: 'r', // 중복접수 시 기존 데이터 반환 (PDF 명세 활용)
  })
}

/**
 * 배송조회 — GET /deliveries/{bookId}
 */
export async function getDeliveryByBookId(bookId: string): Promise<DheroDeliveryStatus> {
  return dheroFetch<DheroDeliveryStatus>('GET', `/deliveries/${encodeURIComponent(bookId)}`)
}

/**
 * 예약코드로 배송조회 — GET /deliveries/order-id-from-corps/{orderIdFromCorp}
 */
export async function getDeliveryByOrderId(orderIdFromCorp: string): Promise<DheroDeliveryStatus> {
  return dheroFetch<DheroDeliveryStatus>('GET', `/deliveries/order-id-from-corps/${encodeURIComponent(orderIdFromCorp)}`)
}

/**
 * 배송취소 — PUT /deliveries/{bookId}/cancel
 * 취소 가능 범위: 접수/수거지정/수거완료/입고/배송배차까지(배송출발 이후 412 반환).
 */
export async function cancelDelivery(bookId: string): Promise<void> {
  await dheroFetch<void>('PUT', `/deliveries/${encodeURIComponent(bookId)}/cancel`)
}

/**
 * 반품등록 — POST /deliveries/{bookId}/return
 * 같은 bookId로 복수 반품 접수 가능(R, 1R, 2R 순차 부여).
 * 취소/사고/분실완료 상태는 반품 불가.
 */
export async function registerReturn(bookId: string): Promise<DheroDeliveryResponse> {
  return dheroFetch<DheroDeliveryResponse>('POST', `/deliveries/${encodeURIComponent(bookId)}/return`)
}

/**
 * 배송이력(트래킹) 조회 — GET /deliveries/{bookId}/tracking
 */
export async function getTracking(bookId: string): Promise<DheroTrackingResponse> {
  return dheroFetch<DheroTrackingResponse>('GET', `/deliveries/${encodeURIComponent(bookId)}/tracking`)
}

/**
 * 배송가능 유효주소 조회 — POST /address/validate
 * forceRefine 생략(우편번호 있으므로 필요 없음 — GATE B Q1(b) 확정: Daum 우편번호로 실제값 확보).
 */
export async function validateAddress(params: {
  address: string
  postalCode: string
}): Promise<DheroAddressValidateResponse> {
  return dheroFetch<DheroAddressValidateResponse>('POST', '/address/validate', params)
}

// ── dhero_status 코드 → 사람이 읽을 수 있는 텍스트 변환 ─────────────────────
// DHERO_STATUS_LABEL은 src/lib/utils/dheroLabels.ts에서 단일 정의 후 위에서 re-export.
// 기존 importers(dhero/+server.ts, +page.server.ts 등)는 이 파일에서 계속 import 가능.
// 클라이언트 코드(RentalDetailPanel.svelte)는 $lib/utils/dheroLabels에서 직접 import.

/** 두발히어로 상태 코드가 "종료 상태"인지 판별 (cron 스킵 대상) */
export function isDheroTerminalStatus(statusCode: number | null | undefined): boolean {
  if (statusCode === null || statusCode === undefined) return false
  return [5, 6, 7].includes(statusCode) // 배송완료·반송완료·분실완료
}
