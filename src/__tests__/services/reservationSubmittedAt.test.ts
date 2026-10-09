/**
 * reservationSubmittedAt.test.ts — 예약 신청 시각 컬럼 submitted_at (Migration 684, 2026-10-09)
 * created_at = 예약 행이 만들어진 시각(장바구니 담기=임시예약 생성). submitted_at = 실제 신청(체크아웃 제출) 시각.
 *  · 바로 hold로 만드는 경로: 기본값(now) → created_at과 거의 같다
 *  · 임시예약(draft)→hold 승격: 승격 시점(now)으로 기록, created_at은 그대로
 *  · 상담 고객 상세·쿠폰 사용 예약 조회·RFM 최근성은 submitted_at 기준
 * Stage DB 라이브 테스트 — fixture는 이 파일이 만들고 정리한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { approveTestCustomer } from '../helpers/approveTestCustomer'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) { const fn = cleanups.pop(); if (fn) await fn().catch(() => undefined) }
}, 60_000)

async function fixture(): Promise<{ userId: string; client: SupabaseClient; productId: string; ids: number[] }> {
  const email = `tdd-sbm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const { data: u, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !u.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const userId = u.user.id
  await approveTestCustomer(admin, userId)
  const client = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  await client.auth.signInWithPassword({ email, password: 'Test1234!' })
  const { data: p } = await admin.from('products').insert({ name: `[TDD-SBM] ${Date.now()}`, category: 'other', is_active: true }).select('id').single()
  const productId = (p as { id: string }).id
  const kids: string[] = []
  for (let i = 0; i < 2; i++) {
    const { data: c } = await admin.from('products').insert({ name: '[TDD-SBM] 자식', category: 'other', is_active: true, parent_product_id: productId }).select('id').single()
    kids.push((c as { id: string }).id)
  }
  await admin.from('price_rules').insert({ product_id: productId, duration_type: '24h', price: 10000, is_active: true })
  const ids: number[] = []
  cleanups.push(async () => {
    await admin.from('order_items').delete().in('reservation_id', ids)
    await admin.from('rental_reservations').delete().in('id', ids)
    await admin.from('price_rules').delete().in('product_id', [productId, ...kids])
    await admin.from('products').delete().eq('parent_product_id', productId)
    await admin.from('products').delete().eq('id', productId)
    await admin.auth.admin.deleteUser(userId)
  })
  return { userId, client, productId, ids }
}

let seq = 0
function dates(): { start: string; end: string } {
  seq += 3
  const d = new Date(Date.UTC(2045, 0, 1 + seq + Math.floor(Math.random() * 300) * 3))
  return { start: d.toISOString().slice(0, 10), end: new Date(d.getTime() + 86400000).toISOString().slice(0, 10) }
}

async function times(id: number): Promise<{ created_at: string; submitted_at: string; status: string }> {
  const { data } = await admin.from('rental_reservations').select('created_at, submitted_at, status').eq('id', id).single()
  return data as { created_at: string; submitted_at: string; status: string }
}

describe('예약 신청 시각 submitted_at (Migration 684)', () => {
  it('B1: 바로 hold로 만든 예약은 submitted_at이 생성 시각과 같은 수준(기본값 now)', async () => {
    const f = await fixture()
    const dt = dates()
    const { data, error } = await f.client.rpc('create_hold_reservation', { p_product_id: f.productId, p_start_date: dt.start, p_end_date: dt.end })
    if (error) throw new Error(error.message)
    const row = (data as Array<{ success: boolean; reservation_id: number }>)[0]
    f.ids.push(row.reservation_id)
    const t = await times(row.reservation_id)
    expect(Math.abs(new Date(t.submitted_at).getTime() - new Date(t.created_at).getTime())).toBeLessThan(60_000)
  })

  it('B2: 임시예약(draft)을 hold로 승격하면 submitted_at은 승격 시점, created_at은 담은 시각 그대로', async () => {
    const f = await fixture()
    const { data: dr, error: dErr } = await f.client.rpc('create_draft_reservation', { p_product_id: f.productId })
    if (dErr) throw new Error(`draft 생성 실패: ${dErr.message}`)
    const draftId = (Array.isArray(dr) ? (dr[0] as { reservation_id?: number; id?: number }) : (dr as { reservation_id?: number; id?: number }))
    const id = (draftId.reservation_id ?? draftId.id) as number
    f.ids.push(id)
    const old = new Date(Date.now() - 3 * 86400000).toISOString()
    await admin.from('rental_reservations').update({ created_at: old, submitted_at: old }).eq('id', id)
    const dt = dates()
    const { data: pr, error: pErr } = await f.client.rpc('promote_draft_reservation', { p_reservation_id: id, p_start_date: dt.start, p_end_date: dt.end })
    if (pErr) throw new Error(`승격 실패: ${pErr.message}`)
    expect((pr as Array<{ success: boolean; error_message: string | null }>)[0].success).toBe(true)
    const t = await times(id)
    expect(t.status).toBe('hold')
    expect(new Date(t.created_at).getTime()).toBe(new Date(old).getTime())
    expect(Date.now() - new Date(t.submitted_at).getTime()).toBeLessThan(120_000)
  })

  it('B3: 상담 고객 상세의 예약 목록 시각·정렬은 submitted_at 기준', async () => {
    const f = await fixture()
    const d1 = dates(); const d2 = dates()
    const mk = async (dt: { start: string; end: string }): Promise<number> => {
      const { data } = await f.client.rpc('create_hold_reservation', { p_product_id: f.productId, p_start_date: dt.start, p_end_date: dt.end })
      const id = (data as Array<{ reservation_id: number }>)[0].reservation_id
      f.ids.push(id)
      return id
    }
    const a = await mk(d1); const b = await mk(d2)
    // a: 담은 시각은 최근, 신청(submitted)은 오래됨 / b: 반대 — 정렬이 submitted_at 기준이면 b가 먼저
    await admin.from('rental_reservations').update({ created_at: new Date().toISOString(), submitted_at: new Date(Date.now() - 5 * 86400000).toISOString() }).eq('id', a)
    await admin.from('rental_reservations').update({ created_at: new Date(Date.now() - 6 * 86400000).toISOString(), submitted_at: new Date(Date.now() - 1 * 86400000).toISOString() }).eq('id', b)
    const { data, error } = await admin.rpc('get_chat_customer_detail', { p_user_id: f.userId })
    if (error) throw new Error(error.message)
    const detail = data as { reservations?: Array<{ id: number; created_at: string }> }
    const rs = detail.reservations ?? []
    const ia = rs.findIndex(r => r.id === a); const ib = rs.findIndex(r => r.id === b)
    expect(ia).toBeGreaterThan(-1); expect(ib).toBeGreaterThan(-1)
    expect(ib).toBeLessThan(ia)
  })

  it('B4: 마이그레이션 SQL이 승격·목록·상담상세·RFM·쿠폰사용조회를 모두 submitted_at으로 전환한다', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/migrations/20261009020000_684_reservation_submitted_at.sql', 'utf-8')
    for (const marker of ['ADD COLUMN IF NOT EXISTS submitted_at', 'promote_draft_reservation', 'get_rental_list', 'get_chat_customer_detail', 'compute_rfm_scores', 'get_coupon_redemptions']) {
      expect(sql, marker).toContain(marker)
    }
  })

  it('B5: 고객 마이페이지·대여·취소 목록 로더는 신청일을 submitted_at으로 읽는다(필드명 created_at 별칭 유지)', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/routes/account/+page.server.ts', 'src/routes/account/rental/+page.server.ts', 'src/routes/account/cancel/+page.server.ts']) {
      const src = readFileSync(f, 'utf-8')
      expect(src, f).toContain('created_at:submitted_at')
      // 예약 조회(rental_reservations)에는 장바구니 시각 기준 정렬이 남아 있지 않다
      const blocks = src.split(".from('rental_reservations')").slice(1)
      for (const b of blocks) {
        const upto = b.slice(0, b.indexOf('.limit('))
        expect(upto, f).not.toContain(".order('created_at'")
      }
    }
  })
})
