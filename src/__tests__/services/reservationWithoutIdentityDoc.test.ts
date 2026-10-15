/**
 * 본인증명 미등록 고객의 예약 허용 (2026-10-15, Stephen 확정) — Stage 라이브 통합 테스트
 *
 * 정책: 본인증명·외국인증명 등록/승인은 더 이상 예약 "신청" 단계를 막지 않는다.
 *   고객은 서류 없이도 장바구니 담기(draft)·예약신청(hold)·draft→hold 승격이 가능하고,
 *   서류 확인은 채팅+SMS 등록 요청과 관리자 승인 단계에서 이뤄진다(CMS 승인 게이트는 별도 세션).
 * 배경: Migration #629~#632가 rental_reservations 트리거로 서류 승인 전 예약 생성·승격을 서버에서 막고 있었다.
 *   이 테스트는 그 차단이 풀렸음을 고정한다(재도입 방지).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Stage DB 활성 자식이 여러 개인 부모 상품(cartReservationGrouping.test.ts와 동일 픽스처)
const FIXTURE_PARENT_ID = '955238da-5440-47b1-906d-4865232f3a6c'

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

/** 서류를 전혀 등록하지 않은 임시 고객(승인 헬퍼 호출 없음) + 로그인 세션 */
async function createUnverifiedCustomer(): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `tdd-no-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = 'Test1234!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw new Error(`임시 고객 생성 실패: ${error?.message}`)
  const userId = data.user.id

  const asUser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`임시 고객 로그인 실패: ${signInErr.message}`)

  cleanups.push(async () => {
    await admin.auth.admin.deleteUser(userId)
  })
  return { client: asUser, userId }
}

function randomFutureRange(): { start: string; end: string } {
  const dayOffset = Math.floor(Math.random() * 3000) + 400
  const start = new Date(Date.UTC(2028, 0, 1) + dayOffset * 86400000)
  const end = new Date(start.getTime() + 2 * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

type RpcRow = { success: boolean; reservation_id: number | null; error_message: string | null }

describe('서류 미등록 고객의 예약 신청 허용', () => {
  it('프로필 서류가 비어 있는 상태를 전제로 한다', async () => {
    const { userId } = await createUnverifiedCustomer()
    const { data } = await admin
      .from('user_profiles')
      .select('identity_doc_url, identity_approved_at, foreign_doc_urls, foreign_approved_at')
      .eq('user_id', userId)
      .maybeSingle()
    const row = data as Record<string, unknown> | null
    expect(row?.identity_approved_at ?? null).toBeNull()
    expect(row?.foreign_approved_at ?? null).toBeNull()
  })

  it('장바구니 담기(draft 임시예약)가 서류 없이 성공한다', async () => {
    const { client } = await createUnverifiedCustomer()
    const { data, error } = await client.rpc('create_draft_reservation', { p_product_id: FIXTURE_PARENT_ID })
    expect(error).toBeNull()
    const row = (data as RpcRow[] | null)?.[0]
    expect(row?.error_message ?? '').not.toMatch(/DOC_NOT_APPROVED/)
    expect(row?.success).toBe(true)
    if (row?.reservation_id) {
      cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', row.reservation_id) })
    }
  })

  it('예약신청(hold)이 서류 없이 성공한다', async () => {
    const { client } = await createUnverifiedCustomer()
    const { start, end } = randomFutureRange()
    const { data, error } = await client.rpc('create_hold_reservation', {
      p_product_id: FIXTURE_PARENT_ID,
      p_start_date: start,
      p_end_date: end,
    })
    expect(error).toBeNull()
    const row = (data as RpcRow[] | null)?.[0]
    expect(row?.error_message ?? '').not.toMatch(/DOC_NOT_APPROVED/)
    expect(row?.success).toBe(true)
    if (row?.reservation_id) {
      cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', row.reservation_id) })
    }
  })

  it('장바구니의 draft → hold 승격(예약신청완료)이 서류 없이 성공한다', async () => {
    const { client } = await createUnverifiedCustomer()
    const { data: d1 } = await client.rpc('create_draft_reservation', { p_product_id: FIXTURE_PARENT_ID })
    const draft = (d1 as RpcRow[] | null)?.[0]
    expect(draft?.success).toBe(true)
    const rid = draft!.reservation_id as number
    cleanups.push(async () => { await admin.from('rental_reservations').delete().eq('id', rid) })

    const { start, end } = randomFutureRange()
    const { data: d2, error } = await client.rpc('promote_draft_reservation', {
      p_reservation_id: rid,
      p_start_date: start,
      p_end_date: end,
      p_pickup_method: 'visit',
      p_return_method: 'visit',
    })
    expect(error).toBeNull()
    const promoted = (d2 as RpcRow[] | null)?.[0]
    expect(promoted?.error_message ?? '').not.toMatch(/DOC_NOT_APPROVED/)
    expect(promoted?.success).toBe(true)
    const { data: st } = await admin.from('rental_reservations').select('status').eq('id', rid).single()
    expect((st as { status: string }).status).toBe('hold')
  })
})
