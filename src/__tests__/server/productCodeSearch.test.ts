import { describe, it, expect } from 'vitest'
import { isProductCodeQuery, matchParentIdsByBaseCode } from '$lib/server/products/searchByProductCode'

const series = (parent_seq: number) => ({
  prefix: 'CS', suffix: '', parent_seq, seq_digits: 4, year_month: 'nodate',
  max_sequence: 9999, category_code: 'PGTRV', parent_seq_digits: 3, parent_max_sequence: 999
})

describe('상품 목록 품번 검색', () => {
  it('품번처럼 보이는 검색어만 대상(영숫자 5자 이상, 공백 없음)', () => {
    expect(isProductCodeQuery('CSPGTRV0010000')).toBe(true)
    expect(isProductCodeQuery('pgtrv001')).toBe(true)
    expect(isProductCodeQuery('RF 50mm')).toBe(false)
    expect(isProductCodeQuery('canon')).toBe(true)
    expect(isProductCodeQuery('R6')).toBe(false)
  })
  it('기준 품번(표시용)으로 부모를 찾는다 — 대소문자 무시·부분일치', () => {
    const rows = [
      { id: 'a', code_series: series(1) },
      { id: 'b', code_series: series(2) },
    ]
    expect(matchParentIdsByBaseCode(rows, 'CSPGTRV0010000')).toEqual(['a'])
    expect(matchParentIdsByBaseCode(rows, 'cspgtrv0020000')).toEqual(['b'])
    expect(matchParentIdsByBaseCode(rows, 'PGTRV')).toEqual(['a', 'b'])
    expect(matchParentIdsByBaseCode(rows, 'CSPGTRV0030000')).toEqual([])
  })
})

// ── findParentIdsByProductCode: 가짜 admin 클라이언트로 조회 경로 검증 ──────────────
import { findParentIdsByProductCode } from '$lib/server/products/searchByProductCode'
import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
function fakeAdmin(opts: { children?: Row[]; legacy?: Row[]; seriesPages?: Row[][] }): { client: SupabaseClient; ilikeArgs: string[]; rangeCalls: number[] } {
  const ilikeArgs: string[] = []
  const rangeCalls: number[] = []
  let pageIdx = 0
  const client = {
    from() {
      const state: { notParent: boolean; seriesMode: boolean } = { notParent: false, seriesMode: false }
      const b: Record<string, unknown> = {}
      const chain = () => b
      b.select = chain
      b.is = chain
      b.order = chain
      b.not = (col: string) => { if (col === 'parent_product_id') state.notParent = true; if (col === 'code_series') state.seriesMode = true; return b }
      b.ilike = (_c: string, pattern: string) => { ilikeArgs.push(pattern); return b }
      b.limit = () => Promise.resolve({ data: state.notParent ? (opts.children ?? []) : (opts.legacy ?? []), error: null })
      b.range = (from: number) => { rangeCalls.push(from); return Promise.resolve({ data: (opts.seriesPages ?? [])[pageIdx++] ?? [], error: null }) }
      return b
    },
  } as unknown as SupabaseClient
  return { client, ilikeArgs, rangeCalls }
}

describe('findParentIdsByProductCode', () => {
  it('품번형이 아닌 검색어는 DB를 조회하지 않고 빈 결과', async () => {
    const f = fakeAdmin({ children: [{ parent_product_id: 'x' }] })
    expect(await findParentIdsByProductCode(f.client, 'RF 50mm')).toEqual([])
    expect(f.ilikeArgs).toEqual([])
  })
  it('자식 품번·레거시 부모 품번·기준 품번 매칭을 합치고 중복을 제거하며 와일드카드를 이스케이프한다', async () => {
    const f = fakeAdmin({
      children: [{ parent_product_id: 'p1' }, { parent_product_id: 'p1' }, { parent_product_id: null }],
      legacy: [{ id: 'p2' }],
      seriesPages: [[{ id: 'p3', code_series: series(1) }, { id: 'p1', code_series: series(1) }]],
    })
    const ids = await findParentIdsByProductCode(f.client, 'CSPGTRV0010000')
    expect(ids.sort()).toEqual(['p1', 'p2', 'p3'])
    expect(f.ilikeArgs).toEqual(['%CSPGTRV0010000%', '%CSPGTRV0010000%'])
  })
  it('code_series 부모를 1000행 단위로 순회하다 마지막 페이지(1000 미만)에서 멈춘다', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, code_series: series(900) }))
    const f = fakeAdmin({ seriesPages: [full, [{ id: 'last', code_series: series(1) }]] })
    const ids = await findParentIdsByProductCode(f.client, 'CSPGTRV0010000')
    expect(ids).toEqual(['last'])
    expect(f.rangeCalls).toEqual([0, 1000])
  })
  it('후보는 최대 100개로 제한한다', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ parent_product_id: `p${i}` }))
    const f = fakeAdmin({ children: many })
    expect((await findParentIdsByProductCode(f.client, 'CSPGTRV00')).length).toBe(100)
  })
})
