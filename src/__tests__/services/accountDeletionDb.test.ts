import { describe, it, expect, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 회원 삭제·탈퇴 통합 TDD 통합테스트 — Migration #763 (2026-10-24)
 *  · 공통 차단 조건 / CMS 삭제 30일 유예 / 본인 탈퇴 자동 복구·관리자 삭제는 복구 안 됨
 *  · 익명 전환(개인정보 제거·로그인 차단·거래 기록 보존) / 관리대상 유지·이관 / 이메일 재가입 제한(3개월)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트.
 */
if (!PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')) throw new Error('이 테스트는 Stage DB 전용입니다')

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const PASSWORD = 'Test1234!'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const rnd = () => Math.random().toString(36).slice(2, 8)
const randomPhone = () => `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

async function createUser(opts: { blacklisted?: boolean } = {}) {
  const email = `tdd-del-${Date.now()}-${rnd()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`user 생성 실패: ${error?.message}`)
  const id = data.user.id
  const phone = randomPhone()
  const { error: upErr } = await admin.from('user_profiles').update({
    full_name: '삭제테스트', phone, birth_date: '1990-01-01', address: '서울시 테스트구',
    ...(opts.blacklisted ? { blacklisted: true, blacklist_reason: '테스트 관리대상' } : {}),
  }).eq('id', id)
  if (upErr) throw new Error(`프로필 설정 실패: ${upErr.message}`)
  cleanups.push(async () => {
    await admin.from('managed_persons').delete().eq('phone_digits', phone)
    await admin.from('signup_restrictions').delete().eq('source_user_id', id)
    await admin.from('account_storage_cleanup').delete().eq('user_id', id)
    await admin.from('account_deletion_events').delete().eq('user_id', id)
    await admin.from('rental_reservations').delete().eq('user_id', id)   // Stage는 예약 연결이 삭제를 막는다(NO ACTION)
    await admin.auth.admin.deleteUser(id)
  })
  return { id, email, phone }
}

async function productId(): Promise<string> {
  const { data } = await admin.from('products').select('id').not('parent_product_id', 'is', null).eq('is_active', true).limit(1).single()
  return (data as { id: string }).id
}

let dayOffset = Math.floor(Math.random() * 3000)
async function addReservation(userId: string, status: string) {
  // 같은 상품의 날짜 겹침 제약을 피하려고 예약마다 다른 먼 미래 날짜를 쓴다
  dayOffset += 3
  const start = new Date(Date.UTC(2040, 0, 1) + dayOffset * 86400000)
  const end = new Date(start.getTime() + 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  // eslint-disable-next-line no-restricted-syntax -- 테스트 픽스처: 상태별 예약 행이 필요하고 예약 배정 RPC는 이 검증과 무관
  const { error } = await admin.from('rental_reservations').insert({ user_id: userId, product_id: await productId(), status, start_date: fmt(start), end_date: fmt(end) })
  if (error) throw new Error(`예약 생성 실패: ${error.message}`)
}

async function profile(id: string) {
  const { data } = await admin.from('user_profiles').select('*').eq('id', id).single()
  return data as Record<string, unknown>
}

async function userClient(email: string) {
  const c = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`로그인 실패: ${error.message}`)
  return c
}

type R = { ok: boolean; error_code?: string; blockers?: string[]; restored?: boolean; admin_blocked?: boolean }
const rpc = async (name: string, args: Record<string, unknown>): Promise<R> => {
  const { data, error } = await (admin.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: R | null; error: { message: string } | null }>)(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as R
}

async function forcePurgeDue(id: string) {
  await admin.from('user_profiles').update({ withdrawal_purge_at: new Date(Date.now() - 1000).toISOString() }).eq('id', id)
  const { error } = await admin.rpc('purge_withdrawn_accounts')
  if (error) throw new Error(`purge: ${error.message}`)
}

describe('삭제 차단 조건(공통)', () => {
  it('S1: 진행 중 대여가 있으면 CMS 삭제 요청이 거절된다(active_rental)', async () => {
    const u = await createUser()
    await addReservation(u.id, 'in_use')
    const r = await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id, p_reason: null })
    expect(r.ok).toBe(false)
    expect(r.error_code).toBe('not_deletable')
    expect(r.blockers).toContain('active_rental')
    expect((await profile(u.id)).withdrawal_status).toBe('none')
  })

  it('S2: 반납 후 검수 대기(returned)도 막는다(return_inspection)', async () => {
    const u = await createUser()
    await addReservation(u.id, 'returned')
    const r = await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    expect(r.blockers).toContain('return_inspection')
  })

  it('S3: 본인 탈퇴도 같은 차단 조건을 쓴다(진행 중 대여 → active_rental_exists)', async () => {
    const u = await createUser()
    await addReservation(u.id, 'confirmed')
    const c = await userClient(u.email)
    const { data } = await c.rpc('request_account_withdrawal', { p_reasons: ['no_longer_use'] })
    expect((data as R).error_code).toBe('active_rental_exists')
  })
})

