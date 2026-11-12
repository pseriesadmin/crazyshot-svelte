/**
 * 장바구니 '예약정보 수정' 모드 순수 로직 (S4).
 * 화면 상태 → edit-order API 본문 변환 · 변경 여부 판정 · 금액 변경 토스트 문구.
 * 서버 쪽 형식 검증(src/lib/server/reservationEditOrder.ts parseEditOrderBody)과 같은 상한을 따른다.
 * ($lib/server 는 브라우저 코드에서 import 할 수 없어 상수만 복제 — cartEditMode.test.ts 가 서버 검증 통과를 확인한다.)
 */

export interface EditLineOption {
  optionProductId: string | null
  name: string
  qty: number
}

/** 줄 1개의 '값' — 변경 여부 판정과 새 줄 본문 생성의 기준 */
export interface EditLineValues {
  startDate: string
  endDate: string
  pickupMethod: string | null
  returnMethod: string | null
  pickupTime: string | null
  returnTime: string | null
  durationType: string | null
  pickupAddressRoad: string | null
  pickupAddressDetail: string | null
  pickupPostalCode: string | null
  returnAddressRoad: string | null
  returnAddressDetail: string | null
  returnPostalCode: string | null
  pickupRequestNote: string | null
  returnRequestNote: string | null
  pickupPointId: string | null
  returnPointId: string | null
  frontdoorPassword: string | null
  qty: number
  options: EditLineOption[]
}

export interface EditLineInput {
  /** 화면 줄 식별자(삭제 보류 집합과 대조) */
  key: string
  /** 새 줄로 보낼 때의 상품 id */
  productId: string | null
  /** 이 줄에 속한 실제 예약 id(문자열) — 수정 대상 주문의 예약만 */
  reservationIds: string[]
  /** 지금 화면 값 */
  current: EditLineValues
  /** 수정 모드 진입 시점의 값 — 없으면(새로 담은 줄) 항상 '바뀐 줄' */
  original: EditLineValues | null
}

export type EditOrderLine = Record<string, unknown>

const MAX_LINES = 50
const MAX_COUPONS = 20
const MAX_STRING = 500
const INT32_MAX = 2147483647
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const norm = (v: string | null | undefined): string => (v ?? '').trim()

function normOptions(options: EditLineOption[]): string {
  return options
    .filter((o) => o.qty > 0)
    .map((o) => `${norm(o.optionProductId) || `n:${norm(o.name)}`}x${o.qty}`)
    .sort()
    .join('|')
}

/**
 * 변경 여부 판정 — 날짜·수령/반납 방식·시간·주소(우편번호 포함)·요청사항·지점·공동현관·요금 유형·수량·옵션 중 하나라도 다르면 '바뀐 줄'.
 * 문자열은 앞뒤 공백·null/빈값 차이를 무시하고, 옵션은 순서·수량 0 항목을 무시한다.
 */
export function isEditLineChanged(line: EditLineInput): boolean {
  const o = line.original
  if (!o) return true
  const c = line.current
  const strKeys = [
    'startDate', 'endDate', 'pickupMethod', 'returnMethod', 'pickupTime', 'returnTime', 'durationType',
    'pickupAddressRoad', 'pickupAddressDetail', 'pickupPostalCode',
    'returnAddressRoad', 'returnAddressDetail', 'returnPostalCode',
    'pickupRequestNote', 'returnRequestNote', 'pickupPointId', 'returnPointId', 'frontdoorPassword',
  ] as const
  for (const k of strKeys) {
    if (norm(c[k]) !== norm(o[k])) return true
  }
  if (c.qty !== o.qty) return true
  return normOptions(c.options) !== normOptions(o.options)
}

const clip = (s: string): string => s.slice(0, MAX_STRING)

