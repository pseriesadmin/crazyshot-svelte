import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { firstCartSubmitBlocker, firstCartSubmitBlockerTarget, type CartSubmitBlockerInput } from '$lib/utils/cartSubmitBlocker'

const OK: CartSubmitBlockerInput = {
  hasItems: true, methodInvalid: false,
  rentalDateMissing: false, rentalTimeMissing: false, returnDateMissing: false, returnTimeMissing: false,
  rentalPointMissing: false, returnPointMissing: false, rentalFormMissing: [], returnFormMissing: [],
  deadlineOk: true, priceUnset: false, agreed: true,
}

describe('firstCartSubmitBlocker — 제출을 막는 첫 항목 안내', () => {
  it('막는 항목이 없으면 null', () => {
    expect(firstCartSubmitBlocker(OK)).toBeNull()
  })

  it('수령일만 고르고 반납일이 비면 "반납일을 선택해주세요." (달력이 닫혀 반납일을 못 누른 경우)', () => {
    expect(firstCartSubmitBlocker({ ...OK, returnDateMissing: true })).toBe('반납일을 선택해주세요.')
  })

  it('화면 위→아래 순서: 수령(방법→수령일→시간→고객정보→지점→주소) → 반납(같은 순서) → 마감 → 요금 → 약관', () => {
    const all: CartSubmitBlockerInput = {
      hasItems: true, methodInvalid: true, rentalDateMissing: true, rentalTimeMissing: true,
      returnDateMissing: true, returnTimeMissing: true, rentalPointMissing: true, returnPointMissing: true,
      rentalFormMissing: ['이름', '기본주소'], returnFormMissing: ['이름'], deadlineOk: false, priceUnset: true, agreed: false,
    }
    const expected: Array<[Partial<CartSubmitBlockerInput>, string]> = [
      [{ methodInvalid: false }, '수령일을 선택해주세요.'],
      [{ rentalDateMissing: false }, '수령 시간을 선택해주세요.'],
      [{ rentalTimeMissing: false }, '수령 이름, 주소를 입력해주세요.'],
      [{ rentalFormMissing: ['기본주소'] }, '수령 방문지점을 선택해주세요.'],
      [{ rentalPointMissing: false }, '수령 주소를 입력해주세요.'],
      [{ rentalFormMissing: [] }, '반납일을 선택해주세요.'],
      [{ returnDateMissing: false }, '반납 시간을 선택해주세요.'],
      [{ returnTimeMissing: false }, '반납 이름을 입력해주세요.'],
      [{ returnFormMissing: [] }, '반납 방문지점을 선택해주세요.'],
      [{ returnPointMissing: false }, '선택한 수령일의 신청 마감 시각이 지났어요. 수령일을 다시 선택해주세요.'],
      [{ deadlineOk: true }, '요금이 정해지지 않은 상품은 예약할 수 없어요. 해당 상품의 체크를 해제해주세요.'],
      [{ priceUnset: false }, '이용 약관에 동의해주세요.'],
    ]
    expect(firstCartSubmitBlocker(all)).toBe('수령·반납 방법을 선택해주세요.')
    let cur = { ...all }
    for (const [patch, msg] of expected) {
      cur = { ...cur, ...patch }
      expect(firstCartSubmitBlocker(cur)).toBe(msg)
    }
    expect(firstCartSubmitBlocker({ ...cur, agreed: true })).toBeNull()
  })

  it('수령 방법은 골랐고 반납 방법이 비었어도 위쪽(수령일 누락)이 먼저 안내된다 — 화면 순서', () => {
    expect(firstCartSubmitBlocker({ ...OK, methodInvalid: true, methodLeg: 'return_', rentalDateMissing: true })).toBe('수령일을 선택해주세요.')
    expect(firstCartSubmitBlocker({ ...OK, methodInvalid: true, methodLeg: 'return_' })).toBe('수령·반납 방법을 선택해주세요.')
  })

  it('상품이 선택되지 않았으면 상품 선택 안내가 최우선', () => {
    expect(firstCartSubmitBlocker({ ...OK, hasItems: false, agreed: false })).toBe('예약할 상품을 선택해주세요.')
  })

  it('빠진 입력이 1~2개면 쉼표로 나열, 3개 이상이면 줄여서 안내', () => {
    expect(firstCartSubmitBlocker({ ...OK, rentalFormMissing: ['이름', '상세주소'] }))
      .toBe('수령 이름, 주소를 입력해주세요.')
    expect(firstCartSubmitBlocker({ ...OK, rentalFormMissing: ['이름', '휴대번호', '상세주소'] }))
      .toBe('수령 정보를 입력해주세요.')
    expect(firstCartSubmitBlocker({ ...OK, returnFormMissing: ['이름', '전자메일', '휴대번호', '기본주소', '상세주소'] }))
      .toBe('반납 정보를 입력해주세요.')
  })
})

