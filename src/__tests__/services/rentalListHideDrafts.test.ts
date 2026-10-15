import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 관리자 목록에서 미제출 임시예약 숨김(Migration #712) — Stage 라이브.
 * 정상: 취소됐고 날짜 없고 주문 연결 없는 행(장바구니 잔재)은 예약 단위·주문 단위 목록 모두에서 빠진다.
 * 막아야할것: 실제 신청 이력이 있는 취소 건(날짜 또는 주문 있음)은 그대로 남고, 단건 id 조회는 막지 않는다.
 */
const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Row = { reservation_id: number; status: string; rental_start: string | null; order_id: number | null }

async function list(group: boolean, id: number | null = null): Promise<Row[]> {
  const { data, error } = await admin.rpc('get_rental_list', {
    p_include_statuses: ['cancelled'], p_page: 1, p_per_page: 500, p_group_by_order: group, p_reservation_id: id,
  })
  expect(error).toBeNull()
  return (data ?? []) as Row[]
}

describe.skipIf(!isStage)('get_rental_list — 미제출 임시예약 제외 (#712)', () => {
  for (const group of [false, true]) {
    it(`${group ? '주문' : '예약'} 단위: 날짜·주문 없는 취소 행이 없다`, async () => {
      const rows = await list(group)
      expect(rows.filter(r => r.rental_start === null && r.order_id === null)).toHaveLength(0)
    })
  }
  it('날짜 없는 취소 임시예약도 단건 id로는 조회된다', async () => {
    const { data } = await admin.from('rental_reservations').select('id, order_items:order_items(reservation_id)').eq('status', 'cancelled').is('start_date', null).limit(50)
    const ghost = (data ?? []).find((r: { order_items: unknown[] }) => (r.order_items ?? []).length === 0)
    if (!ghost) return
    const one = await list(false, ghost.id as number)
    expect(one.map(r => r.reservation_id)).toContain(ghost.id)
  })
})
