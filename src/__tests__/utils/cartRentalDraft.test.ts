import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { CART_DRAFT_TTL_MS, cartDraftKey, isDraftEmpty, parseDraft, serializeDraft, type CartRentalDraftInput } from '$lib/utils/cartRentalDraft'

const NOW = 1_800_000_000_000
const FULL: CartRentalDraftInput = {
  rentalMethod: 'visit', returnMethod: 'visit', rentalDate: '2026-12-01', rentalTime: '10:00', returnDate: '2026-12-03', returnTime: '18:00',
  rentalPointId: 'pt-1', returnPointId: 'pt-1', rentalMemberCheck: true, rentalMemberCheck2: false, returnMemberCheck: false, returnMemberCheck2: false,
}

describe('cartRentalDraft — 대여예약옵션 임시 보관', () => {
  it('저장한 값을 그대로 되살린다', () => {
    const back = parseDraft(serializeDraft(FULL, NOW), NOW + 1000)
    expect(back).toMatchObject(FULL)
  })

  it('개인 정보(이름·전자메일·전화·주소·요청사항·공동현관)는 저장 항목에 아예 없다', () => {
    const json = serializeDraft(FULL, NOW)
    for (const k of ['name', 'email', 'phone', 'addr', 'postal', 'notes', 'frontdoor']) expect(json.toLowerCase()).not.toContain(`"${k}`)
  })

  it('24시간이 지나면 버린다, 미래 시각·깨진 JSON·다른 버전도 버린다', () => {
    expect(parseDraft(serializeDraft(FULL, NOW), NOW + CART_DRAFT_TTL_MS + 1)).toBeNull()
    expect(parseDraft(serializeDraft(FULL, NOW + 10 * 60_000), NOW)).toBeNull()
    expect(parseDraft('{not json', NOW)).toBeNull()
    expect(parseDraft(JSON.stringify({ v: 2, savedAt: NOW, rentalDate: '2026-12-01' }), NOW)).toBeNull()
    expect(parseDraft(null, NOW)).toBeNull()
  })

  it('허용 형식 밖의 값(스크립트·이상한 날짜·시간)은 빈 값으로 정리한다', () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW, rentalMethod: '<script>', rentalDate: '2026/12/01', rentalTime: '9am', returnDate: '2026-12-03', rentalPointId: 'a b', returnPointId: 'ok_id-1' })
    const d = parseDraft(raw, NOW)
    expect(d).toMatchObject({ rentalMethod: null, rentalDate: '', rentalTime: '', returnDate: '2026-12-03', rentalPointId: '', returnPointId: 'ok_id-1' })
  })

  it('모든 값이 비어 있으면 보관하지 않는다(null)', () => {
    const empty: CartRentalDraftInput = { rentalMethod: null, returnMethod: null, rentalDate: '', rentalTime: '', returnDate: '', returnTime: '', rentalPointId: '', returnPointId: '', rentalMemberCheck: false, rentalMemberCheck2: false, returnMemberCheck: false, returnMemberCheck2: false }
    expect(isDraftEmpty(empty)).toBe(true)
    expect(parseDraft(serializeDraft(empty, NOW), NOW)).toBeNull()
  })

  it('사용자별 키(다른 사용자의 설정이 섞이지 않는다)', () => {
    expect(cartDraftKey('u1')).not.toBe(cartDraftKey('u2'))
  })
})

describe('장바구니 배선', () => {
  const cart = readFileSync('src/routes/cart/+page.svelte', 'utf-8')
  it('수정 모드에서는 불러오기·저장을 하지 않고, 주문 접수 성공 시 보관값을 지운다', () => {
    expect(cart).toContain('data.isEditMode')
    expect(cart).toContain('clearRentalDraft()')
    expect(cart).toContain("from '$lib/utils/cartRentalDraft'")
  })
})