describe('장바구니 배선 (2026-10-05)', () => {
  const cart = readFileSync('src/routes/cart/+page.svelte', 'utf-8')

  it('네 경고 지점(가격 영역 진입·Order Total 진입·누락 항목 지나침·버튼 클릭) 모두 공통 경고(showSubmitBlockerWarning)를 쓰고, 그 안에서만 구체적 안내(describeSubmitBlocker)를 띄운다', () => {
    expect(cart.match(/showSubmitBlockerWarning\(\)/g)?.length).toBe(4 + 1) // 호출 4곳 + 정의 1곳
    expect(cart.match(/csToast\.warning\(message, /g)?.length).toBe(1)
    expect(cart).not.toContain("csToast.warning('미입력 항목을 확인하세요')")
  })

  it('PC(≥641px)는 자동 이동 없이 토스트를 눌렀을 때만 이동하고, 모바일은 바로 이동한다', () => {
    expect(cart).toContain("matchMedia('(min-width: 641px)')")
    expect(cart).toContain("closest('[data-sonner-toast]')")
    expect(cart).not.toContain("actionLabel: '이동'")
  })

  it('달력 바깥 클릭 판정은 이벤트 경로(composedPath)와 분리된 대상(isConnected)을 고려한다', () => {
    expect(cart).toContain('e.composedPath()')
    expect(cart).toContain('path.includes(node)')
    expect(cart).toContain('target.isConnected')
  })

  it('모바일 Order Total 자동 접기 관찰자는 달력·시간 팝업이 열려 있으면 패널을 접지 않는다', () => {
    expect(cart).toContain('entries[0]?.isIntersecting && openCalId === null && openTimeId === null')
  })

  it('PC/모바일 중복 렌더링된 달력 중 숨겨진 인스턴스는 바깥 클릭 닫기·높이 측정에 관여하지 않는다', () => {
    expect(cart).toContain('const isRendered = () => node.getClientRects().length > 0')
    expect(cart).toContain('if (!isRendered()) return // 숨겨진(display:none) 중복 인스턴스는 닫지 않는다')
    expect(cart.match(/if \(!isRendered\(\)\) return/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('토스트는 기본 하단 가장자리, /cart 고정 푸터가 보일 때만 CSS 변수로 위로 띄운다', () => {
    const layout = readFileSync('src/routes/+layout.svelte', 'utf-8')
    expect(layout).toContain("var(--cs-toast-bottom, 24px)")
    expect(layout).toContain("var(--cs-toast-bottom-m, 16px)")
    expect(layout).not.toContain("startsWith('/cart') ? { bottom")
    expect(cart).toContain('liftToastAboveFooter(entry.isIntersecting)')
    expect(cart).toContain('liftToastAboveFooter(false)')
  })

  it('토스트 중복 방지 id·푸터 실측 높이·하단 이동 transition', () => {
    expect(readFileSync('src/lib/utils/toast.ts', 'utf-8')).toContain('options.id')
    expect(cart).toContain(".cart-footer')?.offsetHeight")
    expect(readFileSync('src/app.css', 'utf-8')).toContain("[data-sonner-toaster][data-y-position='bottom']")
  })
})

describe('firstCartSubmitBlockerTarget — 누락 항목 이동 대상(문구와 같은 목록)', () => {
  it('막는 항목이 없거나 영역 밖(요금·약관)이면 null', () => {
    expect(firstCartSubmitBlockerTarget(OK)).toBeNull()
    expect(firstCartSubmitBlockerTarget({ ...OK, priceUnset: true })).toBeNull()
    expect(firstCartSubmitBlockerTarget({ ...OK, agreed: false })).toBeNull()
  })

  it('방법 미선택은 methodLeg 쪽, 날짜·시간·지점은 해당 leg', () => {
    expect(firstCartSubmitBlockerTarget({ ...OK, methodInvalid: true })).toEqual({ leg: 'rental', part: 'method' })
    expect(firstCartSubmitBlockerTarget({ ...OK, methodInvalid: true, methodLeg: 'return_' })).toEqual({ leg: 'return_', part: 'method' })
    expect(firstCartSubmitBlockerTarget({ ...OK, returnDateMissing: true })).toEqual({ leg: 'return_', part: 'date' })
    expect(firstCartSubmitBlockerTarget({ ...OK, rentalTimeMissing: true })).toEqual({ leg: 'rental', part: 'time' })
    expect(firstCartSubmitBlockerTarget({ ...OK, returnPointMissing: true })).toEqual({ leg: 'return_', part: 'point' })
  })

  it('수령일 누락 + 반납 방법 미선택이면 화면 위쪽인 수령일(수령 아코디언)이 먼저', () => {
    expect(firstCartSubmitBlockerTarget({ ...OK, methodInvalid: true, methodLeg: 'return_', rentalDateMissing: true })).toEqual({ leg: 'rental', part: 'date' })
  })

  it('폼은 화면 순서(고객정보 → 지점 → 주소)의 첫 빠진 칸', () => {
    expect(firstCartSubmitBlockerTarget({ ...OK, rentalFormMissing: ['휴대번호', '기본주소'] })).toEqual({ leg: 'rental', part: 'phone' })
    expect(firstCartSubmitBlockerTarget({ ...OK, rentalFormMissing: ['기본주소'], rentalPointMissing: true })).toEqual({ leg: 'rental', part: 'point' })
    expect(firstCartSubmitBlockerTarget({ ...OK, rentalFormMissing: ['기본주소', '상세주소'] })).toEqual({ leg: 'rental', part: 'addr' })
    expect(firstCartSubmitBlockerTarget({ ...OK, returnFormMissing: ['상세주소'] })).toEqual({ leg: 'return_', part: 'addrDetail' })
  })

  it('마감 지남은 수령일 위치로 안내', () => {
    expect(firstCartSubmitBlockerTarget({ ...OK, deadlineOk: false })).toEqual({ leg: 'rental', part: 'date' })
  })
})
