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
  /** 취소일시(YYYY-MM-DD HH:mm:ss) — 취소돼도 status 는 그대로(0)라 취소 여부는 이 값으로만 판단한다(2026-10-27 dev 실험) */
  canceledAt?: string | null
  canceledReason?: string | null
  receiverDongGroupName?: string | null
  orderIdFromCorp?: string | null
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

/** 두발히어로 응답 대기 상한(ms) — 상대가 멈춰도 함수 제한시간까지 매달리지 않는다(알려진 이슈 #6). 접수는 예약코드로 재조회해 이어받으므로(createDelivery) 시간 초과 뒤 재시도해도 중복되지 않는다 */
export const DHERO_FETCH_TIMEOUT_MS = 20000

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
      signal: AbortSignal.timeout(DHERO_FETCH_TIMEOUT_MS),
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

/** 고객 요청 메모 상한(안내서 memoFromCustomer 100자 — 운송장에 인쇄된다) */
export const DHERO_MEMO_MAX = 100

/** 메모를 100자(글자 기준)로 자르고 앞뒤 공백을 지운다. 비면 undefined */
export function clipDheroMemo(text: string | null | undefined): string | undefined {
  const t = (text ?? '').trim()
  if (!t) return undefined
  return Array.from(t).slice(0, DHERO_MEMO_MAX).join('')
}

/** 공동현관 비밀번호 상한(안내서 frontdoorPassword 50자 — 운송장 미인쇄·라이더앱 전용) */
export const DHERO_FRONTDOOR_MAX = 50

/** 공동현관 출입번호를 50자(글자 기준)로 자르고 앞뒤 공백을 지운다. 비면 undefined */
export function clipDheroFrontdoor(text: string | null | undefined): string | undefined {
  const t = (text ?? '').trim()
  if (!t) return undefined
  return Array.from(t).slice(0, DHERO_FRONTDOOR_MAX).join('')
}

/** 예약코드로 접수 이력 조회 — GET /deliveries/order-id-from-corps/{orderIdFromCorp}. 응답은 { rows: [...] }(접수가 없으면 빈 배열, 2026-10-27 dev 확인) */
export async function findDeliveriesByOrderId(orderIdFromCorp: string): Promise<DheroDeliveryStatus[]> {
  let res: { rows?: DheroDeliveryStatus[] } | DheroDeliveryStatus[]
  try {
    res = await dheroFetch<{ rows?: DheroDeliveryStatus[] } | DheroDeliveryStatus[]>('GET', `/deliveries/order-id-from-corps/${encodeURIComponent(orderIdFromCorp)}`)
  } catch (e) {
    // 운영 서버가 이력이 없을 때 404 를 줄 수 있다(dev 는 200 {rows:[]}) — 이력 없음으로 본다. 그 밖의 오류는 던진다(접수 전체가 멈추는 fail-closed: 중복 접수보다 낫다)
    if (e instanceof DheroApiError && e.statusCode === 404) return []
    throw e
  }
  const rows = Array.isArray(res) ? res : res?.rows
  return Array.isArray(rows) ? rows : []
}

/** 접수 이력 조회 상한 — 같은 예약코드의 취소·재접수가 이만큼 반복되면 더 이어붙이지 않고 마지막 번호를 쓴다 */
const MAX_ORDER_ID_ATTEMPTS = 10

/**
 * 배송접수 — POST /deliveries
 * 성공 시 bookId(운송장 번호) 반환.
 *
 * 두발히어로는 같은 주문번호(orderIdFromCorp)로 다시 접수하면(print:'r') 이전 접수를 그대로 돌려주는데,
 * 그 이전 접수가 **취소된 건이어도** 취소된 접수번호를 돌려준다(2026-10-27 dev 실험 R4) — 취소 후 재접수가 성공처럼 보이지만 실제로는 취소된 건이 된다.
 * 그래서 접수 전에 예약코드(와 재접수용 번호 `예약코드-2`, `-3` …)로 이력을 조회한다:
 *   · 살아 있는 접수가 있으면 새로 접수하지 않고 그 번호를 이어받는다(응답 유실·시간 초과 뒤 재시도·DB 초기화 후 재접수 중복 방지) — reused:true
 *   · 이력이 전부 취소됐으면 다음 번호(`예약코드-N`)로 새로 접수한다
 *   · 이력이 없으면 예약코드 그대로 접수한다
 * print:'r' 은 그대로 둔다(조회와 접수 사이 경합에서 같은 번호로 접수되면 이전 접수를 돌려줘 중복을 막는다).
 */
export async function createDelivery(params: {
  receiverName: string
  receiverMobile: string
  receiverAddress: string
  receiverAddressDetail: string
  receiverAddressPostalCode: string
  productName: string
  orderIdFromCorp: string
  // memoFromCustomer: 고객 요청사항(운송장에 인쇄됨) — 100자로 자른다(clipDheroMemo)
  memoFromCustomer?: string | null
  // frontdoorPassword: 공동현관 출입번호(운송장 미인쇄·라이더앱 전용, 50자) — 장바구니 전용 입력칸 pickup_frontdoor_password(Migration #774)
  frontdoorPassword?: string | null
}): Promise<DheroDeliveryResponse & { reused?: boolean }> {
  const { spotCode } = getCredentials()
  const { memoFromCustomer, frontdoorPassword, orderIdFromCorp: baseOrderId, ...rest } = params
  const memo = clipDheroMemo(memoFromCustomer)
  const frontdoor = clipDheroFrontdoor(frontdoorPassword)

  let orderId: string | null = null
  for (let n = 1; n <= MAX_ORDER_ID_ATTEMPTS; n++) {
    const candidate = n === 1 ? baseOrderId : `${baseOrderId}-${n}`
    const history = await findDeliveriesByOrderId(candidate)
    const active = history.find((d) => !d.canceledAt)
    if (active) {
      return {
        bookId: active.bookId,
        orderIdFromCorp: candidate,
        dongGroup: active.receiverDongGroupName ?? null,
        addressNotSupported: Boolean(active.addressNotSupported),
        placePageUrl: active.placePageUrl ?? null,
        reused: true,
      }
    }
    if (history.length === 0) { orderId = candidate; break } // 이 번호는 아직 쓰인 적이 없다 — 이 번호로 접수
  }
  if (orderId === null) {
    throw new DheroApiError(`같은 예약코드(${baseOrderId})로 접수·취소가 ${MAX_ORDER_ID_ATTEMPTS}번 반복돼 더 접수할 수 없습니다. 두발히어로 콘솔에서 확인해 주세요.`, 409)
  }

  return dheroFetch<DheroDeliveryResponse>('POST', '/deliveries', {
    spotCode,
    ...rest,
    orderIdFromCorp: orderId,
    ...(memo ? { memoFromCustomer: memo } : {}),
    ...(frontdoor ? { frontdoorPassword: frontdoor } : {}),
    print: 'r', // 조회~접수 사이 경합 방어 — 같은 번호면 이전 접수를 돌려준다
  })
}

/**
 * 배송조회 — GET /deliveries/{bookId}
 */
export async function getDeliveryByBookId(bookId: string): Promise<DheroDeliveryStatus> {
  return dheroFetch<DheroDeliveryStatus>('GET', `/deliveries/${encodeURIComponent(bookId)}`)
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
