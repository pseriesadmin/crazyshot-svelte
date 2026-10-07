/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 예약상세 '상품 코드' 행과 '재배정' 줄(로딩·오류·없음·자동선택·품번 검색)은 하나의 레이아웃 그룹(.unit-block)이다(2026-10-06).
 * 그룹 안에는 구분선이 없고 아래 구분선은 그룹 전체에 1줄, 재배정이 열린 동안은 면(fill)으로 묶어 보인다(테두리·그림자 추가 금지).
 */
const src = readFileSync(join(process.cwd(), 'src/lib/components/cms/RentalDetailPanel.svelte'), 'utf-8')

describe('RentalDetailPanel — 상품 코드 + 재배정 그룹', () => {
  const start = src.indexOf('{#each group.units as unit, i (unit.key)}')
  const end = src.indexOf('{#if canEditProducts && group.representative.parentProductId}', start)
  const block = src.slice(start, end)

  it('유닛마다 .unit-block 래퍼 하나가 상품 코드 행과 재배정 줄을 함께 감싼다', () => {
    expect(start).toBeGreaterThan(-1)
    const wrapAt = block.indexOf('<div class="unit-block"')
    expect(wrapAt).toBeGreaterThan(-1)
    // 메인 상품 코드 블록 1개 + 그 아래 결합상품 행 템플릿 1개(2026-10-06, Migration 652)
    expect(block.match(/<div class="unit-block"/g)?.length).toBe(2)
    expect(block.match(/<div class="unit-block" class:unit-block--open/g)?.length).toBe(2)
    expect(block.indexOf('{#each bundleAssetsByRes')).toBeGreaterThan(block.indexOf('<div class="unit-block"'))
    expect(block.indexOf('class="info-row"')).toBeGreaterThan(wrapAt)
    expect(block.indexOf('<div class="reassign-row">')).toBeGreaterThan(block.indexOf('class="info-row"'))
  })

  it('결합상품 행: 메인 상품 코드 블록 바로 아래, 상품명 + 상품코드 + 우측 [재배정] + 같은 재배정 줄 구조', () => {
    const main = block.indexOf('<div class="unit-block"')
    const bundleEach = block.indexOf('{#each bundleAssetsByRes[unit.reservationId] ?? [] as asset (asset.id)}')
    expect(bundleEach).toBeGreaterThan(main)
    const bundle = block.slice(bundleEach)
    expect(bundle).toContain('<span class="info-label">결합상품</span>')
    expect(bundle.indexOf('{asset.bundle_name}')).toBeGreaterThan(-1)
    expect(bundle.indexOf('{asset.product_code ?? ')).toBeGreaterThan(bundle.indexOf('{asset.bundle_name}'))
    expect(bundle.indexOf('aria-label="결합상품 재배정"')).toBeGreaterThan(bundle.indexOf('{asset.product_code ?? '))
    // 같은 상태 가드(canReassignUnit)와 열린 동안 면 처리(--open) 수정자
    expect(bundle).toMatch(/canReassignUnit\(unit\) && bundleReassignKey === bKey/)
    expect(bundle).toContain('<div class="reassign-row">')
    expect(bundle).toContain('handleBundleReassign(unit.reservationId, asset.bundle_product_id')
  })

  it('본체 재배정 줄: 결합 패키지면 결합상품 자동 재배정 안내가 보이고, 성공 후 결합상품 행을 다시 불러온다', () => {
    const mainReassign = block.indexOf('<div class="reassign-row">')
    const note = block.indexOf('<p class="reassign-note">')
    expect(note).toBeGreaterThan(mainReassign)
    expect(block.slice(note - 200, note)).toContain('bundleAssetsByRes[unit.reservationId]')
    // 결합상품 줄의 재배정 줄(두 번째 reassign-row)보다 앞, 즉 본체 줄 안에 있다
    expect(note).toBeLessThan(block.indexOf('{#each bundleAssetsByRes'))
    expect(src).toMatch(/hadBundles[\s\S]{0,260}loadBundleAssets\(targetReservationId\)/)
  })

  it('옛 위치(옵션상품 아래의 별도 "결합상품 (N개)" 조회 전용 섹션)는 더 이상 없다', () => {
    expect(src).not.toContain('<div class="section-title">결합상품 (')
    expect(src).not.toContain('bundleAssets.length')
  })

  it('배치 순서: 상품명 → 카테고리 → 상품 코드 그룹(+ 재고 추가) (2026-10-06 위치 교체)', () => {
    const name = src.indexOf('<span class="info-label">상품명</span>')
    const cat = src.indexOf('<span class="info-label">카테고리</span>', name)
    const units = src.indexOf('{#each group.units as unit, i (unit.key)}', name)
    const add = src.indexOf('{#if canEditProducts && group.representative.parentProductId}', name)
    expect(name).toBeGreaterThan(-1)
    expect(cat).toBeGreaterThan(name)
    expect(units).toBeGreaterThan(cat)
    expect(add).toBeGreaterThan(units)
  })

  it('마지막 그룹의 아래 구분선은 박스 테두리와 겹치지 않게 제거', () => {
    expect(src).toMatch(/\.unit-block:last-child\s*\{[^}]*border-bottom:\s*none/)
  })

  it('재배정이 열린 동안 --open 수정자가 붙는다', () => {
    expect(block).toMatch(/class:unit-block--open=\{[^}]*reassignTargetId === unit\.reservationId[^}]*\}/)
  })

  it('CSS: 그룹 아래 구분선 1줄 + 내부 행 구분선 제거 + 열린 동안 면 처리(테두리·그림자 없음)', () => {
    expect(src).toMatch(/\.unit-block\s*\{[^}]*border-bottom:\s*1px solid var\(--cs-lilac\)/)
    expect(src).toMatch(/\.unit-block \.info-row\s*\{[^}]*border-bottom:\s*none/)
    const open = src.match(/\.unit-block--open\s*\{([^}]*)\}/)
    expect(open).not.toBeNull()
    expect(open![1]).toMatch(/background:/)
    expect(open![1]).not.toMatch(/border|box-shadow|outline/)
  })
})
