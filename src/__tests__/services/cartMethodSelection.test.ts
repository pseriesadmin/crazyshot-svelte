import { describe, it, expect } from 'vitest'
import { toDeliveryMethod, isMethodSelectionValid } from '$lib/utils/cartMethodSelection'

/**
 * 장바구니 수령/반납 방식 콤보바 — 최초진입 시 완전 미선택(null) 상태 판정 — TDD
 * Harness Flow v3.2
 *
 * 배경(2026-09-04): defaultOptions()가 신규 카트 아이템의 rentalMethod/returnMethod
 * 기본값을 'visit'(방문)으로 강제 세팅해, 최초 진입 시 콤보 버튼 바에 '방문'이 이미
 * 선택된 것처럼(class:combo-btn-active) 보이던 결함. 재조사 결과 이 강제 기본값은
 * 불필요한 전제(체크아웃 마지막 결제 실패 방지)로 만들어졌고, methodSelectionValid가
 * 이미 독립적인 안전장치로 존재함이 확인됨 — Stephen 승인으로 진짜 null(미선택)로 전환.
 *
 * 이 파일은 cart/+page.svelte에 인라인으로 박혀있던 두 순수함수(toDeliveryMethod,
 * methodSelectionValid 판정 로직)를 추출해 단위테스트한다.
 */

describe('toDeliveryMethod', () => {
  it('Happy: 알려진 방식 문자열 → 그 방식 그대로 반환', () => {
    expect(toDeliveryMethod('visit', null)).toBe('visit')
    expect(toDeliveryMethod('crazydelivery', 'visit')).toBe('crazydelivery')
  })

  it('Edge: null 값 + null fallback → null (최초진입 완전 미선택 상태)', () => {
    expect(toDeliveryMethod(null, null)).toBeNull()
  })

  it('Edge: 알 수 없는 문자열 + null fallback → null', () => {
    expect(toDeliveryMethod('unknown_method', null)).toBeNull()
  })

  it('Error: 알 수 없는 문자열 + non-null fallback → fallback 그대로 반환(기존 방어 로직 보존)', () => {
    expect(toDeliveryMethod('garbage', 'visit')).toBe('visit')
  })

  it('Error: null 값 + non-null fallback → fallback 그대로 반환(incrementGroupQtyImmediate 등 방어경로용)', () => {
    expect(toDeliveryMethod(null, 'visit')).toBe('visit')
  })
})

describe('isMethodSelectionValid', () => {
  const pickupVisibleTabs = [{ v: 'visit' as const }, { v: 'crazydelivery' as const }]
  const returnVisibleTabs = [{ v: 'visit' as const }, { v: 'crazydelivery' as const }]

  it('Happy: 체크됨 + 수령/반납 방식 모두 목록에 존재 → valid', () => {
    expect(isMethodSelectionValid({
      deleted: false, checked: true,
      rentalMethod: 'visit', returnMethod: 'visit',
      pickupVisibleTabs, returnVisibleTabs,
    })).toBe(true)
  })

  it('Edge: 삭제된 항목 → rentalMethod가 null이어도 valid(검증 대상 제외)', () => {
    expect(isMethodSelectionValid({
      deleted: true, checked: true,
      rentalMethod: null, returnMethod: null,
      pickupVisibleTabs, returnVisibleTabs,
    })).toBe(true)
  })

  it('Edge: 체크 해제된 항목 → rentalMethod가 null이어도 valid(검증 대상 제외)', () => {
    expect(isMethodSelectionValid({
      deleted: false, checked: false,
      rentalMethod: null, returnMethod: null,
      pickupVisibleTabs, returnVisibleTabs,
    })).toBe(true)
  })

  it('Error: 체크됨 + rentalMethod가 null(최초진입 미선택) → invalid — "예약신청완료" 버튼이 막혀야 함', () => {
    expect(isMethodSelectionValid({
      deleted: false, checked: true,
      rentalMethod: null, returnMethod: null,
      pickupVisibleTabs, returnVisibleTabs,
    })).toBe(false)
  })

  it('Error: 체크됨 + rentalMethod는 있으나 returnMethod가 null → invalid', () => {
    expect(isMethodSelectionValid({
      deleted: false, checked: true,
      rentalMethod: 'visit', returnMethod: null,
      pickupVisibleTabs, returnVisibleTabs,
    })).toBe(false)
  })

  it('Error: 체크됨 + rentalMethod가 visibleTabs 목록에 없는 값(제거된 방식) → invalid', () => {
    expect(isMethodSelectionValid({
      deleted: false, checked: true,
      rentalMethod: 'epost', returnMethod: 'visit',
      pickupVisibleTabs, returnVisibleTabs,
    })).toBe(false)
  })
})
