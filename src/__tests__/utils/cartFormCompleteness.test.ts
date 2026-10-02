import { describe, it, expect } from 'vitest'
import { missingCartFormFields, isCartFormComplete, isCustomerAndAddressComplete, isCartFormEmpty, type CartFormInput } from '$lib/utils/cartFormCompleteness'

/**
 * 장바구니 수령·반납 입력 정보 완전성 — "예약신청" 게이트 (2026-10-02, Stephen 확정)
 * 완료기준: 이름·전자메일·휴대번호·기본주소·상세주소를 빠짐없이 입력해야 신청 가능(방문·무인보관함·퀵 등 방식 무관).
 *          공백만 입력한 값은 비어 있는 것으로 본다. 지점 선택은 별도 조건(pickupPointsSet)이다.
 */
const full: CartFormInput = { name: '홍길동', email: 'a@b.co', phone: '01012345678', addr: '서울 마포구 월드컵북로 1', addrDetail: '101동 1001호', notes: '문 앞에 놓아주세요' }

describe('missingCartFormFields', () => {
  it('모두 입력되면 빈 배열', () => {
    expect(missingCartFormFields(full)).toEqual([])
    expect(isCartFormComplete(full)).toBe(true)
  })
  it('빈 항목을 한글 라벨로 알려준다', () => {
    expect(missingCartFormFields({ ...full, addr: '' })).toEqual(['기본주소'])
    expect(missingCartFormFields({ ...full, addrDetail: '' })).toEqual(['상세주소'])
    expect(missingCartFormFields({ ...full, name: '', phone: '' })).toEqual(['이름', '휴대번호'])
    expect(missingCartFormFields({ ...full, notes: '' })).toEqual([]) // 요청 사항은 선택 항목
  })
  it('공백만 있는 값은 비어 있는 것으로 본다', () => {
    expect(isCartFormComplete({ ...full, addr: '   ' })).toBe(false)
    expect(isCartFormComplete({ ...full, notes: '' })).toBe(true)
  })
  it('빈 폼은 필수 5개 전부 누락(요청 사항 제외)', () => {
    expect(missingCartFormFields({ name: '', email: '', phone: '', addr: '', addrDetail: '', notes: '' })).toHaveLength(5)
  })
})

describe('isCustomerAndAddressComplete', () => {
  it('요청 사항만 비어 있어도 고객정보·주소가 있으면 완료', () => {
    expect(isCustomerAndAddressComplete({ ...full, notes: '' })).toBe(true)
  })
  it('주소·연락처 중 하나라도 비면 미완료', () => {
    expect(isCustomerAndAddressComplete({ ...full, notes: '', addrDetail: '' })).toBe(false)
    expect(isCustomerAndAddressComplete({ ...full, phone: ' ' })).toBe(false)
  })
})

describe('isCartFormEmpty', () => {
  it('전부 비어 있을 때만 true', () => {
    expect(isCartFormEmpty({ name: '', email: ' ', phone: '', addr: '', addrDetail: '', notes: '' })).toBe(true)
    expect(isCartFormEmpty({ ...full, name: '', email: '', phone: '', addr: '', addrDetail: '' })).toBe(false) // 요청 사항이 있으면 비어 있지 않다
  })
})
