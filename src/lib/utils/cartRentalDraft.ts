// 장바구니 '대여예약옵션'(수령·반납 방법·일시·방문지점·회원정보 반영 체크) 임시 보관 — 2026-11-13 Stephen 지시.
// 상품 목록은 서버에 남아 있지만 이 설정은 화면 안에만 있어, 장바구니를 나갔다 다시 들어오면 모두 사라지던 불편을 줄인다.
// ⛔ 안전 원칙: ① 이름·전자메일·전화·주소·공동현관 번호·요청사항 같은 개인 정보는 저장하지 않는다(다시 들어오면 '회원정보 반영' 체크만 기억해 회원 정보로 다시 채운다)
//   ② 사용자(userId)별 키로 보관하고 24시간이 지나면 버린다 ③ 불러올 때 현재 화면 규칙(보이는 방식·마감·최대 기간·방문지점)으로 다시 검증하고, 서버가 이미 가진 값이 있으면 덮어쓰지 않는다
//   ④ 예약신청이 접수되면 지운다. 서버의 최종 검증(create_reservation_order 등)은 그대로 거치므로 이 보관값은 편의일 뿐 권한·금액에 영향이 없다.

export const CART_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export interface CartRentalDraft {
  v: 1
  savedAt: number
  rentalMethod: string | null
  returnMethod: string | null
  rentalDate: string
  rentalTime: string
  returnDate: string
  returnTime: string
  rentalPointId: string
  returnPointId: string
  rentalMemberCheck: boolean
  rentalMemberCheck2: boolean
  returnMemberCheck: boolean
  returnMemberCheck2: boolean
}

export type CartRentalDraftInput = Omit<CartRentalDraft, 'v' | 'savedAt'>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const METHOD_RE = /^[a-z0-9_-]{1,40}$/i
const ID_RE = /^[\w-]{1,64}$/

export function cartDraftKey(userId: string): string {
  return `cs_cart_rental_draft_v1:${userId}`
}

export function isDraftEmpty(d: CartRentalDraftInput): boolean {
  return !d.rentalMethod && !d.returnMethod && !d.rentalDate && !d.rentalTime && !d.returnDate && !d.returnTime &&
    !d.rentalPointId && !d.returnPointId && !d.rentalMemberCheck && !d.rentalMemberCheck2 && !d.returnMemberCheck && !d.returnMemberCheck2
}

export function serializeDraft(input: CartRentalDraftInput, now: number): string {
  const d: CartRentalDraft = { v: 1, savedAt: now, ...input }
  return JSON.stringify(d)
}

function str(value: unknown, re: RegExp): string {
  return typeof value === 'string' && re.test(value) ? value : ''
}

/** 저장된 문자열을 검증해 되살린다. 형식이 어긋나거나 24시간이 지났거나 미래 시각이면 null. 허용 형식 밖의 값은 빈 값으로 정리한다. */
export function parseDraft(raw: string | null | undefined, now: number): CartRentalDraft | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (o.v !== 1 || typeof o.savedAt !== 'number') return null
  if (o.savedAt > now + 60_000 || now - o.savedAt > CART_DRAFT_TTL_MS) return null
  const method = (value: unknown): string | null => (typeof value === 'string' && METHOD_RE.test(value) ? value : null)
  const draft: CartRentalDraft = {
    v: 1,
    savedAt: o.savedAt,
    rentalMethod: method(o.rentalMethod),
    returnMethod: method(o.returnMethod),
    rentalDate: str(o.rentalDate, DATE_RE),
    rentalTime: str(o.rentalTime, TIME_RE),
    returnDate: str(o.returnDate, DATE_RE),
    returnTime: str(o.returnTime, TIME_RE),
    rentalPointId: str(o.rentalPointId, ID_RE),
    returnPointId: str(o.returnPointId, ID_RE),
    rentalMemberCheck: o.rentalMemberCheck === true,
    rentalMemberCheck2: o.rentalMemberCheck2 === true,
    returnMemberCheck: o.returnMemberCheck === true,
    returnMemberCheck2: o.returnMemberCheck2 === true,
  }
  return isDraftEmpty(draft) ? null : draft
}