function buildNewLine(productId: string | null, v: EditLineValues): EditOrderLine {
  const out: EditOrderLine = {}
  const put = (key: string, value: string | null | undefined): void => {
    const t = norm(value)
    if (t) out[key] = clip(t)
  }
  if (productId) out.product_id = productId
  put('start_date', v.startDate)
  put('end_date', v.endDate)
  put('duration_type', v.durationType)
  put('pickup_method', v.pickupMethod)
  put('return_method', v.returnMethod)
  put('pickup_time', v.pickupTime)
  put('return_time', v.returnTime)
  put('pickup_address_road', v.pickupAddressRoad)
  put('pickup_address_detail', v.pickupAddressDetail)
  put('pickup_postal_code', v.pickupPostalCode)
  put('return_address_road', v.returnAddressRoad)
  put('return_address_detail', v.returnAddressDetail)
  put('return_postal_code', v.returnPostalCode)
  put('pickup_request_note', v.pickupRequestNote)
  put('return_request_note', v.returnRequestNote)
  put('pickup_point_id', v.pickupPointId)
  put('return_point_id', v.returnPointId)
  put('frontdoor_password', v.frontdoorPassword)
  const options = v.options
    .filter((op) => op.qty > 0 && norm(op.optionProductId))
    .map((op) => ({ option_product_id: norm(op.optionProductId), option_name: clip(norm(op.name)), qty: op.qty }))
  if (options.length > 0) out.options = options
  return out
}

/**
 * 장바구니 줄 → edit-order lines.
 * 삭제 보류 줄(줄 key 또는 소속 예약 id 가 집합에 있음)은 제외 → 서버가 목록에서 빠진 기존 예약을 취소 처리한다.
 * 변경 없는 기존 줄은 예약 id 마다 {keep:true, reservation_id}, 바뀐 줄·새 줄은 새 줄 필드(수량만큼 반복).
 */
export function buildEditOrderLines(lines: EditLineInput[], deletedIds: ReadonlySet<string>): EditOrderLine[] {
  const out: EditOrderLine[] = []
  for (const line of lines) {
    if (deletedIds.has(line.key) || line.reservationIds.some((id) => deletedIds.has(id))) continue
    if (!isEditLineChanged(line)) {
      for (const id of line.reservationIds) {
        const n = Number(id)
        if (Number.isInteger(n) && n > 0) out.push({ keep: true, reservation_id: n })
      }
      continue
    }
    const count = Math.max(1, Math.floor(line.current.qty) || 1)
    // 옵션은 장바구니 그룹 합계 수량이므로 첫 줄에만 싣는다(수량만큼 반복되는 줄마다 싣으면 옵션이 줄 수 배로 불어난다)
    for (let i = 0; i < count; i += 1) {
      const row = buildNewLine(line.productId, line.current)
      if (i > 0) delete row.options
      out.push(row)
    }
  }
  return out
}

export interface EditOrderBody {
  reservationId: number
  expectedReservationIds: number[]
  lines: EditOrderLine[]
  selectedCouponIds: string[]
  selectedPoints: number
}

export interface BuildEditOrderBodyArgs {
  reservationId: string | number
  expectedReservationIds: Array<string | number>
  lines: EditOrderLine[]
  selectedCouponIds: Iterable<string>
  selectedPoints: number
}

const toPositiveInt = (v: string | number): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 && n <= INT32_MAX ? n : null
}

/** edit-order API 본문 — 서버 parseEditOrderBody 형식(숫자 id·UUID 쿠폰·상한)에 맞춘다 */
export function buildEditOrderBody(args: BuildEditOrderBodyArgs): EditOrderBody {
  const expected = [...new Set(args.expectedReservationIds.map(toPositiveInt).filter((n): n is number => n !== null))].sort((a, b) => a - b)
  const coupons = [...new Set([...args.selectedCouponIds].filter((c) => UUID_RE.test(c)))].slice(0, MAX_COUPONS)
  const pts = Number.isFinite(args.selectedPoints) ? Math.min(Math.max(Math.floor(args.selectedPoints), 0), INT32_MAX) : 0
  return {
    reservationId: toPositiveInt(args.reservationId) ?? 0,
    expectedReservationIds: expected,
    lines: args.lines.slice(0, MAX_LINES),
    selectedCouponIds: coupons,
    selectedPoints: pts,
  }
}

const won = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`

/** 저장 직후 토스트 — '기존 N원 → 새 M원'. 기존 금액을 모르면 새 금액만, 새 금액을 모르면 null */
export function formatAmountChangedToast(previous: number | null, next: number | null): string | null {
  if (next === null || !Number.isFinite(next)) return null
  if (previous === null || !Number.isFinite(previous)) return `새 ${won(next)}`
  return `기존 ${won(previous)} → 새 ${won(next)}`
}
