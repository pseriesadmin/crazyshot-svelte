/**
 * 상품목록 상세 패널 — 저장 후 재조회 중 패널 유지 규칙 (2026-10-08)
 *
 * 증상: 상품 수정 '저장' 직후 패널이 닫혔다 다시 열리고, 보던 탭(예: 구성품)이 기본정보로 돌아갔다.
 * 원인: 저장 후 invalidateAll() 재조회 동안 "열린 상품 id"와 서버 load의 선택 id가 어긋나면 화면이
 *       비어 있는 상세를 임시로 써서 패널이 unmount → 상세 fetch 후 새 컴포넌트로 remount(탭 초기화).
 * 규칙: 같은 상품이 계속 선택된 상태에서 "재조회가 진행 중이라" 상세가 일시적으로 비면 마지막 정상 상세를 유지한다.
 *       진행 중이 아닌데 비어 있는 경우(열려 있던 상품이 삭제됨 등)·닫기·다른 상품 선택·붙들 값 없음은 그대로 비운다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickActiveDetail } from '$lib/utils/holdDetailWhileRefreshing'

type Detail = { selectedProduct: { id: string } | null; rootProduct: { id: string } | null; tag: string }

const EMPTY: Detail = { selectedProduct: null, rootProduct: null, tag: 'empty' }
const full = (id: string, tag: string, root = id): Detail => ({ selectedProduct: { id }, rootProduct: { id: root }, tag })

describe('pickActiveDetail — 재조회 중 패널 유지', () => {
  it('HD-1 정상 상세가 있으면 그대로 사용한다(held 무시)', () => {
    const computed = full('p1', 'new')
    expect(pickActiveDetail({ computed, held: full('p1', 'old'), activeSelectedId: 'p1', refreshing: true }).tag).toBe('new')
  })

  it('HD-2 같은 상품 선택 중 재조회가 진행 중이라 상세가 일시적으로 비면 마지막 정상 상세를 유지한다(패널이 닫히지 않음)', () => {
    const held = full('p1', 'old')
    const r = pickActiveDetail({ computed: EMPTY, held, activeSelectedId: 'p1', refreshing: true })
    expect(r.tag).toBe('old')
    expect(r.rootProduct).not.toBeNull()
  })

  it('HD-3 선택이 해제되면(닫기) 유지하지 않고 빈 상세로 닫는다', () => {
    const r = pickActiveDetail({ computed: EMPTY, held: full('p1', 'old'), activeSelectedId: null, refreshing: true })
    expect(r.rootProduct).toBeNull()
  })

  it('HD-4 다른 상품으로 바뀐 경우 이전 상품 상세를 쓰지 않는다', () => {
    const r = pickActiveDetail({ computed: EMPTY, held: full('p1', 'old'), activeSelectedId: 'p2', refreshing: true })
    expect(r.rootProduct).toBeNull()
  })

  it('HD-5 붙들어 둔 상세가 없으면(처음 열기) 빈 상세 그대로', () => {
    const r = pickActiveDetail({ computed: EMPTY, held: null, activeSelectedId: 'p1', refreshing: true })
    expect(r.rootProduct).toBeNull()
  })

  it('HD-6 재고(자식) 선택 상태도 같은 규칙: selectedProduct는 자식, 대표(root)는 부모', () => {
    const held = full('child1', 'old', 'parent1')
    const r = pickActiveDetail({ computed: EMPTY, held, activeSelectedId: 'child1', refreshing: true })
    expect(r.tag).toBe('old')
    expect(r.rootProduct?.id).toBe('parent1')
  })

  it('HD-7 붙들어 둔 상세 자체가 비어 있으면(대표 없음) 유지하지 않는다', () => {
    const r = pickActiveDetail({ computed: EMPTY, held: { selectedProduct: { id: 'p1' }, rootProduct: null, tag: 'broken' }, activeSelectedId: 'p1', refreshing: true })
    expect(r.rootProduct).toBeNull()
  })

  it('HD-8 [검수 MAJOR-1] 재조회가 진행 중이 아닌데 상세가 비면(열려 있던 상품이 삭제됨) 붙들지 않고 닫는다', () => {
    const r = pickActiveDetail({ computed: EMPTY, held: full('p1', 'old'), activeSelectedId: 'p1', refreshing: false })
    expect(r.rootProduct).toBeNull()
  })
})

describe('배선 — 상품목록 화면이 진행 중 조건을 정확히 넘긴다', () => {
  const src = readFileSync('src/routes/cms/products/+page.svelte', 'utf-8')

  it('HD-9 activeDetail은 pickActiveDetail에서만 나오고 refreshing은 "id 불일치 && 조회 결과 없음"이다', () => {
    expect(src).toContain('pickActiveDetail({')
    expect(src).toContain('refreshing: activeSelectedId !== data.selectedId && overrideDetail === null')
  })

  it('HD-10 computedDetail은 계산·보관·선택 3곳에서만 쓰인다(소비처가 우회로 쓰지 않음)', () => {
    const uses = src.match(/\bcomputedDetail\b/g) ?? []
    // 정의 1 + heldDetail effect 1(읽기) + pickActiveDetail 인자 1 + 주석 언급 — 소비처(템플릿)에서는 쓰이지 않아야 한다
    const inTemplate = src.slice(src.indexOf('</script>')).match(/\bcomputedDetail\b/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(3)
    expect(inTemplate).toHaveLength(0)
  })
})
