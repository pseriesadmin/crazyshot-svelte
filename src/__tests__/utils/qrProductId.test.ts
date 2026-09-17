import { describe, it, expect } from 'vitest'
import {
  extractProductId,
  extractReservationCode,
  identifyQrPayload,
} from '../../lib/utils/qrProductId'

/**
 * qrProductId.ts — CMS QR 코드 시스템 통합 모듈화 회귀 테스트
 * (2026-09-17, TASK.md "CMS QR 코드 시스템 통합 모듈화" Phase 1~3)
 */

describe('extractProductId', () => {
  it('파이프 없는 순수 품번 원문을 그대로 반환한다', () => {
    expect(extractProductId('CSLENall00001')).toBe('CSLENall00001')
  })

  it('파이프 구분자가 있는 신규 페이로드에서 품번 부분만 추출한다 (하위호환)', () => {
    expect(extractProductId('CSLENall00001|LENS')).toBe('CSLENall00001')
  })

  it('회원 QR 경로(/qr/member/...)는 null을 반환한다', () => {
    expect(extractProductId('/qr/member/MEM-0001')).toBeNull()
  })
})

describe('extractReservationCode', () => {
  it('CS + 숫자만인 예약코드를 인식한다', () => {
    expect(extractReservationCode('CS2609001')).toBe('CS2609001')
  })

  it('CZ- 접두사 예약코드를 인식한다', () => {
    expect(extractReservationCode('CZ-123456')).toBe('CZ-123456')
  })

  it('알파벳 카테고리가 포함된 상품코드는 null을 반환한다 (상품코드와 구분)', () => {
    // CSLENall00001 — CS 다음에 알파벳(LEN)이 오면 상품코드
    expect(extractReservationCode('CSLENall00001')).toBeNull()
  })

  it('빈 문자열은 null을 반환한다', () => {
    expect(extractReservationCode('')).toBeNull()
  })
})

describe('identifyQrPayload', () => {
  it('회원 QR 경로를 member 타입으로 판별한다', () => {
    const result = identifyQrPayload('/qr/member/MEM-0001')
    expect(result.type).toBe('member')
    expect(result.value).toBe('MEM-0001')
  })

  it('파이프 포함 신규 상품 페이로드를 product 타입으로 판별한다', () => {
    const result = identifyQrPayload('CSLENall00001|LENS')
    expect(result.type).toBe('product')
    expect(result.value).toBe('CSLENall00001')
  })

  it('예약코드(CS숫자)를 reservation 타입으로 판별한다', () => {
    const result = identifyQrPayload('CS2609001')
    expect(result.type).toBe('reservation')
    expect(result.value).toBe('CS2609001')
  })

  it('순수 상품코드를 product 타입으로 판별한다', () => {
    const result = identifyQrPayload('CSLENall00001')
    expect(result.type).toBe('product')
    expect(result.value).toBe('CSLENall00001')
  })

  it('인식되지 않는 URL 형식을 unknown 타입으로 반환한다', () => {
    // extractProductId는 '://' 포함 또는 '/'로 시작하는 텍스트는 null 반환(URL이지만 인식 불가)
    const result = identifyQrPayload('https://otherdomain.com/unknown')
    expect(result.type).toBe('unknown')
    expect(result.value).toBe('https://otherdomain.com/unknown')
  })
})
