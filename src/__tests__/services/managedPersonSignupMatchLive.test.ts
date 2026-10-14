import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 신규 가입자 ↔ 사전 등록 관리대상 대조 — Stage DB 라이브 테스트 (Migration #708)
 *
 * 완료기준:
 *   정상동작: 가입 정보(전화번호 숫자 일치·이메일 대소문자 무시 일치)가 사전 등록 관리대상과 같으면 일치 기록이 pending으로 생기고
 *             고객목록 '관리대상' 필터에 나오며(정상 필터에서는 제외), '해당 없음' 처리 후에는 빠지고 다시 생기지 않는다.
 *   막아야할것: 무관한 가입자에는 일치 기록이 없고, 고객·비로그인은 일치 기록·관련 함수에 접근할 수 없다.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
const tag = String(Date.now()).slice(-8)
const phoneDigits = `010${tag}`
const matchEmail = `Match.${tag}@Example.com`

const userIds: string[] = []
const personIds: string[] = []

async function newUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: `Pw!${tag}abc`, email_confirm: true })
  expect(error).toBeNull()
  userIds.push(data.user!.id)
  return data.user!.id
}
async function matchRow(uid: string) {
  const { data } = await admin.from('managed_person_matches').select('status, basis').eq('user_id', uid).maybeSingle()
  return data as { status: string; basis: string } | null
}
async function inList(uid: string, blacklisted: boolean) {
  const { data } = await admin.rpc('get_customer_list', { p_page: 1, p_limit: 500, p_blacklisted: blacklisted })
  return ((data ?? []) as Array<{ user_id: string }>).some((r) => r.user_id === uid)
}

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
  if (personIds.length > 0) await admin.from('managed_persons').delete().in('id', personIds)
})

describe('가입자 ↔ 관리대상 대조 (#708)', () => {
  it('사전 등록(전화·이메일) 준비', async () => {
    for (const [name, phone, email] of [
      ['테스트관리A', `010-${tag.slice(0, 4)}-${tag.slice(4)}`, null],
      ['테스트관리B', `011-${tag.slice(0, 4)}-${tag.slice(4)}`, matchEmail],
    ] as const) {
      const { data, error } = await admin.rpc('cms_register_managed_person', {
        p_name: name, p_phone: phone, p_email: email, p_birth_date: null, p_reason: '테스트 사유', p_created_by: null,
      })
      expect(error).toBeNull()
      const r = data as { ok: boolean; id?: string }
      expect(r.ok).toBe(true)
      personIds.push(r.id!)
    }
  })

  let phoneUser = ''
  it('전화번호 인증으로 번호가 채워지는 순간 일치(phone) 기록 + 관리대상 필터 포함', async () => {
    phoneUser = await newUser(`plain_${tag}@example.com`)
    expect(await matchRow(phoneUser)).toBeNull()
    await admin.from('user_profiles').update({ phone: phoneDigits }).eq('id', phoneUser)
    expect(await matchRow(phoneUser)).toMatchObject({ status: 'pending', basis: 'phone' })
    expect(await inList(phoneUser, true)).toBe(true)
    expect(await inList(phoneUser, false)).toBe(false)
  })

  it('이메일(대소문자 무시) 일치는 가입 즉시 기록된다', async () => {
    const uid = await newUser(matchEmail.toLowerCase())
    expect(await matchRow(uid)).toMatchObject({ status: 'pending', basis: 'email' })
  })

  it('해당 없음 처리 후 필터에서 빠지고, 번호를 다시 저장해도 되살아나지 않는다', async () => {
    const { data } = await admin.rpc('cms_review_managed_match', { p_user_id: phoneUser, p_decision: 'dismissed', p_reviewer: null })
    expect((data as { ok: boolean }).ok).toBe(true)
    expect(await inList(phoneUser, true)).toBe(false)
    await admin.from('user_profiles').update({ phone: '01000000000' }).eq('id', phoneUser)
    await admin.from('user_profiles').update({ phone: phoneDigits }).eq('id', phoneUser)
    expect((await matchRow(phoneUser))?.status).toBe('dismissed')
    const again = await admin.rpc('cms_review_managed_match', { p_user_id: phoneUser, p_decision: 'confirmed', p_reviewer: null })
    expect((again.data as { error?: string }).error).toBe('not_pending')
  })

  it('무관한 가입자에는 일치 기록이 없다', async () => {
    const uid = await newUser(`nobody_${tag}@example.com`)
    await admin.from('user_profiles').update({ phone: '01012345678' }).eq('id', uid)
    expect(await matchRow(uid)).toBeNull()
  })

  it('고객·비로그인은 일치 기록 테이블과 관련 함수에 접근할 수 없다', async () => {
    const t = await anon.from('managed_person_matches').select('user_id').limit(1)
    expect((t.data ?? []).length).toBe(0)
    for (const [fn, args] of [
      ['cms_managed_match_pending_count', {}],
      ['cms_get_managed_match_flags', { p_user_ids: [] }],
      ['cms_review_managed_match', { p_user_id: '00000000-0000-0000-0000-000000000000', p_decision: 'dismissed', p_reviewer: null }],
    ] as const) {
      const r = await anon.rpc(fn, args as Record<string, unknown>)
      expect(r.error, fn).toBeTruthy()
    }
  })

  it('가입 이후에 관리대상을 등록해도 재스캔이 감지하고, 다시 돌려도 중복 기록하지 않는다 (#709)', async () => {
    const uid = await newUser(`late_${tag}@example.com`)
    const latePhone = `010${String(Number(tag) + 1).padStart(8, '0')}`
    await admin.from('user_profiles').update({ phone: latePhone }).eq('id', uid)
    expect(await matchRow(uid)).toBeNull()
    const { data: reg } = await admin.rpc('cms_register_managed_person', {
      p_name: '테스트관리C', p_phone: latePhone, p_email: null, p_birth_date: null, p_reason: '테스트 사유', p_created_by: null,
    })
    personIds.push((reg as { id: string }).id)
    const first = await admin.rpc('cms_rescan_managed_matches')
    expect(first.error).toBeNull()
    expect(first.data as number).toBeGreaterThanOrEqual(1)
    expect(await matchRow(uid)).toMatchObject({ status: 'pending', basis: 'phone' })
    const second = await admin.rpc('cms_rescan_managed_matches')
    expect(second.data).toBe(0)
  })

  it('재스캔 함수는 고객·비로그인이 실행할 수 없다 (#709)', async () => {
    const r = await anon.rpc('cms_rescan_managed_matches')
    expect(r.error).toBeTruthy()
  })
})
