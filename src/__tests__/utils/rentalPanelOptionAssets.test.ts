/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 옵션상품 실물 배정·재배정 화면/API 구조 (Migration 654, 2026-10-06).
 * 옵션 1행 × qty = 실물 qty건. 옵션 카드 안에 상품 코드 행(+ 재배정)이 qty개 나오고, 메인·결합상품과 같은 재배정 줄을 쓴다.
 * 옵션 추가·수량·삭제는 정책(reservationCompositionPolicy.ts)으로 차단돼 있고 재배정 경로는 그 차단과 무관하다.
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8')
const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
const assetsApi = read('src/routes/api/cms/reservations/[id]/options/assets/+server.ts')
const availableApi = read('src/routes/api/cms/reservations/[id]/options/assets/available/+server.ts')
const optionsApi = read('src/routes/api/cms/reservations/[id]/options/+server.ts')

function handlerSource(src: string, name: string): string {
  const start = src.indexOf(`export const ${name}: RequestHandler`)
  expect(start, `${name} 핸들러`).toBeGreaterThan(-1)
  const next = src.indexOf('export const ', start + 10)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('RentalDetailPanel — 옵션상품 실물 배정·재배정', () => {
  const start = panel.indexOf('{#each options as opt (opt.id)}')
  const end = panel.indexOf('<!-- 대여 일정 -->', start)
  const card = panel.slice(start, end)

  it('옵션 카드: 옵션 행의 배정 목록마다 상품 코드 행 + 재배정 버튼(.unit-block 구조)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(card).toContain('{#each optionAssetsByOption[opt.id] ?? [] as oa, i (oa.id)}')
    expect(card).toContain('<div class="unit-block" class:unit-block--open={canReassignProductCode && optionAssetReassignId === oa.id}>')
    expect(card).toContain('aria-label="옵션상품 재배정"')
    expect(card.indexOf('{oa.product_code ?? ')).toBeLessThan(card.indexOf('aria-label="옵션상품 재배정"'))
    expect(card.indexOf('<div class="reassign-row">')).toBeGreaterThan(card.indexOf('aria-label="옵션상품 재배정"'))
  })

  it('재배정 버튼은 hold·confirmed 가드(canReassignProductCode)로만 보인다', () => {
    const btn = card.indexOf('aria-label="옵션상품 재배정"')
    expect(card.slice(Math.max(0, btn - 400), btn)).toContain('{#if canReassignProductCode}')
  })

  it('배정이 없는 옵션(반출 이후·가용 재고 없음·레거시)은 기존 상품 코드 행으로 폴백한다', () => {
    expect(card).toContain('{:else if opt.product_code}')
  })

  it('옵션 카드에 구성 편집 UI가 새로 늘지 않았다(수량/삭제는 정책으로 canEditProducts 안에서만)', () => {
    for (const h of ['handleOptionQtyChange', 'handleDeleteOption']) {
      for (const m of card.matchAll(new RegExp(h, 'g'))) {
        const win = card.slice(Math.max(0, m.index - 900), m.index)
        expect(win, h).toMatch(/\{#if canEditProducts\}/)
      }
    }
  })

  it('배정 조회는 예약이 바뀔 때 다시 하고(다른 예약의 열린 재배정 줄은 닫는다), 재배정 성공 후 재조회한다', () => {
    expect(panel).toMatch(/optionAssetsAnchorId = row\.reservation_id[\s\S]{0,260}optionAssetReassignId = null[\s\S]{0,160}loadOptionAssets\(row\.reservation_id\)/)
    expect(panel).toMatch(/옵션상품 재고가 재배정됐습니다\.[\s\S]{0,120}await loadOptionAssets\(row\.reservation_id\)/)
  })

  it('옵션 카드는 재배정 줄이 열려 있는 동안 박스 클리핑을 해제한다(picker-open)', () => {
    expect(card).toMatch(/class:picker-open=\{optionAssetReassignId !== null && \(optionAssetsByOption\[opt\.id\] \?\? \[\]\)\.some/)
  })
})

describe('옵션상품 실물 API', () => {
  it('assets: 조회(GET)는 메뉴권한 + 세션 역할, 보정 배정은 manager 이상만, 재배정(PATCH)은 manager 이상', () => {
    const get = handlerSource(assetsApi, 'GET')
    expect(get.indexOf('requireMenuAccessApi')).toBeLessThan(get.indexOf('getCmsRoleForAction'))
    expect(get).toMatch(/if \(hasSettingsAccess\(cmsRole\)\) \{[\s\S]{0,200}cms_ensure_reservation_option_assets/)
    const patch = handlerSource(assetsApi, 'PATCH')
    expect(patch.indexOf('hasSettingsAccess(cmsRole)')).toBeLessThan(patch.indexOf('admin.rpc'))
    expect(patch).toContain('cms_reassign_option_asset')
    // 입력 검증: 깨진 JSON → 400, 배정 행 id 정수, 새 실물 UUID
    expect(patch).toContain("요청 본문이 올바르지 않습니다.")
    expect(patch).toContain('UUID_RE.test(body.new_asset_id)')
  })

  it('assets: 구성 편집 차단 정책 상수와 무관하다(재배정 전용)', () => {
    expect(assetsApi).not.toContain('RESERVATION_COMPOSITION_EDIT_ENABLED')
    expect(availableApi).not.toContain('RESERVATION_COMPOSITION_EDIT_ENABLED')
  })

  it('available: manager 이상 + 후보 RPC 호출, 품번 정렬 정본(availableUnitOrder) 사용', () => {
    expect(availableApi.indexOf('hasSettingsAccess(cmsRole)')).toBeLessThan(availableApi.indexOf('admin.rpc'))
    expect(availableApi).toContain('cms_list_option_asset_candidates')
    expect(availableApi).toContain('sortUnitsByCode')
  })

  it('옵션 추가·수량·삭제 핸들러는 여전히 정책으로 차단돼 있다(이 기능이 우회로가 되지 않는다)', () => {
    for (const name of ['POST', 'PATCH', 'DELETE']) {
      expect(handlerSource(optionsApi, name), name).toContain('RESERVATION_COMPOSITION_EDIT_ENABLED')
    }
  })

  it('본체 재배정 후보(available-units)는 다른 예약의 결합·옵션 배정 점유도 제외한다(Migration 657, DB 함수와 같은 기준)', () => {
    const units = read('src/routes/api/cms/reservations/[id]/available-units/+server.ts')
    expect(units).toContain("'reservation_bundle_assets'")
    expect(units).toContain("'reservation_option_assets'")
    // 두 배정표 모두 예약 상태·기간 겹침('[]' = lte/gte)으로 거르고, 점유 유닛을 busyIds에 합친다
    expect(units).toMatch(/rental_reservations!inner\(status, start_date, end_date\)/)
    expect(units).toMatch(/\.lte\('rental_reservations\.start_date', endDate\)[\s\S]{0,120}\.gte\('rental_reservations\.end_date', startDate\)/)
    expect(units).toContain('busyIds.add(')
  })
})
