/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * '팀 정책' 설정 RPC 라이브 검증 (Migration #753, Stage DB ezyvffjvuwmtuhpxdjrw)
 * 읽기는 비로그인도 가능, 쓰기는 CMS 사용자만, 배열·크기 검증. 시험 전 값을 저장해 끝나면 되돌리고 임시 계정을 삭제한다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const admin: any = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const stamp = Date.now()
const ids: string[] = []
let original: unknown = []
let cmsClient: any
let customerClient: any
let partnerClient: any
let superClient: any

async function mkSignedIn(label: string, role: string | null): Promise<any> {
  const email = `tdd-teampol-${label}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'OldPass#1234', email_confirm: true })
  if (error || !data.user) throw new Error(error?.message)
  ids.push(data.user.id)
  if (role) await admin.from('user_profiles').update({ cms_role: role }).eq('id', data.user.id)
  const c: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: se } = await c.auth.signInWithPassword({ email, password: 'OldPass#1234' })
  if (se) throw new Error(se.message)
  return c
}

beforeAll(async () => {
  const { data } = await admin.rpc('get_team_policy_settings')
  original = (data as any)?.content_blocks ?? []
  cmsClient = await mkSignedIn('cms', 'manager')
  customerClient = await mkSignedIn('cus', null)
  partnerClient = await mkSignedIn('ptn', 'partner')
  superClient = await mkSignedIn('sup', 'superadmin')
}, 120000)

afterAll(async () => {
  await admin.rpc('upsert_team_policy_settings', { p_blocks: original }).then(undefined, () => undefined)
  // service_role 은 is_cms_user() 가 거짓이라 위 호출이 거절될 수 있다 — 테이블을 직접 되돌린다
  await admin.from('team_policy_settings').update({ content_blocks: original }).not('id', 'is', null).then(undefined, () => undefined)
  for (const id of ids) await admin.auth.admin.deleteUser(id).then(undefined, () => undefined)
}, 120000)

describe('팀 정책 설정 RPC', () => {
  it('비로그인(anon)도 읽을 수 있고 content_blocks 배열이 온다', async () => {
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { data, error } = await anon.rpc('get_team_policy_settings')
    expect(error).toBeNull()
    expect(Array.isArray((data as any).content_blocks)).toBe(true)
  })

  it('비로그인·일반 고객은 저장할 수 없다', async () => {
    const blocks = [{ type: 'text', html: '<p>침투</p>' }]
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    expect((await anon.rpc('upsert_team_policy_settings', { p_blocks: blocks })).error).not.toBeNull()
    const r = await customerClient.rpc('upsert_team_policy_settings', { p_blocks: blocks })
    expect(r.error?.message).toContain('ACCESS_DENIED')
  })

  it('partner(협력사) 관리자는 RPC를 직접 호출해도 저장할 수 없고, 기존 값은 그대로다 — 화면 액션(manager 이상)과 같은 기준', async () => {
    const before = ((await admin.rpc('get_team_policy_settings')).data as any).content_blocks
    const r = await partnerClient.rpc('upsert_team_policy_settings', { p_blocks: [{ type: 'text', html: '<p>협력사 덮어쓰기</p>' }] })
    expect(r.error?.message).toContain('ACCESS_DENIED')
    expect(((await admin.rpc('get_team_policy_settings')).data as any).content_blocks).toEqual(before)
  })

  it('superadmin은 저장할 수 있다', async () => {
    const blocks = [{ type: 'divider' }]
    expect((await superClient.rpc('upsert_team_policy_settings', { p_blocks: blocks })).error).toBeNull()
    expect(((await admin.rpc('get_team_policy_settings')).data as any).content_blocks).toEqual(blocks)
  })

  it('테이블은 직접 읽기·쓰기가 막혀 있다(RPC로만 접근)', async () => {
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r = await anon.from('team_policy_settings').select('id')
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true)
    const w = await customerClient.from('team_policy_settings').update({ content_blocks: [] }).not('id', 'is', null)
    expect(w.error !== null || (w.data ?? []).length === 0).toBe(true)
  })

  it('CMS 사용자는 저장·재조회가 되고, 배열이 아니거나 너무 크면 거절된다', async () => {
    const blocks = [{ type: 'text', html: '<p>팀 소개</p>' }, { type: 'divider' }]
    const ok = await cmsClient.rpc('upsert_team_policy_settings', { p_blocks: blocks })
    expect(ok.error).toBeNull()
    const anon: any = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    expect(((await anon.rpc('get_team_policy_settings')).data as any).content_blocks).toEqual(blocks)

    expect((await cmsClient.rpc('upsert_team_policy_settings', { p_blocks: { type: 'text' } })).error?.message).toContain('INVALID_BLOCKS')
    expect((await cmsClient.rpc('upsert_team_policy_settings', { p_blocks: null })).error).not.toBeNull()
    const many = Array.from({ length: 201 }, () => ({ type: 'divider' }))
    expect((await cmsClient.rpc('upsert_team_policy_settings', { p_blocks: many })).error?.message).toContain('BLOCKS_TOO_LARGE')
    // 개수가 아니라 크기(약 1MB 초과)로도 거절된다 — DB 안전망(서버는 900KB에서 먼저 막는다)
    const huge = [{ type: 'text', html: 'a'.repeat(1_000_100) }]
    expect((await cmsClient.rpc('upsert_team_policy_settings', { p_blocks: huge })).error?.message).toContain('BLOCKS_TOO_LARGE')
    // 거절된 저장은 기존 값을 바꾸지 않는다
    expect(((await anon.rpc('get_team_policy_settings')).data as any).content_blocks).toEqual(blocks)
  })

  it('저장은 한 줄만 유지한다(싱글톤)', async () => {
    const { count } = await admin.from('team_policy_settings').select('id', { count: 'exact', head: true })
    expect(count).toBe(1)
  })
})
