/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  RESERVATION_COMPOSITION_EDIT_ENABLED,
  COMPOSITION_EDIT_BLOCKED_MESSAGE,
} from '$lib/utils/reservationCompositionPolicy'

/**
 * 예약 구성(상품 추가·삭제·재고 수량·옵션 추가/수량/삭제) 관리자 직접 편집 차단 정책 (2026-10-06, Stephen 확정).
 * 가격·계약 내용이 바뀌는 편집은 화면과 서버에서 모두 막고, 재고 재배정·조회는 유지한다.
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf-8')
const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
const productsApi = read('src/routes/api/cms/reservations/[id]/products/+server.ts')
const optionsApi = read('src/routes/api/cms/reservations/[id]/options/+server.ts')

const GATE = 'if (!RESERVATION_COMPOSITION_EDIT_ENABLED) return json({ error: COMPOSITION_EDIT_BLOCKED_MESSAGE }, { status: 403 })'

/** `export const NAME: RequestHandler` 부터 다음 `export const` 직전까지 */
function handlerSource(src: string, name: string): string {
  const start = src.indexOf(`export const ${name}: RequestHandler`)
  expect(start, `${name} 핸들러`).toBeGreaterThan(-1)
  const next = src.indexOf('export const ', start + 10)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('예약 구성 관리자 직접 편집 차단 정책', () => {
  it('정책 상수는 false이고 차단 안내 문구가 있다', () => {
    expect(RESERVATION_COMPOSITION_EDIT_ENABLED).toBe(false)
    expect(COMPOSITION_EDIT_BLOCKED_MESSAGE).toContain('예약변경')
  })

  it('패널: canEditProducts는 정책 상수를 반드시 함께 본다(상수가 false면 편집 UI 전부 숨김)', () => {
    const def = panel.slice(panel.indexOf('let canEditProducts = $derived('))
    expect(def.slice(0, 240)).toContain('RESERVATION_COMPOSITION_EDIT_ENABLED &&')
  })

  it('패널: 편집 핸들러 버튼은 전부 canEditProducts/canEditUnit 조건 블록 안에서만 렌더링된다', () => {
    const lines = panel.split('\n')
    const handlers = [
      'onclick={openProductFinder}', 'onclick={openOptionFinder}',
      'handleGroupQtyIncrease(group.representative)', 'handleDeleteProduct(unit)',
      'handleDeleteOption(opt)', 'handleOptionQtyChange(opt.id, opt.qty - 1)', 'handleOptionQtyChange(opt.id, opt.qty + 1)',
    ]
    for (const h of handlers) {
      const idx = lines.findIndex(l => l.includes(h))
      expect(idx, `${h} 존재`).toBeGreaterThan(-1)
      const win = lines.slice(Math.max(0, idx - 14), idx + 1).join('\n')
      expect(win, `${h} 상위 조건`).toMatch(/\{#if (canEditProducts|canEditUnit\(unit\))/)
    }
  })

  it('패널: 재배정 버튼(본체·결합상품)은 이 정책과 무관하게 canReassignUnit 가드로 유지된다', () => {
    expect(panel).toContain('aria-label="상품코드 재배정"')
    expect(panel).toContain('aria-label="결합상품 재배정"')
    expect(panel).toMatch(/\{#if canReassignUnit\(unit\)\}\s*<button[^>]*class="btn-reassign-small"/)
  })

  it('API products: 추가(POST)·삭제(DELETE)는 권한 확인 뒤 403으로 차단, 재배정(PATCH)은 차단하지 않는다', () => {
    for (const name of ['POST', 'DELETE']) {
      const src = handlerSource(productsApi, name)
      expect(src, name).toContain(GATE)
      // 권한 확인(401/403) 뒤에 게이트가 와야 한다 — 비인증 요청이 정책 문구를 먼저 보지 못하게
      expect(src.indexOf('hasSettingsAccess(cmsRole)'), name).toBeLessThan(src.indexOf('RESERVATION_COMPOSITION_EDIT_ENABLED'))
      expect(src.indexOf('RESERVATION_COMPOSITION_EDIT_ENABLED'), name).toBeLessThan(src.indexOf('admin.rpc'))
    }
    expect(handlerSource(productsApi, 'PATCH')).not.toContain('RESERVATION_COMPOSITION_EDIT_ENABLED')
  })

  it('API options: 추가(POST)·수량(PATCH)·삭제(DELETE)는 차단, 조회(GET)는 유지', () => {
    for (const name of ['POST', 'PATCH', 'DELETE']) {
      const src = handlerSource(optionsApi, name)
      expect(src, name).toContain(GATE)
      expect(src.indexOf('hasSettingsAccess(cmsRole)'), name).toBeLessThan(src.indexOf('RESERVATION_COMPOSITION_EDIT_ENABLED'))
      // 차단된 요청은 RPC까지 가지 않는다
      expect(src.indexOf('RESERVATION_COMPOSITION_EDIT_ENABLED'), name).toBeLessThan(src.indexOf('admin.rpc'))
    }
    expect(handlerSource(optionsApi, 'GET')).not.toContain('RESERVATION_COMPOSITION_EDIT_ENABLED')
  })

  it('옵션상품: 옵션이 없고 편집이 막힌 예약은 섹션이 안 보이고(조회 중 포함), 옵션이 있으면 나타난다', () => {
    const start = panel.indexOf('{#if optionsLoading}')
    const seg = panel.slice(start, start + 900)
    // 조회 중 분기에는 머리글·로딩 박스를 그리지 않는다
    const loadingBranch = seg.slice(0, seg.indexOf('{:else if optionsError}'))
    expect(loadingBranch).not.toContain('section-title')
    expect(loadingBranch).not.toContain('loading-box')
    // 옵션이 있을 때만(또는 편집 가능일 때만) 섹션을 그린다
    expect(seg).toContain('{:else if options.length > 0 || canEditProducts}')
  })

  it('구성 변경 RPC 호출은 이 두 API 파일에만 있다(다른 경로로 우회 불가)', () => {
    const rpcs = [
      'cms_add_reservation_product_unit', 'cms_remove_reservation_product_unit',
      'cms_add_reservation_option', 'cms_update_reservation_option_qty', 'cms_delete_reservation_option',
    ]
    for (const r of rpcs) {
      expect(panel, r).not.toContain(`'${r}'`)
      expect([productsApi, optionsApi].filter(s => s.includes(`'${r}'`)).length, r).toBe(1)
    }
  })
})