describe('30일 유예·복구', () => {
  it('S4: CMS 삭제 요청은 유예(requested, initiator=admin)로 들어가고 관리대상 지정은 풀리지 않는다', async () => {
    const u = await createUser({ blacklisted: true })
    const r = await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id, p_reason: '테스트 삭제' })
    expect(r.ok).toBe(true)
    const p = await profile(u.id)
    expect(p.withdrawal_status).toBe('requested')
    expect(p.withdrawal_initiator).toBe('admin')
    expect(p.blacklisted).toBe(true)
    expect(p.deleted_at).toBeNull()
    expect(new Date(p.withdrawal_purge_at as string).getTime()).toBeGreaterThan(Date.now() + 29 * 86400000)
  })

  it('S5: 본인 탈퇴 유예 중 본인 로그인(복구 RPC)은 자동 복구된다', async () => {
    const u = await createUser()
    const c = await userClient(u.email)
    const { data: req } = await c.rpc('request_account_withdrawal', { p_reasons: ['no_longer_use'] })
    expect((req as R).ok).toBe(true)
    expect((await profile(u.id)).withdrawal_initiator).toBe('user')
    const { data: restored } = await c.rpc('restore_withdrawn_account')
    expect((restored as R).restored).toBe(true)
    expect((await profile(u.id)).withdrawal_status).toBe('none')
  })

  it('S6: 관리자 삭제 계정은 고객 로그인으로 복구되지 않고, 관리자 복구는 가능하다', async () => {
    const u = await createUser()
    const c = await userClient(u.email) // 삭제 요청 전에 이미 열려 있던 로그인(access 토큰은 만료 전까지 유효)
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    const { data } = await c.rpc('restore_withdrawn_account')
    expect((data as R).restored).toBe(false)
    expect((data as R).admin_blocked).toBe(true)
    expect((await profile(u.id)).withdrawal_status).toBe('requested')
    const back = await rpc('cms_restore_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    expect(back.ok).toBe(true)
    expect((await profile(u.id)).withdrawal_status).toBe('none')
  })
})

