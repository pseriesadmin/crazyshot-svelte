/**
 * searchByDetailText.test.ts — CMS 상품목록 검색에 상세설명·구성품·사양 칸 추가 (2026-10-27)
 * 이 세 칸은 JSONB라 PostgREST ilike로 못 찾는다 → 부모 상품의 텍스트를 뽑아 서버에서 부분일치로 비교한다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  detailSearchText,
  matchParentIdsByDetailText,
  findParentIdsByDetailText,
  resetDetailTextCache,
} from '$lib/server/products/searchByDetailText'

const rows = [
  { id: 'a', content_blocks: [{ type: 'text', html: '<p>야간 촬영에 강한 <b>풀프레임</b> 바디</p>' }], components: [{ key: '배터리', value: '2개' }], specifications: { 센서: '풀프레임 CMOS' } },
  { id: 'b', content_blocks: [], components: { 충전기: '1개', 스트랩: '1개' }, specifications: [{ key: '무게', value: '650g' }] },
  { id: 'c', content_blocks: null, components: null, specifications: null },
  { id: 'd', content_blocks: [{ type: 'html', content: '<div>방수 케이스 포함</div>' }], components: [], specifications: {} },
]

describe('detailSearchText', () => {
  it('상세설명(HTML 제거)·구성품(배열/객체)·사양(배열/객체)을 한 문자열로 합친다', () => {
    const t = detailSearchText(rows[0])
    expect(t).toContain('야간 촬영에 강한')
    expect(t).not.toContain('<b>')
    expect(t).toContain('배터리')
    expect(t).toContain('센서')
    expect(detailSearchText(rows[1])).toContain('충전기')
    expect(detailSearchText(rows[1])).toContain('650g')
  })
  it('전부 비어 있으면 빈 문자열', () => expect(detailSearchText(rows[2])).toBe(''))
})

describe('matchParentIdsByDetailText', () => {
  it('상세설명 안의 말로 찾는다(HTML 태그 사이에 끼어 있어도)', () => expect(matchParentIdsByDetailText(rows, '풀프레임')).toEqual(['a']))
  it('구성품·사양으로 찾는다', () => {
    expect(matchParentIdsByDetailText(rows, '충전기')).toEqual(['b'])
    expect(matchParentIdsByDetailText(rows, '650g')).toEqual(['b'])
    expect(matchParentIdsByDetailText(rows, '배터리 2개')).toEqual(['a']) // 구성품은 "키 값" 형태로 이어 붙여 비교
  })
  it('html 타입 블록도 찾는다', () => expect(matchParentIdsByDetailText(rows, '방수 케이스')).toEqual(['d']))
  it('대소문자 무시', () => expect(matchParentIdsByDetailText(rows, 'cmos')).toEqual(['a']))
  it('빈 검색어·2자 미만은 비교하지 않는다(너무 넓은 매칭 방지)', () => {
    expect(matchParentIdsByDetailText(rows, '  ')).toEqual([])
    expect(matchParentIdsByDetailText(rows, '촬')).toEqual([])
  })
  it('없는 말은 빈 배열', () => expect(matchParentIdsByDetailText(rows, '존재하지않는말')).toEqual([]))
})

function fakeAdmin(data: unknown[], error: unknown = null) {
  let calls = 0
  const admin = {
    from: () => {
      calls++
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'is', 'order']) chain[m] = () => chain
      chain.range = () => Promise.resolve({ data, error })
      return chain
    },
  }
  return { admin: admin as never, calls: () => calls }
}

describe('findParentIdsByDetailText', () => {
  beforeEach(() => resetDetailTextCache())

  it('DB에서 읽은 부모 상품에서 매칭 id를 돌려준다', async () => {
    const f = fakeAdmin(rows)
    expect(await findParentIdsByDetailText(f.admin, '풀프레임')).toEqual(['a'])
  })
  it('60초 안에는 DB를 다시 읽지 않는다(검색할 때마다 큰 JSON을 읽지 않도록)', async () => {
    const f = fakeAdmin(rows)
    await findParentIdsByDetailText(f.admin, '풀프레임')
    await findParentIdsByDetailText(f.admin, '충전기')
    expect(f.calls()).toBe(1)
  })
  it('조회 오류면 빈 배열(기본 검색은 그대로 동작) — 오류 결과는 캐시하지 않는다', async () => {
    const bad = fakeAdmin([], { message: 'boom' })
    expect(await findParentIdsByDetailText(bad.admin, '풀프레임')).toEqual([])
    const good = fakeAdmin(rows)
    expect(await findParentIdsByDetailText(good.admin, '풀프레임')).toEqual(['a'])
  })
  it('후보는 최대 100개로 제한', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, content_blocks: [{ type: 'text', html: '공통문구' }], components: null, specifications: null }))
    const f = fakeAdmin(many)
    expect((await findParentIdsByDetailText(f.admin, '공통문구')).length).toBe(100)
  })
  it('빈 검색어는 DB를 읽지 않는다', async () => {
    const f = fakeAdmin(rows)
    expect(await findParentIdsByDetailText(f.admin, '  ')).toEqual([])
    expect(f.calls()).toBe(0)
  })
})

describe('배선', () => {
  it('CMS 상품목록과 자동완성이 같은 헬퍼를 호출한다', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/routes/cms/products/+page.server.ts', 'src/routes/api/cms/products/search-suggestions/+server.ts']) {
      const src = readFileSync(f, 'utf-8')
      expect(src, f).toContain('findParentIdsByDetailText')
    }
    vi.clearAllMocks()
  })
})
