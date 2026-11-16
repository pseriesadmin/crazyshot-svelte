import { describe, it, expect } from 'vitest'
import { resolveInitialTab, isPanelDataFor } from '$lib/utils/productPanelTab'

const TABS = ['basic', 'options', 'bundles', 'pricing', 'rental', 'content', 'components', 'images', 'specs', 'history'] as const

describe('resolveInitialTab', () => {
  it('자식 재고는 요청 탭·필터와 무관하게 항상 이력', () => {
    expect(resolveInitialTab({ parentProductId: 'p', initialTab: 'basic', validTabs: TABS })).toBe('history')
    expect(resolveInitialTab({ parentProductId: 'p', initialTab: null, validTabs: TABS, tabsFilter: ['pricing'] })).toBe('history')
  })
  it('부모는 유효한 요청 탭을 따르고, 없거나 무효면 기본정보', () => {
    expect(resolveInitialTab({ initialTab: 'pricing', validTabs: TABS })).toBe('pricing')
    expect(resolveInitialTab({ initialTab: null, validTabs: TABS })).toBe('basic')
    expect(resolveInitialTab({ initialTab: 'nope', validTabs: TABS })).toBe('basic')
  })
  it('탭 필터가 있으면 필터 밖 탭은 필터 첫 탭', () => {
    expect(resolveInitialTab({ initialTab: 'pricing', validTabs: TABS, tabsFilter: ['content', 'images'] })).toBe('content')
  })
  it('결합상품 탭은 결합상품에서만', () => {
    expect(resolveInitialTab({ initialTab: 'bundles', validTabs: TABS, isBundleProduct: false })).toBe('basic')
    expect(resolveInitialTab({ initialTab: 'bundles', validTabs: TABS, isBundleProduct: true })).toBe('bundles')
  })
})

describe('isPanelDataFor — 이전 상품 데이터로 패널을 열지 않는다', () => {
  it('상세 데이터 id 가 대상 id 와 같을 때만 true', () => {
    expect(isPanelDataFor('child-1', 'child-1')).toBe(true)
    expect(isPanelDataFor('parent', 'child-1')).toBe(false)
    expect(isPanelDataFor(null, 'child-1')).toBe(false)
    expect(isPanelDataFor(undefined, 'child-1')).toBe(false)
  })
})
