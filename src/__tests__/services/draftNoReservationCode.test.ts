import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * 임시예약(draft)에는 예약코드를 발행하지 않는다(Migration #713) — Stage 라이브.
 * 정상: draft로 만든 행·취소된 draft는 코드가 없다. 막아야할것: 장바구니 담기·취소 반복으로 코드 번호가 소모되는 것.
 * (draft→hold 승격 때 코드가 발행되는 것은 DB 트랜잭션으로 별도 확인 — 승격은 날짜 겹침 제약 때문에 이 테스트에서 만들지 않는다.)
 */
const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const created: number[] = []

afterAll(async () => { if (created.length) await admin.from('rental_reservations').delete().in('id', created) })

describe.skipIf(!isStage)('draft 예약코드 미발행 (#713)', () => {
  it('draft 생성·취소 모두 코드 없음', async () => {
    const { data: base } = await admin.from('rental_reservations').select('user_id, product_id').eq('status', 'confirmed').limit(1).maybeSingle()
    if (!base) return
    const { data: a, error } = await admin.from('rental_reservations').insert({ user_id: base.user_id, product_id: base.product_id, status: 'draft' }).select('id, reservation_code').single()
    expect(error).toBeNull()
    created.push(a!.id)
    expect(a!.reservation_code).toBeNull()
    await admin.from('rental_reservations').update({ status: 'cancelled' }).eq('id', a!.id)
    const { data: after } = await admin.from('rental_reservations').select('reservation_code').eq('id', a!.id).single()
    expect(after!.reservation_code).toBeNull()
  })
})
