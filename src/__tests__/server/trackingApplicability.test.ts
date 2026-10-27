/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 고정된 프로젝트 소스 경로를 읽는 용도 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTrackingApplicability } from '../../lib/server/trackingApplicability'

/**
 * 운송장 정보는 수령방식이 배송형(is_delivery_type)일 때만 (2026-10-27, Stephen 지시 — 서버 방어 포함)
 *  AP-1  배송형이면 true, 아니면 false, 수령방식이 비어 있으면 false
 *  AP-2  예약·방식 행을 못 읽거나 조회 오류·예외면 null(알 수 없음 — 호출부가 fail-open)
 *  AP-3  화면(RentalDetailPanel): 수동 운송장 영역은 tracking_applicable 이 true 일 때만 보이고, 알 수 없을 때(응답 필드 없음·조회 실패)는 보인다
 */

type Row = { data: unknown; error?: unknown }
function admin(reservation: Row, method?: Row) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const result = table === 'rental_method_options' ? method : reservation
          const chain = { maybeSingle: async () => result ?? { data: null, error: null } }
          return table === 'rental_method_options' ? { is: () => chain } : chain
        },
      }),
    }),
  }
}

describe('getTrackingApplicability', () => {
  it('AP-1: 배송형 true / 비배송형 false / 수령방식 없음 false', async () => {
    expect(await getTrackingApplicability(admin({ data: { pickup_method: 'delivery' } }, { data: { is_delivery_type: true } }), 1)).toBe(true)
    expect(await getTrackingApplicability(admin({ data: { pickup_method: 'visit' } }, { data: { is_delivery_type: false } }), 1)).toBe(false)
    expect(await getTrackingApplicability(admin({ data: { pickup_method: null } }), 1)).toBe(false)
    expect(await getTrackingApplicability(admin({ data: { pickup_method: '' } }), 1)).toBe(false)
  })

  it('AP-2: 읽지 못하면 null (알 수 없음)', async () => {
    expect(await getTrackingApplicability(admin({ data: null }), 1)).toBeNull()
    expect(await getTrackingApplicability(admin({ data: null, error: { message: 'x' } }), 1)).toBeNull()
    expect(await getTrackingApplicability(admin({ data: { pickup_method: 'x' } }, { data: null }), 1)).toBeNull()
    expect(await getTrackingApplicability(admin({ data: { pickup_method: 'x' } }, { data: null, error: { message: 'y' } }), 1)).toBeNull()
    const boom = { from: () => { throw new Error('db down') } }
    expect(await getTrackingApplicability(boom, 1)).toBeNull()
  })
})

describe('RentalDetailPanel — 운송장 영역 노출 조건', () => {
  const panel = readFileSync(join(process.cwd(), 'src/lib/components/cms/RentalDetailPanel.svelte'), 'utf-8')
  it('AP-3: tracking_applicable 이 true 일 때만 수동 운송장 영역을 그리고, 비배송형(false)은 숨긴다', () => {
    expect(panel).toContain('tracking_applicable')
    expect(panel).toMatch(/\{:else if trackingApplicable === true\}/)
    // 응답에 값이 없거나 조회가 실패하면 영역을 숨기지 않는다(fail-open)
    expect(panel).toMatch(/trackingApplicable\s*=\s*d\.tracking_applicable === false \? false : true/)
  })
})
