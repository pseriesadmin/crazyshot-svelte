import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isDheroCanceled, dheroStatusLabel, liveDheroBookings } from '../../lib/utils/dheroLabels'

/**
 * 두발히어로 쪽 취소 정보 기록·표시 (2026-10-27, Stephen 지시)
 * 취소돼도 status 코드는 그대로(0 등)라 canceledAt 으로만 구분한다(dev 실험).
 *
 * DX-1 canceledAt 이 비어 있지 않은 문자열일 때만 취소로 본다
 * DX-2 취소면 라벨 '취소', 아니면 코드 라벨
 * DX-3 패널 구조 가드: 취소 정보 행 + 재접수 버튼이 있고, 취소 상태에서 '배송 취소'·'반송 등록' 버튼은 숨긴다
 * DX-4 동기화(크론)·상태 조회 API 가 취소를 반영한 라벨을 저장한다
 * DX-5 같은 접수번호를 가진 형제 중 하나라도 취소로 기록돼 있으면 그 접수 전체를 취소로 본다(형제 meta 지연 대응)
 * DX-6 다른 택배사 운송장은 canceledAt 이 있어도 살아 있는 것으로 본다(courier 조건)
 */
describe('두발히어로 취소 판정·표시', () => {
  it('DX-1: canceledAt 이 있어야 취소', () => {
    expect(isDheroCanceled({ canceledAt: '2026-10-27 15:34:52' })).toBe(true)
    expect(isDheroCanceled({ canceledAt: null })).toBe(false)
    expect(isDheroCanceled({ canceledAt: '' })).toBe(false)
    expect(isDheroCanceled({ canceledAt: '  ' })).toBe(false)
    expect(isDheroCanceled({})).toBe(false)
    expect(isDheroCanceled(null)).toBe(false)
  })

  it('DX-2: 취소면 라벨 취소, 아니면 코드 라벨(알 수 없는 코드는 숫자 그대로)', () => {
    expect(dheroStatusLabel({ status: 0, canceledAt: '2026-10-27 15:34:52' })).toBe('취소')
    expect(dheroStatusLabel({ status: 0, canceledAt: null })).toBe('배송접수')
    expect(dheroStatusLabel({ status: 5 })).toBe('배송완료')
    expect(dheroStatusLabel({ status: 99 })).toBe('99')
  })

  it('DX-3: 패널은 취소 정보·재접수를 보여주고 취소 상태에서 취소·반송 버튼을 숨긴다', () => {
    const src = readFileSync('src/lib/components/cms/RentalDetailPanel.svelte', 'utf8')
    expect(src).toContain('let dheroCanceled      = $derived(isDheroCanceled(dheroData))')
    expect(src).toContain('두발히어로 취소')
    expect(src).toContain('두발히어로 배송 재접수')
    const block = src.slice(src.indexOf('{#if dheroCanceled}\n              <!-- 두발히어로 쪽에서 이미 취소된 접수'))
    const iCancelBtn = block.indexOf('배송 취소')
    const iElse = block.indexOf('{:else}')
    expect(iElse).toBeGreaterThan(0)
    expect(iCancelBtn).toBeGreaterThan(iElse) // 취소·반송 버튼은 {:else}(취소 아님) 쪽에만 있다
  })

  it('DX-4: 동기화 크론과 상태 조회 API 는 취소를 반영한 라벨로 저장한다', () => {
    const cron = readFileSync('src/routes/api/cron/dhero-sync/+server.ts', 'utf8')
    const api = readFileSync('src/routes/api/cms/reservations/[id]/dhero/+server.ts', 'utf8')
    expect(cron).not.toContain('DHERO_STATUS_LABEL[')
    expect(cron).toContain('dheroStatusLabel(status)')
    expect(api).toContain('dheroStatusLabel(status)')
    expect(api).toContain('dheroStatusLabel(returnStatus)')
  })

  it('DX-5: 같은 접수번호 형제 중 한쪽만 취소로 기록돼도 그 접수 전체를 취소로 본다', () => {
    const canceled = { trackingNumber: 'B1', courierCode: '두발히어로', dheroMeta: { canceledAt: '2026-10-27 15:00:00' } }
    const stale = { trackingNumber: 'B1', courierCode: '두발히어로', dheroMeta: { canceledAt: null } } // 형제는 아직 모름
    expect(liveDheroBookings([canceled, stale])).toEqual([])
    expect(liveDheroBookings([stale, canceled])).toEqual([])
    // 다른 접수번호는 영향 없음
    const other = { trackingNumber: 'B2', courierCode: '두발히어로', dheroMeta: null }
    expect(liveDheroBookings([canceled, stale, other])).toEqual([other])
    // 운송장 없는 예약은 제외
    expect(liveDheroBookings([{ trackingNumber: null, courierCode: null, dheroMeta: null }])).toEqual([])
  })

  it('DX-6: 다른 택배사 운송장은 canceledAt 이 있어도 살아 있는 것으로 본다', () => {
    const cj = { trackingNumber: '1234567890', courierCode: 'CJ대한통운', dheroMeta: { canceledAt: '2026-10-27 15:00:00' } }
    expect(liveDheroBookings([cj])).toEqual([cj])
    // 같은 번호를 두발히어로 접수가 가진 경우에만 취소로 본다
    const dhero = { trackingNumber: '1234567890', courierCode: '두발히어로', dheroMeta: { canceledAt: '2026-10-27 15:00:00' } }
    expect(liveDheroBookings([cj, dhero])).toEqual([cj])
  })
})
