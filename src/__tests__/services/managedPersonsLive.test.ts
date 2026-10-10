import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

/**
 * 관리대상(비회원) 등록 — Stage DB 라이브 통합 테스트 (Migration #686)
 *
 * 완료기준:
 *   정상동작: 이름·전화·사유로 등록하면 회원코드(CSMG…)가 자동 채번되고, get_customer_list가
 *             is_managed_person=true·blacklisted=true 행으로 함께 반환한다(전체·관리대상 칩에 노출,
 *             정상 칩과 분류 칩에서는 제외, 이름·전화(하이픈 무관) 검색 가능).
 *   막아야할것: 필수값 누락·잘못된 전화·중복 전화 거부 / anon·authenticated는 테이블·RPC 접근 불가 /
 *             삭제(소프트)된 인물은 목록에서 사라지고 같은 번호로 재등록 가능.
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)

const createdIds: string[] = []
const suffix = String(Date.now()).slice(-8)
const digits = `010${suffix}`           // 11자리
const hyphen = `010-${suffix.slice(0, 4)}-${suffix.slice(4)}`

async function register(over: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc('cms_register_managed_person', {
    p_name: '테스트관리대상',
    p_phone: hyphen,
    p_email: null,
    p_birth_date: null,
    p_reason: '테스트 사유',
    p_created_by: null,
    ...over,
  })
  expect(error).toBeNull()
  const r = data as { ok: boolean; id?: string; member_code?: string; error?: string; existing_id?: string }
  if (r.ok && r.id) createdIds.push(r.id)
  return r
}

afterAll(async () => {
  if (createdIds.length > 0) await admin.from('managed_persons').delete().in('id', createdIds)
})

describe('관리대상 등록 RPC', () => {
  let personId = ''
  let memberCode = ''

  it('등록 성공 — 회원코드 CSMG 접두 자동 채번, 전화번호 하이픈 표준화', async () => {
    const r = await register({ p_phone: digits })
    expect(r.ok).toBe(true)
    expect(r.member_code).toMatch(/^CSMG\d{4}\d{3,}$/)
    personId = r.id!
    memberCode = r.member_code!
    const { data } = await admin.from('managed_persons').select('phone, phone_digits').eq('id', personId).single()
    expect((data as { phone: string }).phone).toBe(hyphen)
    expect((data as { phone_digits: string }).phone_digits).toBe(digits)
  })

  it('목록에 is_managed_person=true·blacklisted=true 행으로 노출 + 단건 조회(p_user_id)', async () => {
    const { data, error } = await admin.rpc('get_customer_list', { p_user_id: personId })
    expect(error).toBeNull()
    const rows = data as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0].is_managed_person).toBe(true)
    expect(rows[0].blacklisted).toBe(true)
    expect(rows[0].blacklist_reason).toBe('테스트 사유')
    expect(rows[0].member_code).toBe(memberCode)
    expect(rows[0].email).toBe('')
  })

  it('필터 — 관리대상 칩(true)·전체에는 포함, 정상 칩(false)·분류 칩에는 제외', async () => {
    const q = (args: Record<string, unknown>) =>
      admin.rpc('get_customer_list', { p_search: suffix, p_limit: 50, ...args })
    const bl = await q({ p_blacklisted: true })
    expect((bl.data as Array<{ user_id: string }>).some(r => r.user_id === personId)).toBe(true)
    const all = await q({})
    expect((all.data as Array<{ user_id: string }>).some(r => r.user_id === personId)).toBe(true)
    const normal = await q({ p_blacklisted: false })
    expect((normal.data as Array<{ user_id: string }>).some(r => r.user_id === personId)).toBe(false)
    const cls = await q({ p_classifications: ['general'] })
    expect((cls.data as Array<{ user_id: string }>).some(r => r.user_id === personId)).toBe(false)
  })

  it('검색 — 이름·하이픈 없는 전화·하이픈 전화·일부 숫자 모두 매칭', async () => {
    for (const s of ['테스트관리대상', digits, hyphen, suffix.slice(2, 8)]) {
      const { data } = await admin.rpc('get_customer_list', { p_search: s, p_limit: 50 })
      expect((data as Array<{ user_id: string }>).some(r => r.user_id === personId), `검색어 ${s}`).toBe(true)
    }
  })

  it('총건수(total_count)와 페이지네이션이 회원+관리대상 합산 기준', async () => {
    const { data } = await admin.rpc('get_customer_list', { p_page: 1, p_limit: 1 })
    const rows = data as Array<{ total_count: number }>
    expect(rows).toHaveLength(1)
    const { count: members } = await admin.from('user_profiles').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    const { count: managed } = await admin.from('managed_persons').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    expect(Number(rows[0].total_count)).toBe((members ?? 0) + (managed ?? 0))
  })

  it('중복 전화 거부(existing_id 반환)', async () => {
    const r = await register({ p_phone: hyphen })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('duplicate_phone')
    expect(r.existing_id).toBe(personId)
  })

  it('필수값·형식 검증', async () => {
    expect((await register({ p_name: '  ' })).error).toBe('name_required')
    expect((await register({ p_phone: '12' })).error).toBe('phone_invalid')
    expect((await register({ p_phone: '010-9999-0000', p_reason: '' })).error).toBe('reason_required')
    expect((await register({ p_phone: '010-9999-0001', p_email: 'not-email' })).error).toBe('email_invalid')
  })

  it('수정 — 사유·이름 변경 반영, 다른 인물 전화와 충돌 시 거부', async () => {
    const other = await register({ p_phone: `010${String(Number(suffix) + 1).padStart(8, '0')}` })
    expect(other.ok).toBe(true)
    const upd = await admin.rpc('cms_update_managed_person', {
      p_id: personId, p_name: '수정된이름', p_phone: hyphen, p_email: 'a@b.co', p_birth_date: '1990-01-02', p_reason: '수정 사유',
    })
    expect((upd.data as { ok: boolean }).ok).toBe(true)
    const { data } = await admin.rpc('get_customer_list', { p_user_id: personId })
    const row = (data as Array<Record<string, unknown>>)[0]
    expect(row.name).toBe('수정된이름')
    expect(row.blacklist_reason).toBe('수정 사유')
    expect(row.email).toBe('a@b.co')

    const clash = await admin.rpc('cms_update_managed_person', {
      p_id: personId, p_name: 'x', p_phone: `010${String(Number(suffix) + 1).padStart(8, '0')}`, p_email: null, p_birth_date: null, p_reason: 'r',
    })
    expect((clash.data as { error: string }).error).toBe('duplicate_phone')
  })

  it('동시에 같은 번호로 등록해도 한 건만 성공하고 나머지는 duplicate_phone(내부 오류 문구 노출 없음)', async () => {
    const racePhone = `010${String(Number(suffix) + 7).padStart(8, '0')}`
    const results = await Promise.all([register({ p_phone: racePhone }), register({ p_phone: racePhone }), register({ p_phone: racePhone })])
    expect(results.filter(r => r.ok)).toHaveLength(1)
    for (const r of results.filter(r => !r.ok)) expect(r.error).toBe('duplicate_phone')
  })

  it('anon은 테이블 조회·RPC 호출 모두 불가', async () => {
    const t = await anon.from('managed_persons').select('id').limit(1)
    expect(t.error ?? (t.data ?? []).length === 0).toBeTruthy()
    expect((t.data ?? []).length).toBe(0)
    const rpc = await anon.rpc('cms_register_managed_person', {
      p_name: 'x', p_phone: '010-1111-2222', p_email: null, p_birth_date: null, p_reason: 'r', p_created_by: null,
    })
    expect(rpc.error).toBeTruthy()
    const list = await anon.rpc('get_customer_list', {})
    expect(list.error).toBeTruthy()
  })

  it('삭제 — 목록에서 사라지고 같은 번호로 재등록 가능(새 코드)', async () => {
    const del = await admin.rpc('cms_delete_managed_person', { p_id: personId, p_deleted_by: null })
    expect((del.data as { ok: boolean }).ok).toBe(true)
    const { data } = await admin.rpc('get_customer_list', { p_user_id: personId })
    expect((data as unknown[]).length).toBe(0)
    const again = await register({ p_phone: digits })
    expect(again.ok).toBe(true)
    expect(again.member_code).not.toBe(memberCode)
    const delAgain = await admin.rpc('cms_delete_managed_person', { p_id: personId, p_deleted_by: null })
    expect((delAgain.data as { error: string }).error).toBe('not_found')
  })
})
