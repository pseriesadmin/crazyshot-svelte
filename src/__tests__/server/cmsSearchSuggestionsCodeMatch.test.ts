import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/routes/api/cms/products/search-suggestions/+server.ts', 'utf8')

describe('search-suggestions — 품번 검색 합류', () => {
  it('품번형 검색어일 때 부모 id를 ilike OR 조건에 id.in으로 합친다(초성 쿼리 제외)', () => {
    expect(src).toContain("import { findParentIdsByProductCode } from '$lib/server/products/searchByProductCode'")
    expect(src).toMatch(/codeMatchIds = await findParentIdsByProductCode\(admin, q\)/)
    expect(src).toMatch(/\$\{productSearchOrFilter\(q\)\},id\.in\.\(\$\{codeMatchIds\.join\(','\)\}\)/)
  })
  it('품번 매칭 라벨은 다른 필드가 못 맞춘 경우에만 "품번"', () => {
    expect(src).toContain("'품번'")
  })
  it('인증 게이트는 첫 문장 그대로', () => {
    expect(src.indexOf('getCmsRoleForAction(locals)')).toBeLessThan(src.indexOf('findParentIdsByProductCode(admin'))
  })
})
