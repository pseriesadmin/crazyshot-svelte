import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 상품목록 상세 패널 마운트 가드 (2026-11-16) — 동작 규칙은 productPanelTab.test.ts, 여기서는 화면이 그 규칙을 실제로 쓰는지만 확인한다.
 * 증상: 자식 재고(또는 대표) 선택 직후 패널이 이전 상품 데이터로 먼저 마운트돼 탭이 '기본정보'/'이력'으로 잘못 고정됐다.
 */
const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '') // 주석 속 문자열로 통과하는 것을 막는다

describe('cms/products 패널 마운트', () => {
  const page = strip(readFileSync('src/routes/cms/products/+page.svelte', 'utf8'))
  const panel = readFileSync('src/lib/components/cms/ProductDetailPanel.svelte', 'utf8')

  it('재고 패널은 상세 데이터 id 가 그 재고일 때만 마운트하고 키는 실제 상품 id', () => {
    expect(page).toMatch(/\{#if activeDetail\.selectedProduct && isPanelDataFor\(activeDetail\.selectedProduct\.id, unit\.id\)\}[\s\S]{0,200}\{#key activeDetail\.selectedProduct\.id\}/)
  })

  it('대표 패널도 상세 데이터 id 가 대표 id 일 때만 마운트하고 키는 실제 상품 id', () => {
    expect(page).toMatch(/\{#if repBodyOpen && activeDetail\.selectedProduct && isPanelDataFor\(activeDetail\.selectedProduct\.id, rp\.id\)\}[\s\S]{0,200}\{#key activeDetail\.selectedProduct\.id\}/)
  })

  it('활성 선택 id 만으로 패널을 열던 옛 조건이 남아 있지 않다', () => {
    expect(page).not.toMatch(/\{#if isActive && activeDetail\.selectedProduct\}/)
    expect(page).not.toMatch(/\{#if isRootOpen && repBodyOpen && activeDetail\.selectedProduct\}/)
  })

  it('패널은 초기 탭을 resolveInitialTab 으로 정하고, 이전 상품 데이터로 마운트되는 경로를 화면 쪽 조건으로 막는다', () => {
    expect(panel).toContain('resolveInitialTab<TabKey>(')
    expect(page).toContain('class:inv-acc-body--stale={!isActive}')
    expect(page).toContain('class:rep-body--stale={!isRootOpen}')
  })
})
