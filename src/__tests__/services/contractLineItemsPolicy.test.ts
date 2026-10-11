/**
 * contractLineItemsPolicy.test.ts — 계약서 "대여 장비내역" 표기 정책(2026-10-10, Stephen 확정)
 *
 * 순수 함수 테스트(DB 불필요). 정책 전문은 contractLineItems.ts 상단 "2026-10-10 개편" 절.
 */
import { describe, it, expect } from 'vitest'
import { buildLineItems, formatComponentsText } from '$lib/utils/contractLineItems'
import type { ReservationForLineItems } from '$lib/utils/contractLineItems'
import { substituteHtmlDocument } from '$lib/utils/contract-substitution'
import type { ContractSubstitutionData } from '$lib/types/contract-module'

function res(
  name: string,
  code: string,
  extra: Partial<ReservationForLineItems['mainProduct']> = {},
  options: ReservationForLineItems['options'] = [],
  bundles: ReservationForLineItems['bundles'] = [],
): ReservationForLineItems {
  return { mainProduct: { name, product_code: code, ...extra }, options, bundles }
}

describe('자산코드 비표시 + 상품명 기준 통합', () => {
  it('상품코드가 달라도 같은 상품명이면 1행으로 묶이고 수량이 합산된다', () => {
    const items = buildLineItems([res('Canon R6', 'CS001'), res('Canon R6', 'CS002')])
    expect(items).toHaveLength(1)
    expect(items[0].수량).toBe('2')
  })

  it('모든 행의 상품코드는 빈 문자열이다(메인·옵션·결합)', () => {
    const items = buildLineItems([
      res('GH5', 'CS9', {}, [{ option_name: '배터리', qty: 1, unit_price: 1000, product_code: 'OPT1' }],
        [{ bundle_product_id: 'b1', bundle_name: '삼각대', product_code: 'BND1' }]),
    ])
    expect(items.map((i) => i.상품코드)).toEqual(['', '', ''])
  })

  it('옵션이 붙은 유닛과 안 붙은 유닛은 따로 나뉘고, 붙은 쪽이 먼저 온다', () => {
    const items = buildLineItems([
      res('GH5', 'A'),
      res('GH5', 'B', {}, [{ option_name: 'XLR', qty: 1, unit_price: 5000, product_code: null }]),
    ])
    expect(items.map((i) => i.상품명)).toEqual(['GH5', '┖[옵션] XLR', 'GH5'])
    expect(items[0].수량).toBe('1')
  })

  it('옵션 수량 = 옵션 qty × 묶인 건수', () => {
    const opt = { option_name: 'LP-E6P', qty: 2, unit_price: 3000, product_code: null }
    const items = buildLineItems([res('R6', 'A', {}, [opt]), res('R6', 'B', {}, [opt])])
    expect(items[0].수량).toBe('2')
    expect(items[1].수량).toBe('4')
  })
})

describe('┖[옵션] / ┖[결합] 접두 + 번호', () => {
  it('결합은 ┖[결합], 옵션은 ┖[옵션] 접두이며 결합이 옵션보다 앞선다', () => {
    const items = buildLineItems([
      res('R6', 'A', {}, [{ option_name: 'XLR', qty: 1, unit_price: 100, product_code: null }],
        [{ bundle_product_id: 'b1', bundle_name: '삼각대' }]),
    ])
    expect(items.map((i) => i.상품명)).toEqual(['R6', '┖[결합] 삼각대', '┖[옵션] XLR'])
    expect(items[1].수량).toBe('1')
    expect(items[1].금액).toBe('-')
  })

  it('번호는 메인 행만 1부터 매기고 하위 행은 비운다', () => {
    const items = buildLineItems([
      res('A', '1', {}, [{ option_name: 'o', qty: 1, unit_price: 1, product_code: null }]),
      res('B', '2'),
    ])
    expect(items.map((i) => i.순번)).toEqual(['1', '', '2'])
  })

  it('HTML 치환 시 {{NO.}}가 순번을 따른다(하위 행은 빈 칸)', () => {
    const items = buildLineItems([
      res('A', '1', {}, [{ option_name: 'o', qty: 1, unit_price: 1, product_code: null }]),
    ])
    const html = substituteHtmlDocument(
      '<!--REPEAT:상품목록--><tr>[{{NO.}}]{{상품명}}</tr><!--/REPEAT-->',
      { 상품목록: items } as unknown as ContractSubstitutionData,
    )
    expect(html).toBe('<tr>[1]A</tr><tr>[]┖[옵션] o</tr>')
  })
})

describe('단가(Unit Price) 표기', () => {
  const base = { price_day: 60000, price_half: 50000 }
  it('Day만 포함된 기간 → "Day 60,000"', () => {
    expect(buildLineItems([res('A', '1', { ...base, show_day: true, show_half: false })])[0].금액).toBe('Day 60,000')
  })
  it('12시간만 → "12H 50,000"', () => {
    expect(buildLineItems([res('A', '1', { ...base, show_day: false, show_half: true })])[0].금액).toBe('12H 50,000')
  })
  it('Day+12H 복합 → "Day 60,000 / 12H 50,000"', () => {
    expect(buildLineItems([res('A', '1', { ...base, show_day: true, show_half: true })])[0].금액).toBe('Day 60,000 / 12H 50,000')
  })
  it('같은 상품 2건이어도 합계가 아니라 1건 단가를 표기한다', () => {
    const items = buildLineItems([
      res('A', '1', { ...base, show_day: true, show_half: false }),
      res('A', '2', { ...base, show_day: true, show_half: false }),
    ])
    expect(items[0].수량).toBe('2')
    expect(items[0].금액).toBe('Day 60,000')
  })
  it('기간 판정 정보가 없으면 기존 단일 단가로 폴백, 가격이 없으면 "-"', () => {
    expect(buildLineItems([res('A', '1', { unit_price: 70000 })])[0].금액).toBe('70,000원')
    expect(buildLineItems([res('A', '1')])[0].금액).toBe('-')
  })
})

describe('정렬: 분류 → 브랜드 → 상품명', () => {
  it('분류·브랜드·이름 순으로 나열되고 분류 없는 상품은 뒤로 간다', () => {
    const items = buildLineItems([
      res('Zed', '1'),
      res('GH5', '2', { category: 'camera', brand: 'Panasonic' }),
      res('R6', '3', { category: 'camera', brand: 'Canon' }),
      res('UWP', '4', { category: 'acc', brand: 'Sony' }),
    ])
    expect(items.map((i) => i.상품명)).toEqual(['UWP', 'R6', 'GH5', 'Zed'])
  })
})

describe('구성품 비고 — 고객 옵션 선택 후보 문구 제외', () => {
  it('"(고객 옵션 선택)" 표기 항목은 비고에서 빠지고 나머지는 남는다', () => {
    const text = formatComponentsText([
      { key: '본체', value: '1EA' },
      { key: 'XLR 변환 케이블 또는 스테레오 미니 케이블(고객 옵션 선택)', value: '1EA' },
    ])
    expect(text).toContain('본체')
    expect(text).not.toContain('고객 옵션 선택')
  })
  it('전부 걸러지면 "-"', () => {
    expect(formatComponentsText([{ key: 'A(고객 옵션 선택)', value: '1' }])).toBe('-')
  })
})