describe('익명 전환·재가입 제한', () => {
  it('S7: 유예 종료 후 익명 전환 — 개인정보 제거·로그인 차단·거래 기록 보존', async () => {
    const u = await createUser()
    await addReservation(u.id, 'completed')
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)

    const p = await profile(u.id)
    expect(p.withdrawal_status).toBe('purged')
    expect(p.full_name).toBeNull()
    expect(p.phone).toBeNull()
    expect(p.birth_date).toBeNull()
    expect(p.address).toBeNull()
    expect(p.email).toBe(`purged-${u.id}@purged.crazyshot.kr`)

    const { data: au, error: auErr } = await admin.auth.admin.getUserById(u.id)
    expect(auErr?.message).toBeUndefined()
    expect(au.user?.email).toBe(`purged-${u.id}@purged.crazyshot.kr`)
    expect(au.user?.identities?.length ?? 0).toBe(0)
    const login = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: u.email, password: PASSWORD })
    expect(login.error).not.toBeNull()

    const { count } = await admin.from('rental_reservations').select('id', { count: 'exact', head: true }).eq('user_id', u.id)
    expect(count).toBe(1)
    const { data: cleanup } = await admin.from('account_storage_cleanup').select('bucket').eq('user_id', u.id)
    expect((cleanup ?? []).map((r) => (r as { bucket: string }).bucket).sort()).toEqual(['user-avatars', 'user-documents'])
  })

  it('S8: 관리대상 계정은 익명 전환 후에도 관리대상 유지 + 사전 등록 관리대상으로 이관된다', async () => {
    const u = await createUser({ blacklisted: true })
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)
    const p = await profile(u.id)
    expect(p.blacklisted).toBe(true)
    expect(p.blacklist_reason).toBe('테스트 관리대상')
    const { data: mp } = await admin.from('managed_persons').select('name, phone_digits, reason').eq('phone_digits', u.phone).is('deleted_at', null)
    expect(mp).toHaveLength(1)
    expect((mp as Array<{ name: string }>)[0].name).toBe('삭제테스트')
  })

  it('S9: 익명 전환 후 3개월 동안 같은 이메일 재가입이 막히고(화면 확인·DB 거절), 제한이 끝나면 가입된다', async () => {
    const u = await createUser()
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)

    const { data: chk } = await admin.rpc('check_signup_restricted', { p_email: u.email.toUpperCase() })
    expect((chk as { restricted: boolean }).restricted).toBe(true)

    const blocked = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true })
    expect(blocked.error).not.toBeNull()

    const { data: row } = await admin.from('signup_restrictions').select('restricted_until, email_hash').eq('source_user_id', u.id).single()
    const until = new Date((row as { restricted_until: string }).restricted_until).getTime()
    expect(until).toBeGreaterThan(Date.now() + 85 * 86400000)
    expect((row as { email_hash: string }).email_hash).not.toContain('@')

    await admin.from('signup_restrictions').update({ restricted_until: new Date(Date.now() - 1000).toISOString() }).eq('source_user_id', u.id)
    const again = await admin.auth.admin.createUser({ email: u.email, password: PASSWORD, email_confirm: true })
    expect(again.error).toBeNull()
    if (again.data.user) cleanups.push(async () => { await admin.auth.admin.deleteUser(again.data.user!.id) })
  })

  it('S10: 같은 크론을 두 번 실행해도 결과가 같다(멱등)', async () => {
    const u = await createUser()
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)
    const first = await profile(u.id)
    await admin.rpc('purge_withdrawn_accounts')
    const second = await profile(u.id)
    expect(second.withdrawal_purged_at).toBe(first.withdrawal_purged_at)
    const { count } = await admin.from('account_deletion_events').select('id', { count: 'exact', head: true }).eq('user_id', u.id).eq('event', 'anonymized')
    expect(count).toBe(1)
  })
})

describe('법정 보존 만료 도래 리포트(Migration #764) — 자동 삭제 없음', () => {
  it('S11: 최근 거래는 keep, 5년이 지난 거래는 due로 계산되고 알림 대상에 올라온다 — 기록은 지우지 않는다', async () => {
    const u = await createUser()
    await addReservation(u.id, 'completed')
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)

    const rows = async () => {
      const { data, error } = await admin.rpc('cms_retention_report', { p_user_id: u.id })
      if (error) throw new Error(error.message)
      return data as Array<{ txn_state: string; reservation_count: number }>
    }
    expect((await rows())[0].txn_state).toBe('keep')

    const old = new Date(Date.now() - 5 * 365.25 * 86400000 - 86400000).toISOString()
    await admin.from('rental_reservations').update({ created_at: old }).eq('user_id', u.id)
    expect((await rows())[0].txn_state).toBe('due')

    const { data: due } = await admin.rpc('cms_retention_new_due')
    expect((due as Array<{ user_id: string; kind: string }>).some((d) => d.user_id === u.id && d.kind === 'transaction')).toBe(true)
    await admin.from('retention_expiry_alerts').insert({ user_id: u.id, kind: 'transaction' })
    const { data: due2 } = await admin.rpc('cms_retention_new_due')
    expect((due2 as Array<{ user_id: string; kind: string }>).some((d) => d.user_id === u.id)).toBe(false)

    // 자동 삭제 없음 — 만료가 도래해도 예약 기록은 그대로
    const { count } = await admin.from('rental_reservations').select('id', { count: 'exact', head: true }).eq('user_id', u.id)
    expect(count).toBe(1)
    cleanups.push(async () => { await admin.from('retention_expiry_alerts').delete().eq('user_id', u.id) })
  })

  it('S12: 익명 전환 전(정상) 계정은 리포트에 나오지 않는다', async () => {
    const u = await createUser()
    await addReservation(u.id, 'completed')
    const { data } = await admin.rpc('cms_retention_report', { p_user_id: u.id })
    expect(data).toHaveLength(0)
  })
})

