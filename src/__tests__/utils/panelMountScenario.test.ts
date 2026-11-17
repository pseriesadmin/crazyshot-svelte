import { describe, it, expect } from 'vitest'
import { pickActiveDetail } from '$lib/utils/holdDetailWhileRefreshing'
import { isPanelDataFor, resolveInitialTab } from '$lib/utils/productPanelTab'

/**
 * 상품목록 패널 마운트 시나리오 (2026-11-16) — +page.svelte 가 쓰는 실제 함수(pickActiveDetail·isPanelDataFor·resolveInitialTab)를
 * 같은 순서로 조합해 '어느 패널이 어떤 탭으로 열리는가'를 검증한다. 화면 마운트 시험(.mount.test.ts)은 설정상 제외돼 있어 이 조합 시험으로 대신한다.
 */
type Prod = { id: string; parent_product_id: string | null }
type Detail = { selectedProduct: Prod | null; rootProduct: { id: string } | null }
const ROOT: Prod = { id: 'R', parent_product_id: null }
const A: Prod = { id: 'A', parent_product_id: 'R' }
const B: Prod = { id: 'B', parent_product_id: 'R' }
const detailOf = (p: Prod): Detail => ({ selectedProduct: p, rootProduct: { id: 'R' } })
const EMPTY: Detail = { selectedProduct: null, rootProduct: null }

/** 화면 한 시점의 결과: 열린 패널(대표/재고)과 탭, 이전 상품 본문(stale) 여부 */
function render(activeSelectedId: string | null, computed: Detail, held: Detail | null, refreshing = computed === EMPTY) {
  const active = pickActiveDetail({ computed, held, activeSelectedId, refreshing })
  const sp = active.selectedProduct
  const mounted = (['R', 'A', 'B'] as const).filter((id) => sp && isPanelDataFor(sp.id, id))
  return {
    mounted,
    tab: sp ? resolveInitialTab({ parentProductId: sp.parent_product_id, initialTab: null, validTabs: ['basic', 'history'] }) : null,
    stale: mounted.length > 0 && mounted[0] !== activeSelectedId,
  }
}

describe('패널 마운트 시나리오', () => {
  it('재고 A 선택 → A 패널이 이력 탭으로 열린다', () => {
    expect(render('A', detailOf(A), detailOf(A))).toEqual({ mounted: ['A'], tab: 'history', stale: false })
  })

  it('A 에서 B 로 전환하는 동안: A 패널 유지(stale), B·대표는 열리지 않음 → 데이터 도착 후 B 만 이력 탭', () => {
    // 조회 중에는 이전 상세(A)가 그대로 computed 로 남는다(PANEL-SWITCH-1)
    expect(render('B', detailOf(A), detailOf(A))).toEqual({ mounted: ['A'], tab: 'history', stale: true })
    expect(render('B', detailOf(B), detailOf(B))).toEqual({ mounted: ['B'], tab: 'history', stale: false })
  })

  it('서버 로드 상세(A)에서 B 로 전환하는 동안(computed=비어 있음, held=A, 조회 중): 이전 A 패널을 붙들지 않고 아무 패널도 열지 않는다', () => {
    // 화면: activeSelectedId(B) !== data.selectedId(A) 이고 overrideDetail 이 아직 없음 → computed 는 EMPTY, refreshing=true
    expect(render('B', EMPTY, detailOf(A), true)).toEqual({ mounted: [], tab: null, stale: false })
    // 조회가 끝나 override 가 B 가 되면 B 만 이력 탭으로 열린다
    expect(render('B', detailOf(B), detailOf(A), false)).toEqual({ mounted: ['B'], tab: 'history', stale: false })
  })

  it('같은 재고가 계속 선택된 채 재조회 중이면(computed=비어 있음, held=A, 선택 id=A) 열려 있던 A 패널을 유지한다', () => {
    expect(render('A', EMPTY, detailOf(A), true)).toEqual({ mounted: ['A'], tab: 'history', stale: false })
  })

  it('재고 B 에서 대표 클릭: 대표 데이터가 올 때까지 대표 패널은 열리지 않고, 오면 기본정보 탭', () => {
    const pending = render('R', detailOf(B), detailOf(B))
    expect(pending.mounted).not.toContain('R')
    expect(pending).toMatchObject({ mounted: ['B'], stale: true })
    expect(render('R', detailOf(ROOT), detailOf(ROOT))).toEqual({ mounted: ['R'], tab: 'basic', stale: false })
  })

  it('닫기(선택 해제)는 어떤 패널도 열지 않는다', () => {
    expect(render(null, EMPTY, detailOf(A))).toEqual({ mounted: [], tab: null, stale: false })
  })

  it('한 시점에 열리는 패널은 최대 1개', () => {
    for (const d of [detailOf(ROOT), detailOf(A), detailOf(B)]) {
      for (const sel of ['R', 'A', 'B', null]) expect(render(sel, d, d).mounted.length).toBeLessThanOrEqual(1)
    }
  })
})
