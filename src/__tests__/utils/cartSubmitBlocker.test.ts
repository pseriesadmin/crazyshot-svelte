import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { firstCartSubmitBlocker, type CartSubmitBlockerInput } from '$lib/utils/cartSubmitBlocker'

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

  it('화면 위→아래 순서: 방법 → 수령일 → 수령시간 → 반납일 → 반납시간 → 지점 → 수령정보 → 반납정보 → 마감 → 요금 → 약관', () => {
    const all: CartSubmitBlockerInput = {
      hasItems: true, methodInvalid: true, rentalDateMissing: true, rentalTimeMissing: true,
      returnDateMissing: true, returnTimeMissing: true, rentalPointMissing: true, returnPointMissing: true,
      rentalFormMissing: ['이름'], returnFormMissing: ['이름'], deadlineOk: false, priceUnset: true, agreed: false,
    }
    const expected: Array<[Partial<CartSubmitBlockerInput>, string]> = [
      [{ methodInvalid: false }, '수령일을 선택해주세요.'],
      [{ rentalDateMissing: false }, '수령 시간을 선택해주세요.'],
      [{ rentalTimeMissing: false }, '반납일을 선택해주세요.'],
      [{ returnDateMissing: false }, '반납 시간을 선택해주세요.'],
      [{ returnTimeMissing: false }, '수령 방문지점을 선택해주세요.'],
      [{ rentalPointMissing: false }, '반납 방문지점을 선택해주세요.'],
      [{ returnPointMissing: false }, '수령 정보의 이름 항목을 입력해주세요.'],
      [{ rentalFormMissing: [] }, '반납 정보의 이름 항목을 입력해주세요.'],
      [{ returnFormMissing: [] }, '선택한 수령일의 신청 마감 시각이 지났어요. 수령일을 다시 선택해주세요.'],
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

  it('상품이 선택되지 않았으면 상품 선택 안내가 최우선', () => {
    expect(firstCartSubmitBlocker({ ...OK, hasItems: false, agreed: false })).toBe('예약할 상품을 선택해주세요.')
  })

  it('여러 빠진 입력은 쉼표로 나열', () => {
    expect(firstCartSubmitBlocker({ ...OK, rentalFormMissing: ['이름', '휴대번호', '상세주소'] }))
      .toBe('수령 정보의 이름, 휴대번호, 상세주소 항목을 입력해주세요.')
  })
})

describe('장바구니 배선 (2026-10-05)', () => {
  const cart = readFileSync('src/routes/cart/+page.svelte', 'utf-8')

  it('두 경고 지점 모두 구체적 안내(describeSubmitBlocker)를 쓰고, 막연한 고정 문구만 쓰지 않는다', () => {
    expect(cart.match(/csToast\.warning\(describeSubmitBlocker\(\)\)/g)?.length).toBe(2)
    expect(cart).not.toContain("csToast.warning('미입력 항목을 확인하세요')")
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
})