describe('작성 콘텐츠 — 내용은 남기고 작성자만 익명(작성자가 직접 삭제하지 않은 경우)', () => {
  it('S13: 익명 전환 후 댓글 내용은 유지되고 작성자 표기는 익명으로 바뀐다', async () => {
    const { data: post } = await admin.from('user_posts').select('id').limit(1).maybeSingle()
    if (!post) return // 이 Stage에 게시글이 없으면 건너뜀
    const u = await createUser()
    const { data: c, error } = await admin.from('post_comments').insert({
      post_id: (post as { id: string }).id, user_id: u.id, author_name: '삭제테스트', content: '남겨진 댓글',
    }).select('id').single()
    expect(error).toBeNull()
    cleanups.push(async () => { await admin.from('post_comments').delete().eq('id', (c as { id: string }).id) })

    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)

    const { data: after } = await admin.from('post_comments').select('author_name, content').eq('id', (c as { id: string }).id).single()
    expect((after as { author_name: string }).author_name).toBe('익명')
    expect((after as { content: string }).content).toBe('남겨진 댓글')
  })
})


describe('재작업(sp3 1차) — 쿠폰·로그인 차단·실패 기록', () => {
  it('S14: 결제에 쓴 쿠폰이 있어도 익명 전환이 성공하고, 쓴 쿠폰은 거래 기록으로 남고 안 쓴 쿠폰은 삭제된다', async () => {
    const u = await createUser()
    const mkCoupon = async () => {
      const { data, error } = await admin.from('coupons').insert({ type: 'all', discount_type: 'fixed', discount_value: 1000, code: `TDDDEL${rnd()}` } as never).select('id').single()
      if (error) throw new Error(`쿠폰 생성 실패: ${error.message}`)
      return (data as { id: string }).id
    }
    const usedCoupon = await mkCoupon()
    const freeCoupon = await mkCoupon()
    const { data: ucUsed } = await admin.from('user_coupons').insert({ user_id: u.id, coupon_id: usedCoupon }).select('id').single()
    const { data: ucFree } = await admin.from('user_coupons').insert({ user_id: u.id, coupon_id: freeCoupon }).select('id').single()
    const ucUsedId = (ucUsed as { id: string }).id
    const ucFreeId = (ucFree as { id: string }).id
    const { data: order, error: oErr } = await admin.from('orders').insert({ user_id: u.id, order_key: `tdd-del-${rnd()}`, total_amount: 10000, final_amount: 9000 }).select('id').single()
    if (oErr) throw new Error(`주문 생성 실패: ${oErr.message}`)
    const orderId = (order as { id: number }).id
    const { error: ocErr } = await admin.from('order_coupons').insert({ order_id: orderId, coupon_id: usedCoupon, user_coupon_id: ucUsedId })
    if (ocErr) throw new Error(`주문쿠폰 생성 실패: ${ocErr.message}`)
    cleanups.push(async () => {
      await admin.from('order_coupons').delete().eq('order_id', orderId)
      await admin.from('orders').delete().eq('id', orderId)
      await admin.from('user_coupons').delete().eq('user_id', u.id)
      await admin.from('coupons').delete().in('id', [usedCoupon, freeCoupon])
    })

    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)

    expect((await profile(u.id)).withdrawal_status).toBe('purged')
    const { data: left } = await admin.from('user_coupons').select('id').eq('user_id', u.id)
    expect((left ?? []).map((r) => (r as { id: string }).id)).toEqual([ucUsedId])
    expect((left ?? []).some((r) => (r as { id: string }).id === ucFreeId)).toBe(false)
  })

  it('S15: 관리자 삭제 요청 즉시 로그인 계정이 차단되고 세션이 끊기며, 관리자 복구하면 다시 로그인된다', async () => {
    const u = await createUser()
    const c = await userClient(u.email)
    expect((await c.auth.getSession()).data.session).not.toBeNull()
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })

    const blocked = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: u.email, password: PASSWORD })
    expect(blocked.error).not.toBeNull()
    const { count } = await admin.from('account_deletion_events').select('id', { count: 'exact', head: true }).eq('user_id', u.id).eq('event', 'requested')
    expect(count).toBe(1)

    const restored = await rpc('cms_restore_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    expect(restored.ok).toBe(true)
    const again = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: u.email, password: PASSWORD })
    expect(again.error).toBeNull()
  })

  it('S16: 본인 탈퇴(로그인 차단 없음) 유예 계정은 복구 전에도 로그인할 수 있다 — 차단은 관리자 삭제에만', async () => {
    const u = await createUser()
    const c = await userClient(u.email)
    const { error } = await c.rpc('request_account_withdrawal', { p_reasons: ['etc'], p_reason_etc: 'TDD' } as never)
    expect(error).toBeNull()
    const login = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email: u.email, password: PASSWORD })
    expect(login.error).toBeNull()
  })

  it('S17: 유예 중 새로 생긴 거래(진행 중 예약)가 있으면 익명 전환이 막히고 실패 기록이 남으며, 정리되면 다음 실행에서 전환된다', async () => {
    const u = await createUser()
    const c = await userClient(u.email)
    const { error: wdErr } = await c.rpc('request_account_withdrawal', { p_reasons: ['etc'], p_reason_etc: 'TDD' } as never) // 본인 탈퇴 유예(관리자 삭제는 새 거래 자체가 막힌다 — S18)
    expect(wdErr).toBeNull()
    await addReservation(u.id, 'confirmed')
    await forcePurgeDue(u.id)

    expect((await profile(u.id)).withdrawal_status).toBe('requested')
    const { data: ev } = await admin.from('account_deletion_events').select('details').eq('user_id', u.id).eq('event', 'anonymize_failed')
    expect((ev ?? []).length).toBe(1)
    expect(JSON.stringify((ev as { details: unknown }[])[0].details)).toContain('anonymize_blocked')

    await forcePurgeDue(u.id) // 20시간 안 재실패는 중복 기록하지 않는다
    const { count } = await admin.from('account_deletion_events').select('id', { count: 'exact', head: true }).eq('user_id', u.id).eq('event', 'anonymize_failed')
    expect(count).toBe(1)

    await admin.from('rental_reservations').update({ status: 'completed' }).eq('user_id', u.id)
    await forcePurgeDue(u.id)
    expect((await profile(u.id)).withdrawal_status).toBe('purged')
  })

  it('S18: 관리자 삭제 유예 계정은 새 예약이 DB에서 거절되고, 본인 탈퇴 유예·정상 계정은 영향이 없다', async () => {
    const u = await createUser()
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await expect(addReservation(u.id, 'hold')).rejects.toThrow(/ACCOUNT_DELETION_PENDING/)
    const { count } = await admin.from('rental_reservations').select('id', { count: 'exact', head: true }).eq('user_id', u.id)
    expect(count).toBe(0)
    await rpc('cms_restore_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await addReservation(u.id, 'hold') // 복구하면 다시 가능
  })

  it('S19: 재가입 조회 함수는 제한 여부만 돌려주고 가입 가능일은 알려주지 않는다', async () => {
    const u = await createUser()
    await rpc('cms_request_account_deletion', { p_user_id: u.id, p_admin_id: u.id })
    await forcePurgeDue(u.id)
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { data } = await anon.rpc('check_signup_restricted', { p_email: u.email } as never)
    expect(data).toEqual({ restricted: true })
  })
})
