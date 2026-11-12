/** 신청대기 예약 '예약 수정' 저장 API(edit-order)의 순수 헬퍼 — 본문 검증·reason 매핑·응답 정리 (Migration 811) */

export interface EditOrderInput {
  reservationId: number
  expectedReservationIds: number[]
  lines: Record<string, unknown>[]
  selectedCouponIds: string[] | null
  selectedPoints: number | null
}

const MAX_LINES = 50
const MAX_COUPONS = 20

const INT32_MAX = 2147483647
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LINES_JSON_LENGTH = 65536
const MAX_LINE_KEYS = 40
const MAX_STRING_LENGTH = 500
const MAX_NESTING_DEPTH = 4

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= INT32_MAX
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 줄 객체(깊이 1)의 키 수·문자열 길이·중첩 깊이 상한 검사 — 객체·배열 컨테이너가 깊이 4단계를 넘으면 거절 */
function isWithinLineLimits(value: unknown, depth: number): boolean {
  if (typeof value === 'string') return value.length <= MAX_STRING_LENGTH
  const isArr = Array.isArray(value)
  if (!isArr && !isPlainObject(value)) return true
  if (depth > MAX_NESTING_DEPTH) return false
  const children = isArr ? value : Object.values(value as Record<string, unknown>)
  if (children.length > MAX_LINE_KEYS) return false
  return children.every((child) => isWithinLineLimits(child, depth + 1))
}

/** 본문 형식 검증 — 실패하면 null */
export function parseEditOrderBody(body: unknown): EditOrderInput | null {
  if (!isPlainObject(body)) return null
  const { reservationId, expectedReservationIds, lines, selectedCouponIds, selectedPoints } = body
  if (!isPositiveInt(reservationId)) return null
  if (!Array.isArray(expectedReservationIds) || expectedReservationIds.length === 0 || expectedReservationIds.length > MAX_LINES) return null
  if (!expectedReservationIds.every(isPositiveInt)) return null
  if (!Array.isArray(lines) || lines.length > MAX_LINES || !lines.every(isPlainObject)) return null
  if (JSON.stringify(lines).length > MAX_LINES_JSON_LENGTH) return null
  if (!lines.every((line) => isWithinLineLimits(line, 1))) return null

  let coupons: string[] | null = null
  if (selectedCouponIds !== undefined && selectedCouponIds !== null) {
    if (!Array.isArray(selectedCouponIds) || selectedCouponIds.length > MAX_COUPONS) return null
    if (!selectedCouponIds.every((c): c is string => typeof c === 'string' && UUID_RE.test(c))) return null
    coupons = selectedCouponIds
  }
  let points: number | null = null
  if (selectedPoints !== undefined && selectedPoints !== null) {
    if (typeof selectedPoints !== 'number' || !Number.isInteger(selectedPoints) || selectedPoints < 0 || selectedPoints > INT32_MAX) return null
    points = selectedPoints
  }
  return { reservationId, expectedReservationIds, lines, selectedCouponIds: coupons, selectedPoints: points }
}

export interface EditOrderFailure {
  status: number
  error: string
}

