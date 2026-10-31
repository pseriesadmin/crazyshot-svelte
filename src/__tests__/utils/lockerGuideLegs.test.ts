/**
 * lockerGuideLegs.test.ts — 무인보관함 안내 발송 대상(수령/반납) 선택 규칙 (2026-10-31, Stephen 확정)
 * 콤보 버튼 2개(수령·반납)의 선택 ↔ 저장값('pickup'|'return'|'both') 변환. 고르기 전(둘 다 꺼짐)에는 저장값이 없다 → [배정 확정] 비활성.
 */
import { describe, it, expect } from 'vitest'
import {
  isValidLockerGuideLegs,
  legsFromSelection,
  selectionFromLegs,
  legListFromLegs,
} from '$lib/utils/lockerFields'

describe('legsFromSelection — 두 버튼 선택 → 저장값', () => {
  it('수령만 / 반납만 / 둘 다', () => {
    expect(legsFromSelection(true, false)).toBe('pickup')
    expect(legsFromSelection(false, true)).toBe('return')
    expect(legsFromSelection(true, true)).toBe('both')
  })
  it('둘 다 꺼짐 = 아직 고르지 않음 → null', () => {
    expect(legsFromSelection(false, false)).toBeNull()
  })
})

describe('selectionFromLegs — 저장값 → 두 버튼 선택', () => {
  it('저장값을 그대로 되돌린다', () => {
    expect(selectionFromLegs('pickup')).toEqual({ pickup: true, return: false })
    expect(selectionFromLegs('return')).toEqual({ pickup: false, return: true })
    expect(selectionFromLegs('both')).toEqual({ pickup: true, return: true })
  })
  it('NULL·알 수 없는 값은 아무것도 선택하지 않은 상태(관리자가 직접 고른다)', () => {
    expect(selectionFromLegs(null)).toEqual({ pickup: false, return: false })
    expect(selectionFromLegs(undefined)).toEqual({ pickup: false, return: false })
    expect(selectionFromLegs('x')).toEqual({ pickup: false, return: false })
  })
})

describe('isValidLockerGuideLegs / legListFromLegs', () => {
  it('허용값은 3종뿐', () => {
    expect(isValidLockerGuideLegs('pickup')).toBe(true)
    expect(isValidLockerGuideLegs('return')).toBe(true)
    expect(isValidLockerGuideLegs('both')).toBe(true)
    expect(isValidLockerGuideLegs('')).toBe(false)
    expect(isValidLockerGuideLegs(null)).toBe(false)
    expect(isValidLockerGuideLegs('pickup,return')).toBe(false)
  })
  it('시범 발송 대상 목록 — 수령 → 반납 순서', () => {
    expect(legListFromLegs('pickup')).toEqual(['pickup'])
    expect(legListFromLegs('return')).toEqual(['return'])
    expect(legListFromLegs('both')).toEqual(['pickup', 'return'])
  })
})
