/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * '서비스 기본 정보' 저장 RPC 권한 라이브 검증 (Migration #756, Stage DB ezyvffjvuwmtuhpxdjrw)
 * 화면 저장 액션(manager 이상)과 같은 기준으로 DB 함수도 매니저 이상만 저장할 수 있어야 한다 — partner 직접 호출 차단.
 * 값은 시험 전 상태를 저장해 끝나면 되돌리고, 임시 계정을 삭제한다. partner 호출은 기존 값 그대로 보내 데이터가 바뀌지 않는다.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin: any = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const stamp = Date.now()
const ids: string[] = []
let original: Record<string, string> = {}
const cms: Record<string, any> = {}
let customerClient: any
const KEYS = ['company_name', 'ceo_name', 'biz_address', 'biz_reg_no', 'mail_order_biz_no', 'privacy_officer', 'ceo_email', 'cs_phone', 'business_hours']

async function mkSignedIn(label: string, role: string | null): Promise<any> {
  const email = `tdd-svcinfo-${label}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'OldPass#1234', email_confirm: true })
  if (error || !data.user) throw new Error(error?.message)
  ids.push(data.user.id)
  if (role) await admin.from('user_profiles').update({ cms_role: role }).eq('id', data.user.id)
  const c: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: se } = await c.auth.signInWithPassword({ email, password: 'OldPass#1234' })
  if (se) throw new Error(se.message)
  return c
}
/** 기존 값 그대로 전달 — 호출이 통과해도 데이터가 바뀌지 않게 한다 */
function sameArgs(overrides: Record<string, string> = {}) {
  const v = { ...original, ...overrides }
  return {
    p_company_name: v.company_name, p_ceo_name: v.ceo_name, p_biz_address: v.biz_address, p_biz_reg_no: v.biz_reg_no,
    p_mail_order_biz_no: v.mail_order_biz_no, p_privacy_officer: v.privacy_officer, p_ceo_email: v.ceo_email,
    p_cs_phone: v.cs_phone, p_business_hours: v.business_hours,
  }
}
async function currentRow(): Promise<Record<string, string>> {
  const { data } = await admin.from('service_info_settings').select(KEYS.join(',')).limit(1).single()
  return data as Record<string, string>
}

beforeAll(async () => {
  original = await currentRow()
  cms.manager = await mkSignedIn('mgr', 'manager')
  cms.superadmin = await mkSignedIn('sup', 'superadmin')
  cms.partner = await mkSignedIn('ptn', 'partner')
  customerClient = await mkSignedIn('cus', null)
}, 120000)

// 케이스마다 원래 값으로 되돌려 서로의 결과에 영향을 주지 않게 한다(저장 케이스가 값을 바꾼다)
afterEach(async () => {
  await admin.from('service_info_settings').update(original).not('id', 'is', null).then(undefined, () => undefined)
})

afterAll(async () => {
  // 시험이 표를 직접 고치거나 지우려 하므로(차단 전 상태에서는 실제로 될 수 있다) 원복 때 줄이 없으면 다시 만든다
  const { count } = await admin.from('service_info_settings').select('id', { count: 'exact', head: true })
  if (!count) await admin.from('service_info_settings').insert(original).then(undefined, () => undefined)
  await admin.from('service_info_settings').update(original).not('id', 'is', null).then(undefined, () => undefined)
  for (const id of ids) await admin.auth.admin.deleteUser(id).then(undefined, () => undefined)
}, 120000)

describe('서비스 기본 정보 저장 RPC 권한', () => {
  it('partner(협력사) 관리자는 직접 호출해도 저장할 수 없다(ACCESS_DENIED), 값은 그대로', async () => {
    const r = await cms.partner.rpc('upsert_service_info_settings', sameArgs({ cs_phone: '000-PARTNER-HACK' }))
    expect(r.error?.message).toContain('ACCESS_DENIED')
    expect(await currentRow()).toEqual(original)
  })

  it('일반 고객은 저장할 수 없다', async () => {
    const r = await customerClient.rpc('upsert_service_info_settings', sameArgs({ cs_phone: '000-CUSTOMER-HACK' }))
    expect(r.error?.message).toContain('ACCESS_DENIED')
    expect(await currentRow()).toEqual(original)
  })

  it('비로그인(anon)은 함수 실행 권한 자체가 없다', async () => {
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r = await anon.rpc('upsert_service_info_settings', sameArgs({ cs_phone: '000-ANON-HACK' }))
    expect(r.error).not.toBeNull()
    expect(r.error.message).toMatch(/permission denied/i)
    expect(await currentRow()).toEqual(original)
  })

  it('manager·superadmin은 저장·조회할 수 있다', async () => {
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    for (const [client, mark] of [[cms.manager, '1588-MGR-TEST'], [cms.superadmin, '1588-SUP-TEST']] as const) {
      const r = await client.rpc('upsert_service_info_settings', sameArgs({ cs_phone: mark }))
      expect(r.error).toBeNull()
      expect(((await anon.rpc('get_service_info_settings')).data as any).cs_phone).toBe(mark)
    }
  })

  it('읽기 함수는 비로그인도 계속 쓸 수 있다(푸터·계약서 공용)', async () => {
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r = await anon.rpc('get_service_info_settings')
    expect(r.error).toBeNull()
    expect(typeof (r.data as any).company_name).toBe('string')
  })
})

describe('서비스 기본 정보 표 직접 쓰기 차단(RPC 우회 방지, Migration #757)', () => {
  it('partner 가 RPC 대신 표를 직접 고치거나 지우려 해도 한 줄도 바뀌지 않는다', async () => {
    const upd = await cms.partner.from('service_info_settings').update({ cs_phone: '000-DIRECT-HACK' }).not('id', 'is', null).select('id')
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    const del = await cms.partner.from('service_info_settings').delete().not('id', 'is', null).select('id')
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    const ins = await cms.partner.from('service_info_settings').insert({ company_name: 'x' })
    expect(ins.error).not.toBeNull()
    expect(await currentRow()).toEqual(original)
  })

  it('일반 고객·비로그인도 표를 직접 쓸 수 없고, 비로그인은 쓰기 권한 자체가 없다', async () => {
    const upd = await customerClient.from('service_info_settings').update({ cs_phone: '000-CUS-HACK' }).not('id', 'is', null).select('id')
    expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const a = await anon.from('service_info_settings').update({ cs_phone: '000-ANON-HACK' }).not('id', 'is', null).select('id')
    expect(a.error).not.toBeNull()
    expect(a.error.message).toMatch(/permission denied/i)
    expect(await currentRow()).toEqual(original)
  })

  it('manager 는 표를 직접 고칠 수 있고, 비로그인 읽기(푸터·계약서)는 그대로다', async () => {
    const upd = await cms.manager.from('service_info_settings').update({ cs_phone: '1588-DIRECT-OK' }).not('id', 'is', null).select('id')
    expect(upd.error).toBeNull()
    expect((upd.data ?? []).length).toBe(1)
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r = await anon.from('service_info_settings').select('cs_phone').limit(1).single()
    expect(r.error).toBeNull()
    expect(r.data.cs_phone).toBe('1588-DIRECT-OK')
  })
})

