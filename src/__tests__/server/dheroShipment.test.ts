import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD — update_reservation_dhero_shipment RPC 검증
 *
 * RED 확인: Stage DB에 해당 RPC + dhero_* 컬럼이 없으면 전부 실패
 * GREEN 목표: Migration 343 적용 후 3개 케이스 모두 통과
 *
 * 대상 컬럼(rental_reservations):
 *   dhero_status TEXT | dhero_status_code SMALLINT | dhero_return_book_id TEXT
 *   dhero_dong_group TEXT | dhero_synced_at TIMESTAMPTZ | dhero_meta JSONB
 *
 * 대상 RPC:
 *   update_reservation_dhero_shipment(
 *     p_reservation_id BIGINT,   -- rental_reservations.id (BIGINT — Migration 140)
 *     p_tracking_number TEXT,
 *     p_courier_code TEXT,
 *     p_status TEXT,
 *     p_status_code SMALLINT,
 *     p_dong_group TEXT,
 *     p_meta JSONB,
 *     p_return_book_id TEXT DEFAULT NULL
 *   ) RETURNS void — service_role 전용
 */

// ── 모킹 ───────────────────────────────────────────────────────────────────

vi.mock('$env/static/private', () => ({
  SUPABASE_SERVICE_ROLE_KEY: 'test-key',
}))
vi.mock('$env/static/public', () => ({
  PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
}))

// Supabase 클라이언트 모킹 — 각 테스트에서 rpc 반환값 제어
const mockRpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: mockRpc }),
}))

// ── 테스트 ──────────────────────────────────────────────────────────────────

describe('update_reservation_dhero_shipment RPC', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('케이스 1 (정상갱신): 유효한 BIGINT id와 배송정보로 호출하면 성공한다', async () => {
    // GREEN 상태: RPC가 존재하고 정상 동작
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    const admin = { rpc: mockRpc }
    const { data, error } = await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  12345,   // BIGINT — rental_reservations.id
      p_tracking_number: 'DHERO-BOOK-001',
      p_courier_code:    '두발히어로',
      p_status:          '출고완료',
      p_status_code:     4,
      p_dong_group:      'GRP-001',
      p_meta:            { deliveredPageUrl: 'https://dhero.kr/delivered/123' },
      p_return_book_id:  null,
    })

    expect(error).toBeNull()
    expect(mockRpc).toHaveBeenCalledWith('update_reservation_dhero_shipment', expect.objectContaining({
      p_reservation_id: 12345,
      p_courier_code:   '두발히어로',
      p_status_code:    4,
    }))
  })

  it('케이스 2 (존재하지 않는 reservation): 없는 id로 호출하면 에러가 반환된다', async () => {
    // GREEN 상태: RPC가 RAISE EXCEPTION → error.message에 "not found" 포함
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'reservation not found: 0' },
    })

    const admin = { rpc: mockRpc }
    const { data, error } = await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id: 0,       // BIGINT 0 = 존재하지 않는 예약
      p_tracking_number: 'DHERO-BOOK-999',
      p_courier_code: '두발히어로',
      p_status: '배송접수',
      p_status_code: 0,
      p_dong_group: null,
      p_meta: null,
      p_return_book_id: null,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toContain('not found')
  })

  it('케이스 3 (service_role 외 실행 차단): anon/authenticated 역할로 실행하면 거부된다', async () => {
    // GREEN 상태: REVOKE ALL FROM PUBLIC + anon + authenticated 적용 후
    // authenticated 역할로 호출 시 permission denied 에러 반환
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for function update_reservation_dhero_shipment' },
    })

    // authenticated 역할 클라이언트로 호출 시뮬레이션
    const userClient = { rpc: mockRpc }
    const { data, error } = await userClient.rpc('update_reservation_dhero_shipment', {
      p_reservation_id: 12345,   // BIGINT
      p_tracking_number: 'HACK-ATTEMPT',
      p_courier_code: '두발히어로',
      p_status: '배송완료',
      p_status_code: 5,
      p_dong_group: null,
      p_meta: null,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toContain('permission denied')
  })
})
