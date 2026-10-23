/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CMS 고객 패널 "비밀번호 설정 링크 발행" — 발행 → 링크 열기(랜딩 화면과 같은 호출) → 새 비밀번호 설정 라이브 검증 (2026-10-23)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 대상. 임시 관리자·고객 계정은 이 파일이 만들고 반드시 삭제한다.
 * 관리자 푸시는 가짜로 대체해(실제 알림 없음) 호출 내용만 확인한다. 메일·문자는 발송하지 않는 기능이다.
 *
 * 랜딩 화면(/auth/reset-password)은 onMount 에서 supabase.auth.verifyOtp({type:'recovery', token_hash}) → 비밀번호 입력 시
 * supabase.auth.updateUser({password}) 를 호출한다. 이 테스트는 같은 두 호출을 익명 클라이언트로 그대로 수행한다.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const pushCalls: Array<{ key: string; payload: any }> = []
vi.mock('$lib/server/push', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>()
  return {
    ...orig,
    sendPushToAdmins: vi.fn(async (key: string, payload: unknown) => { pushCalls.push({ key, payload }) }),
  }
})

const { POST } = await import('../../routes/api/cms/customers/[id]/recovery-link/+server')

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const stamp = Date.now()
const created: string[] = []
const ORIGIN = 'https://stage.example.test'

interface Acct { id: string; email: string }

async function mk(label: string, role: string | null, extra: Record<string, unknown> = {}): Promise<Acct> {
  const email = `tdd-custlink-${label}-${stamp}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'OldPass#1234', email_confirm: true })
  if (error || !data.user) throw new Error(`계정 생성 실패: ${error?.message}`)
  created.push(data.user.id)
  if (role) roleOf.set(data.user.id, role)
  const { error: upErr } = await admin.from('user_profiles').update({ cms_role: role, full_name: `TDD ${label}`, ...extra }).eq('id', data.user.id)
  if (upErr) throw new Error(`프로필 설정 실패: ${upErr.message}`)
  return { id: data.user.id, email }
}

const roleOf = new Map<string, string>()
function localsFor(userId: string | null): any {
  // 실제 요청에서는 로그인 세션 클라이언트가 역할을 읽는다 — 시험에서는 역할을 직접 지정한다
  return {
    safeGetSession: async () => ({ session: userId ? { user: { id: userId } } : null }),
    supabase: createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY),
    cmsRole: userId ? roleOf.get(userId) : undefined,
  }
}
async function issue(callerId: string | null, targetId: string): Promise<{ status: number; body: any }> {
  const res: Response = await (POST as any)({ params: { id: targetId }, url: new URL(`${ORIGIN}/cms/customers`), locals: localsFor(callerId) })
  return { status: res.status, body: await res.json() }
}
function tokenHashOf(link: string): string {
  const u = new URL(link)
  expect(u.origin).toBe(ORIGIN)
  expect(u.pathname).toBe('/auth/reset-password')
  expect(u.searchParams.get('type')).toBe('recovery')
  return u.searchParams.get('token_hash') as string
}
async function clearAudit(targetId: string): Promise<void> {
  await admin.from('cms_admin_audit_log').delete().eq('target_user_id', targetId)
}

let manager: Acct
let partner: Acct
let cusA: Acct
let cusB: Acct
let adminTarget: Acct
let withdrawing: Acct

beforeAll(async () => {
  manager = await mk('mgr', 'manager')
  partner = await mk('ptn', 'partner')
  cusA = await mk('cusA', null)
  cusB = await mk('cusB', null)
  adminTarget = await mk('adm', 'partner')
  withdrawing = await mk('wd', null, { withdrawal_status: 'requested' })
}, 120000)

afterAll(async () => {
  for (const id of created) {
    await admin.from('cms_admin_audit_log').delete().or(`user_id.eq.${id},target_user_id.eq.${id}`).then(undefined, () => undefined)
    await admin.auth.admin.deleteUser(id).then(undefined, () => undefined)
  }
}, 120000)

describe('발행 권한·대상', () => {
  it('로그인 없음 401 · 파트너 403 · 관리자 계정 대상 403 · 탈회 신청 계정 409', async () => {
    expect((await issue(null, cusA.id)).status).toBe(401)
    expect((await issue(partner.id, cusA.id)).status).toBe(403)
    expect((await issue(manager.id, adminTarget.id)).status).toBe(403)
    expect((await issue(manager.id, withdrawing.id)).status).toBe(409)
  })
})

describe('발행 → 링크 열기 → 새 비밀번호', () => {
  it('링크 형식·발행 기록·관리자 알림이 맞고, 링크로 세션이 열려 새 비밀번호로 로그인된다(링크는 1회용)', async () => {
    pushCalls.length = 0
    const r = await issue(manager.id, cusA.id)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    const hash = tokenHashOf(r.body.link)

    // 감사 기록: 발행 사실만, 링크·토큰은 없음
    const { data: logs } = await admin.from('cms_admin_audit_log').select('user_id, action_type, after_value').eq('target_user_id', cusA.id).eq('action_type', 'password_recovery_issued')
    expect((logs ?? []).length).toBe(1)
    expect(JSON.stringify(logs)).not.toContain(hash)
    // 관리자 알림: 이메일 마스킹·링크 미포함
    expect(pushCalls.length).toBe(1)
    expect(pushCalls[0].payload.body).not.toContain(cusA.email)
    expect(pushCalls[0].payload.body).not.toContain(hash)

    // 랜딩 화면과 같은 호출 ① 링크 열기
    const browser = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const opened = await browser.auth.verifyOtp({ type: 'recovery', token_hash: hash })
    expect(opened.error).toBeNull()
    expect(opened.data.session?.user.id).toBe(cusA.id)
    // ② 새 비밀번호 설정
    const upd = await browser.auth.updateUser({ password: 'NewPass#5678' })
    expect(upd.error).toBeNull()
    const okNew = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: cusA.email, password: 'NewPass#5678' })
    expect(okNew.error).toBeNull()
    const oldFail = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: cusA.email, password: 'OldPass#1234' })
    expect(oldFail.error).not.toBeNull()
    // 같은 링크 다시 열기 → 거절
    const again = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.verifyOtp({ type: 'recovery', token_hash: hash })
    expect(again.error).not.toBeNull()
  }, 60000)

  it('같은 고객에게 바로 다시 발행하면 5분 쿨다운으로 거절된다', async () => {
    const r = await issue(manager.id, cusA.id)
    expect(r.status).toBe(429)
    expect(r.body.link).toBeUndefined()
  })

  it('쿨다운 후 재발행하면 이전 링크는 무효가 되고 새 링크만 열린다', async () => {
    const first = await issue(manager.id, cusB.id)
    expect(first.status).toBe(200)
    await clearAudit(cusB.id) // 5분 쿨다운 대신 기록을 비워 재발행 상황을 만든다
    const second = await issue(manager.id, cusB.id)
    expect(second.status).toBe(200)
    const h1 = tokenHashOf(first.body.link)
    const h2 = tokenHashOf(second.body.link)
    expect(h1).not.toBe(h2)
    const mkBrowser = () => createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    expect((await mkBrowser().auth.verifyOtp({ type: 'recovery', token_hash: h1 })).error).not.toBeNull()
    expect((await mkBrowser().auth.verifyOtp({ type: 'recovery', token_hash: h2 })).error).toBeNull()
  }, 60000)
})
