/**
 * contractCatalog.test.ts — 계약서 변수 카탈로그 정합성 (adapters/crazyshot)
 *
 * 1) 기존 ContractFieldPanel 의 변수 18개가 키·순서 그대로 보존됐는지(기존 양식의 칩 호환)
 * 2) 모든 카탈로그 키가 치환 데이터(ContractSubstitutionData)의 실제 키인지(컴파일 타임 + 런타임)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRACT_VARIABLE_CATALOG } from '$lib/modules/doc-editor/adapters/crazyshot/contractCatalog'
import type { ContractSubstitutionData } from '$lib/types/contract-module'

const ALL_VARIABLES = CONTRACT_VARIABLE_CATALOG.flatMap((g) => g.items.map((i) => i.variable))

// 컴파일 타임 보증: 카탈로그에 쓰는 변수명은 모두 ContractSubstitutionData 의 키여야 한다
const KNOWN_KEYS = [
  '고객이름', '연락처', '이메일', '주소', '예약코드', '상품코드', '상품명', '수량', '수령형태', '수령일시', '반납형태', '반납일시',
  '요금유형', '구성품', '수령일자', '반납일자', '대여일수', '총사용시간', '수령방법지점', '반납방법지점', '지점옵션',
  '기본대여요금', '할인금액', '할인차감', '차감포인트', '배송비', '부가세', '최종합계', '총 정상 대여가', '할인반영금액',
  '계약서발행일', '임대인상호명', '임대인대표자명', '임대인사업자번호', '임대인사업장주소',
] as const satisfies ReadonlyArray<keyof ContractSubstitutionData>

describe('계약서 변수 카탈로그', () => {
  it('기존 ContractFieldPanel의 변수 18개가 같은 순서로 그대로 들어 있다', () => {
    const old = readFileSync(join(process.cwd(), 'src/lib/components/cms/contract-editor/ContractFieldPanel.svelte'), 'utf-8')
    const fieldGroups = old.slice(old.indexOf('const FIELD_GROUPS'), old.indexOf('// 특약 조항 관리'))
    const oldVars = [...fieldGroups.matchAll(/variable:\s*'([^']+)'/g)].map((m) => m[1])
    expect(oldVars).toHaveLength(21) // 계약자4 + 상품10 + 결제7 (패널 주석의 "18개"는 오기 — 실제 21개)
    const mine = (key: string) => CONTRACT_VARIABLE_CATALOG.find((g) => g.key === key)!.items.map((i) => i.variable)
    expect([...mine('customer'), ...mine('product').slice(0, 10), ...mine('payment').slice(0, 7)]).toEqual(oldVars)
  })

  it('모든 변수가 ContractSubstitutionData의 알려진 키이고 중복이 없다', () => {
    expect(new Set(ALL_VARIABLES).size).toBe(ALL_VARIABLES.length)
    expect([...ALL_VARIABLES].sort()).toEqual([...KNOWN_KEYS].sort())
  })

  it('라벨·변수 키가 비어 있지 않다', () => {
    for (const g of CONTRACT_VARIABLE_CATALOG) {
      expect(g.label.length).toBeGreaterThan(0)
      for (const i of g.items) {
        expect(i.variable.length).toBeGreaterThan(0)
        expect(i.label.length).toBeGreaterThan(0)
      }
    }
  })
})