const NOT_EDITABLE = (why: string): EditOrderFailure => ({ status: 409, error: why })
const BAD = (why: string): EditOrderFailure => ({ status: 400, error: why })
const GENERIC_FAILURE: EditOrderFailure = { status: 500, error: '예약 수정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }

const FAILURES: Record<string, EditOrderFailure> = {
  // 편집 불가·낡은 화면(409)
  STALE: NOT_EDITABLE('예약 내용이 바뀌었어요. 화면을 새로 열어 다시 수정해 주세요.'),
  SIGNED: NOT_EDITABLE('계약서에 서명한 예약은 예약 수정을 할 수 없어요.'),
  PAID: NOT_EDITABLE('결제가 진행된 예약은 예약 수정을 할 수 없어요.'),
  CANCEL_REQUESTED: NOT_EDITABLE('취소를 요청한 예약은 예약 수정을 할 수 없어요.'),
  EXPIRED: NOT_EDITABLE('신청 시간이 지나 만료된 예약은 예약 수정을 할 수 없어요.'),
  DIRECT_PAY: NOT_EDITABLE('바로 결제를 시작한 주문은 예약 수정을 할 수 없어요.'),
  NOT_HOLD: NOT_EDITABLE('신청대기 상태의 예약만 예약 수정을 할 수 있어요.'),
  // 재고 충돌(사용자가 기간·상품을 바꿔 다시 시도 가능)
  HOLD_FAILED: NOT_EDITABLE('선택한 기간에 예약할 수 있는 재고가 없어요. 기간이나 상품을 바꿔 주세요.'),
  OPTION_STOCK_EXCEEDED: NOT_EDITABLE('옵션 재고가 부족해요. 수량을 줄여 주세요.'),
  HOLIDAY_EXTENSION_CONFLICT: NOT_EDITABLE('휴무일로 늘어나는 대여 기간에 재고가 이미 다른 예약에 배정되어 있어요.'),
  BUNDLE_HOLIDAY_EXTENSION_CONFLICT: NOT_EDITABLE('휴무일로 늘어나는 대여 기간에 구성품 재고가 이미 다른 예약에 배정되어 있어요.'),
  // 권한
  NOT_OWNER: { status: 403, error: '본인의 예약만 수정할 수 있어요.' },
  UNAUTHENTICATED: { status: 401, error: '로그인이 필요해요.' },
  // 입력·검증(400)
  BAD_REQUEST: BAD('요청 내용이 올바르지 않아요. 내용을 확인해 주세요.'),
  MIN_ONE_LINE: BAD('상품이 최소 1개는 있어야 해요.'),
  SALE_ONLY_NOT_EDITABLE: BAD('구매 상품이 포함된 예약은 예약 수정을 할 수 없어요.'),
  INVALID_METHOD: BAD('사용할 수 없는 수령·반납 방식이 포함되어 있어요.'),
  INVALID_TIME: BAD('수령·반납 시간이 올바르지 않아요. 시간을 확인해 주세요.'),
  PRICE_UNSET: BAD('요금이 등록되지 않은 상품이 있어 저장할 수 없어요.'),
  OPTION_DELIVERY_DISABLED: BAD('배송이 불가능한 옵션이 포함되어 있어요. 수령·반납 방식을 바꿔 주세요.'),
  OPTION_NOT_LINKED: BAD('이 상품에 연결되지 않은 옵션이 포함되어 있어요.'),
  COUPON_STACKING_NOT_ALLOWED: BAD('함께 사용할 수 없는 쿠폰이 포함되어 있어요.'),
  RETURN_DELIVERY_RESTRICTED: BAD('반납 방식으로 배송을 선택할 수 없어요.'),
  OUT_OF_DELIVERY_AREA: BAD('배송 가능 지역이 아니에요. 주소를 확인해 주세요.'),
  FRONTDOOR_PASSWORD_TOO_LONG: BAD('공동현관 출입번호가 너무 길어요.'),
  RETURN_ADDRESS_TOO_LONG: BAD('반납 주소가 너무 길어요.'),
  RETURN_POSTAL_CODE_TOO_LONG: BAD('우편번호가 올바르지 않아요.'),
  // 수령 마감·최대 대여일 — Migration 817 부터 편집 RPC 가 새 줄에 대해 이 reason 을 낸다(유지 줄은 검사 제외)
  PICKUP_LEAD_TIME: BAD('선택한 수령 시각은 수령 신청 마감이 지나 선택할 수 없어요. 수령 시각을 바꿔 주세요.'),
  RENTAL_PERIOD_EXCEEDED: BAD('최대 대여 기간을 넘었어요. 대여 기간을 줄여 주세요.'),
  // 서버 쪽 사유(500) — 고객이 고칠 수 없음
  ERROR: GENERIC_FAILURE,
  CANCEL_FAILED: GENERIC_FAILURE,
  DELIVERY_FEE_FAILED: { status: 500, error: '배송비를 계산하지 못했어요. 잠시 후 다시 시도해 주세요.' },
}

/** RPC 실패 reason → HTTP 상태 + 고객용 문구. 모르는 reason은 500 일반 문구 */
export function mapEditOrderFailure(reason: unknown): EditOrderFailure {
  if (typeof reason === 'string' && Object.hasOwn(FAILURES, reason)) return FAILURES[reason]
  return GENERIC_FAILURE
}

export const EDIT_ORDER_GENERIC_FAILURE = GENERIC_FAILURE

export interface EditOrderSuccess {
  success: true
  reservation_ids: number[]
  reservation_code: string | null
  previous_final_amount: number | null
  final_amount: number | null
  delivery_fee: number | null
  total_amount: number | null
  dropped_coupons: Record<string, string | number>[]
  message: string | null
  /** 응답에는 싣지 않는다 — 서버 후처리(로그)용 */
  cancelledReservationIds: number[]
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const DROPPED_COUPON_KEYS = ['userCouponId', 'user_coupon_id', 'name', 'reason'] as const
const sanitizeDroppedCoupons = (v: unknown): Record<string, string | number>[] => {
  if (!Array.isArray(v)) return []
  const out: Record<string, string | number>[] = []
  for (const item of v) {
    if (!isPlainObject(item)) continue
    const copy: Record<string, string | number> = {}
    for (const key of DROPPED_COUPON_KEYS) {
      const val = item[key]
      if (typeof val === 'string' || (typeof val === 'number' && Number.isFinite(val))) copy[key] = val
    }
    out.push(copy)
  }
  return out
}
const idList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)) : [])

/** RPC 결과를 해석한다 — 성공이면 화이트리스트 필드만, 실패면 매핑된 오류 */
export function interpretEditOrderResult(data: unknown): { ok: true; value: EditOrderSuccess } | { ok: false; failure: EditOrderFailure } {
  if (!isPlainObject(data)) return { ok: false, failure: GENERIC_FAILURE }
  if (data.success !== true) return { ok: false, failure: mapEditOrderFailure(data.reason) }
  return {
    ok: true,
    value: {
      success: true,
      reservation_ids: idList(data.reservation_ids),
      reservation_code: typeof data.reservation_code === 'string' ? data.reservation_code : null,
      previous_final_amount: numOrNull(data.previous_final_amount),
      final_amount: numOrNull(data.final_amount),
      delivery_fee: numOrNull(data.delivery_fee),
      total_amount: numOrNull(data.total_amount),
      dropped_coupons: sanitizeDroppedCoupons(data.dropped_coupons),
      message: typeof data.message === 'string' ? data.message : null,
      cancelledReservationIds: idList(data.cancelled_reservation_ids),
    },
  }
}
