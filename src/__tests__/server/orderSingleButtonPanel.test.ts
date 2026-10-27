/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 고정된 프로젝트 소스 경로를 읽는 용도 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ④ 주문 단위 단일 처리 버튼 — 패널 구조 가드 (2026-10-27, Stephen 확정 "하단 버튼 하나, 안전장치 생략")
 *  SB-1  상품별 처리 줄(unit-actions·unit-action-row)과 그 CSS 가 없다 — 위 "상품 정보"와 정보가 중복이던 줄 제거
 *  SB-2  다상품 주문은 하단 버튼 하나가 updateOrderStatus 를, 단일 상품 주문은 기존 updateStatus 를 호출한다
 *  SB-3  결과는 summarizeOrderTransition 문구로 알리고(일부 실패·건너뜀 포함) 두발히어로 접수 실패 경고와 새로고침은 유지한다
 *  SB-4  서버 액션이 있고 주문 단위 처리가 단건과 같은 공용 함수·두발히어로 공용 함수를 쓴다
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')
const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
const server = read('src/routes/cms/reservation/+page.server.ts')

describe('RentalDetailPanel — 하단 버튼 하나', () => {
  it('SB-1: 상품별 처리 줄과 CSS 제거', () => {
    expect(panel).not.toContain('class="unit-actions"')
    expect(panel).not.toContain('unit-action-row')
    expect(panel).not.toMatch(/\.unit-actions\s*\{/)
    expect(panel).not.toMatch(/\.unit-action-(row|name|status)\s*\{/)
  })

  it('SB-2: 다상품은 updateOrderStatus, 단일은 updateStatus', () => {
    expect(panel).toContain('/cms/reservation?/updateOrderStatus')
    expect(panel).toMatch(/isMultiOrder\s*\?\s*'\/cms\/reservation\?\/updateOrderStatus'\s*:\s*'\/cms\/reservation\?\/updateStatus'/)
  })

  it('SB-3: 결과 문구·두발히어로 경고·새로고침 유지', () => {
    expect(panel).toContain('summarizeOrderTransition')
    expect(panel).toContain('dhero_book_failed')
    expect(panel).toMatch(/rentalSiblingsFetchedForId = null/)
  })
})

describe('서버 — 주문 단위 처리', () => {
  it('SB-4: updateOrderStatus 가 공용 함수를 재사용한다', () => {
    expect(server).toMatch(/updateOrderStatus:\s*async/)
    expect(server).toContain('updateStatusCore(ctx, id, newStatus, { skipNotify: true, skipDhero: true })')
    expect(server).toContain('triggerDheroForTransition(admin, processed, newStatus)')
    expect(server).toMatch(/updateStatus:\s*async[\s\S]{0,900}updateStatusCore\(\{ admin, session, cmsRole \}, reservationId, newStatus\)/)
  })
})
