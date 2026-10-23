/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 관리자 비밀번호 복구 링크 — 발급 → 이메일 확인 → 휴대폰 OTP → 새 비밀번호 설정 전 단계 라이브 검증 (2026-10-23)
 * Stage DB(ezyvffjvuwmtuhpxdjrw) 라이브 통합테스트. 임시 관리자·대상 계정은 이 파일이 만들고 반드시 삭제한다.
 * SMS 는 가짜로 대체해(실제 문자 발송 없음) 인증번호만 가로챈다.
 *
 * 검증: ① 권한(매니저 이상·superadmin 대상은 superadmin만·고객 대상 거절) ② 발급 시 이전 링크 무효화·30분 만료·감사로그
 *       ③ 이메일/휴대폰 불일치 5회 잠금 ④ OTP 오입력 5회 잠금 ⑤ 단계 건너뛰기 거절 ⑥ 만료·사용·잠금 링크 거절
 *       ⑦ 새 비밀번호 설정(8자 미만·불일치 거절) + 실제 로그인 가능 + 1회용 + 완료 감사로그
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

const sentSms: Array<{ to: string; message: string }> = []
vi.mock('$lib/server/sms', () => ({
  sendSms: vi.fn(async (to: string, message: string) => { sentSms.push({ to, message }) }),
}))

const { actions: listActions } = await import('../../routes/cms/accounts/list/+page.server')
const { actions: loginActions } = await import('../../routes/cms/login/+page.server')

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const stamp = Date.now()
const created: string[] = []

interface Acct { id: string; email: string; phone: string }

async function mkAccount(role: string | null, label: string): Promise<Acct> {
  const email = `tdd-recov-${label}-${stamp}@example.com`
  const phone = `010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'OldPass#1234', email_confirm: true })
  if (error || !data.user) throw new Error(`계정 생성 실패: ${error?.message}`)
  const id = data.user.id
  created.push(id)
  const { error: upErr } = await admin.from('user_profiles').update({ cms_role: role, phone, full_name: `TDD ${label}` }).eq('id', id)
  if (upErr) throw new Error(`프로필 설정 실패: ${upErr.message}`)
  return { id, email, phone }
}

function localsFor(userId: string | null): any {
  return {
    safeGetSession: async () => ({ session: userId ? { user: { id: userId } } : null }),
    supabase: createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY),
  }
}

function form(fields: Record<string, string>): { formData: () => Promise<FormData> } {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return { formData: async () => fd }
}

async function issue(callerId: string | null, targetId: string): Promise<any> {
  return (listActions as any).issueRecoveryLink({ request: form({ user_id: targetId }), locals: localsFor(callerId) })
}
async function login(name: string, fields: Record<string, string>, locals = localsFor(null)): Promise<any> {
  return (loginActions as any)[name]({ request: form(fields), locals, cookies: {}, getClientAddress: () => '127.0.0.1' })
}
async function tokenRow(token: string): Promise<any> {
  const { data } = await admin.from('admin_password_recovery_tokens').select('*').eq('token', token).single()
  return data
}
/** 가장 최근 발송된 문자에서 6자리 인증번호를 꺼낸다(DB에는 해시만 있으므로 문자가 유일한 출처) */
function lastCode(): string {
  const m = sentSms[sentSms.length - 1]?.message.match(/\[(\d{6})\]/)
  if (!m) throw new Error('발송된 인증번호 문자가 없습니다')
  return m[1]
}
/** 재발송 최소 간격을 건너뛰기 위해 마지막 발송 시각을 과거로 돌린다 */
async function skipCooldown(token: string): Promise<void> {
  await admin.from('admin_password_recovery_tokens').update({ otp_sent_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }).eq('token', token)
}
async function freshToken(callerId: string, targetId: string): Promise<string> {
  const r = await issue(callerId, targetId)
  expect(r.success).toBe(true)
  return r.recoveryToken as string
}

let manager: Acct
let partner: Acct
let superadmin: Acct
let target: Acct
let customer: Acct

beforeAll(async () => {
  manager = await mkAccount('manager', 'mgr')
  partner = await mkAccount('partner', 'ptn')
  superadmin = await mkAccount('superadmin', 'sup')
  target = await mkAccount('partner', 'tgt')
  customer = await mkAccount(null, 'cus')
}, 120000)

afterAll(async () => {
  for (const id of created) {
    await admin.from('cms_admin_audit_log').delete().or(`user_id.eq.${id},target_user_id.eq.${id}`).then(undefined, () => undefined)
    await admin.from('admin_password_recovery_tokens').delete().eq('target_user_id', id).then(undefined, () => undefined)
    await admin.from('cms_login_logs').delete().eq('user_id', id).then(undefined, () => undefined)
    await admin.auth.admin.deleteUser(id).then(undefined, () => undefined)
  }
}, 120000)

describe('① 발급 권한', () => {
  it('로그인 없이는 거절(401)', async () => {
    const r = await issue(null, target.id)
    expect(r.status).toBe(401)
  })
  it('partner 는 발급 불가(403)', async () => {
    const r = await issue(partner.id, target.id)
    expect(r.status).toBe(403)
  })
  it('manager 는 partner 대상 발급 가능', async () => {
    const r = await issue(manager.id, target.id)
    expect(r.success).toBe(true)
    expect(typeof r.recoveryToken).toBe('string')
    expect((r.recoveryToken as string).length).toBe(48) // 24바이트 hex
  })
  it('manager 는 superadmin 대상 발급 불가(403) — 진짜 superadmin 만 가능', async () => {
    const denied = await issue(manager.id, superadmin.id)
    expect(denied.status).toBe(403)
    const ok = await issue(superadmin.id, superadmin.id)
    expect(ok.success).toBe(true)
  })
  it('관리자가 아닌 일반 고객 대상은 거절(400)', async () => {
    const r = await issue(manager.id, customer.id)
    expect(r.status).toBe(400)
    const { data } = await admin.from('admin_password_recovery_tokens').select('id').eq('target_user_id', customer.id)
    expect((data ?? []).length).toBe(0)
  })
})

describe('② 발급 결과', () => {
  it('30분 만료·새 발급 시 이전 링크 무효화·감사로그 기록', async () => {
    const t1 = await freshToken(manager.id, target.id)
    const t2 = await freshToken(manager.id, target.id)
    const row1 = await tokenRow(t1)
    const row2 = await tokenRow(t2)
    expect(row1.locked_at).not.toBeNull()
    expect(row2.locked_at).toBeNull()
    const minutes = (new Date(row2.expires_at).getTime() - new Date(row2.created_at).getTime()) / 60000
    expect(minutes).toBeGreaterThan(29.5)
    expect(minutes).toBeLessThan(30.5)
    const { data: logs } = await admin.from('cms_admin_audit_log').select('action_type, user_id').eq('target_user_id', target.id).eq('action_type', 'password_recovery_issued')
    expect((logs ?? []).length).toBeGreaterThanOrEqual(2)
    // 잠긴 이전 링크는 사용 불가
    const r = await login('verifyRecoveryEmail', { token: t1, email: target.email })
    expect(r.status).toBe(400)
  })
})

describe('③ 이메일 확인 단계', () => {
  it('틀린 이메일 5회 → 링크 잠금, 이후 맞는 이메일도 거절', async () => {
    const t = await freshToken(manager.id, target.id)
    for (let i = 0; i < 5; i++) {
      const r = await login('verifyRecoveryEmail', { token: t, email: 'wrong@example.com' })
      expect(r.status).toBe(400)
    }
    const row = await tokenRow(t)
    expect(row.match_attempts).toBe(5)
    expect(row.locked_at).not.toBeNull()
    const after = await login('verifyRecoveryEmail', { token: t, email: target.email })
    expect(after.status).toBe(400)
  })
  it('맞는 이메일(대소문자·공백 무시) → 통과', async () => {
    const t = await freshToken(manager.id, target.id)
    const r = await login('verifyRecoveryEmail', { token: t, email: `  ${target.email.toUpperCase()} ` })
    expect(r.success).toBe(true)
    expect((await tokenRow(t)).email_verified_at).not.toBeNull()
  })
})

describe('④ 휴대폰 OTP 단계', () => {
  it('이메일 확인 전에는 OTP 요청 거절', async () => {
    const t = await freshToken(manager.id, target.id)
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    expect(r.status).toBe(400)
    expect(sentSms.some((s) => s.to === target.phone)).toBe(false)
  })
  it('등록 번호와 다르면 거절 + 문자 미발송 + 불일치 카운트', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    const before = sentSms.length
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: '01099998888' })
    expect(r.status).toBe(400)
    expect(sentSms.length).toBe(before)
    expect((await tokenRow(t)).match_attempts).toBe(1)
  })
  it('번호 형식 오류 거절', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: '12345' })
    expect(r.status).toBe(400)
  })
  it('등록 번호면 문자 1건 발송(인증번호 포함·3분 유효) — 하이픈 입력도 허용', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    const before = sentSms.length
    const hyphenated = `${target.phone.slice(0, 3)}-${target.phone.slice(3, 7)}-${target.phone.slice(7)}`
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: hyphenated })
    expect(r.success).toBe(true)
    expect(sentSms.length).toBe(before + 1)
    const row = await tokenRow(t)
    const code = lastCode()
    expect(code).toMatch(/^\d{6}$/)
    // DB 에는 인증번호 원문이 아니라 해시(64자리 16진수)만 저장된다
    expect(row.otp_code).toMatch(/^[0-9a-f]{64}$/)
    expect(row.otp_code).not.toContain(code)
    const ttl = (new Date(row.otp_expires_at).getTime() - Date.now()) / 1000
    expect(ttl).toBeGreaterThan(150)
    expect(ttl).toBeLessThanOrEqual(180)
  })
  it('인증번호 5회 오입력 → 링크 잠금, 이후 맞는 번호도 거절', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    const good = lastCode()
    const bad = good === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      const r = await login('verifyRecoveryPhoneOtp', { token: t, code: bad })
      expect(r.status).toBe(400)
    }
    const row = await tokenRow(t)
    expect(row.otp_attempts).toBe(5)
    expect(row.locked_at).not.toBeNull()
    const after = await login('verifyRecoveryPhoneOtp', { token: t, code: good })
    expect(after.status).toBe(400)
  })
  it('인증번호 재발송을 반복해도 오입력 카운터는 초기화되지 않는다', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    await login('verifyRecoveryPhoneOtp', { token: t, code: '999999' })
    await skipCooldown(t)
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    expect((await tokenRow(t)).otp_attempts).toBe(1)
  })
  it('인증번호 만료 후 입력 거절', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    const code = lastCode()
    await admin.from('admin_password_recovery_tokens').update({ otp_expires_at: new Date(Date.now() - 1000).toISOString() }).eq('token', t)
    const r = await login('verifyRecoveryPhoneOtp', { token: t, code })
    expect(r.status).toBe(400)
  })
})

describe('⑧ 인증번호 재발송 제한', () => {
  async function readyToken(): Promise<string> {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    return t
  }
  it('발송 직후 바로 다시 요청하면 거절되고 문자는 늘지 않는다(최소 간격)', async () => {
    const t = await readyToken()
    expect((await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })).success).toBe(true)
    const before = sentSms.length
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    expect(r.status).toBe(429)
    expect(r.data?.error).toContain('초')
    expect(sentSms.length).toBe(before)
    expect((await tokenRow(t)).otp_send_count).toBe(1)
  })
  it('간격이 지나면 다시 발송되고 직전 인증번호는 새 번호로 교체된다', async () => {
    const t = await readyToken()
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    const first = lastCode()
    const hash1 = (await tokenRow(t)).otp_code
    await skipCooldown(t)
    expect((await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })).success).toBe(true)
    expect((await tokenRow(t)).otp_code).not.toBe(hash1)
    expect((await tokenRow(t)).otp_send_count).toBe(2)
    if (first !== lastCode()) {
      const old = await login('verifyRecoveryPhoneOtp', { token: t, code: first })
      expect(old.status).toBe(400)
    }
  })
  it('링크당 최대 5회까지만 발송 — 초과하면 간격이 지나도 거절', async () => {
    const t = await readyToken()
    for (let i = 0; i < 5; i++) {
      await skipCooldown(t)
      expect((await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })).success).toBe(true)
    }
    expect((await tokenRow(t)).otp_send_count).toBe(5)
    await skipCooldown(t)
    const before = sentSms.length
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    expect(r.status).toBe(429)
    expect(sentSms.length).toBe(before)
    expect((await tokenRow(t)).otp_send_count).toBe(5)
  }, 60000)
  it('동시에 여러 번 요청해도 문자는 1건만 나간다', async () => {
    const t = await readyToken()
    const before = sentSms.length
    const results = await Promise.all([1, 2, 3, 4].map(() => login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })))
    expect(results.filter((r) => r.success).length).toBe(1)
    expect(sentSms.length).toBe(before + 1)
    expect((await tokenRow(t)).otp_send_count).toBe(1)
  })
  it('문자 발송 실패 시 횟수·간격이 되돌려져 바로 다시 시도할 수 있다', async () => {
    const t = await readyToken()
    const smsMod = await import('$lib/server/sms')
    ;(smsMod.sendSms as any).mockRejectedValueOnce(new Error('sms down'))
    const r = await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    expect(r.status).toBe(500)
    const row = await tokenRow(t)
    expect(row.otp_send_count).toBe(0)
    expect(row.otp_sent_at).toBeNull()
    expect((await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })).success).toBe(true)
  })
  it('등록 번호가 아니면 간격·횟수를 소모하지 않는다(불일치 카운트만 증가)', async () => {
    const t = await readyToken()
    await login('sendRecoveryPhoneOtp', { token: t, phone: '01099998888' })
    const row = await tokenRow(t)
    expect(row.otp_send_count).toBe(0)
    expect(row.match_attempts).toBe(1)
  })
})

describe('⑨ 동시 오입력에도 5회 잠금이 유지된다(카운터 원자화)', () => {
  it('서로 다른 틀린 인증번호 12건을 동시에 보내도 오입력이 모두 기록되고 링크가 잠긴다', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    const good = lastCode()
    const guesses = Array.from({ length: 12 }, (_, i) => String(100000 + i)).filter((c) => c !== good)
    await Promise.all(guesses.map((code) => login('verifyRecoveryPhoneOtp', { token: t, code })))
    const row = await tokenRow(t)
    expect(row.locked_at).not.toBeNull()
    expect(row.otp_attempts).toBeGreaterThanOrEqual(5)
    expect((await login('verifyRecoveryPhoneOtp', { token: t, code: good })).status).toBe(400)
  }, 60000)
  it('틀린 이메일 12건을 동시에 보내도 불일치가 모두 기록되고 링크가 잠긴다', async () => {
    const t = await freshToken(manager.id, target.id)
    await Promise.all(Array.from({ length: 12 }, (_, i) => login('verifyRecoveryEmail', { token: t, email: `wrong${i}@example.com` })))
    const row = await tokenRow(t)
    expect(row.locked_at).not.toBeNull()
    expect(row.match_attempts).toBeGreaterThanOrEqual(5)
    expect((await login('verifyRecoveryEmail', { token: t, email: target.email })).status).toBe(400)
  }, 60000)
  it('틀린 입력이 4번까지는 잠기지 않고 정확히 4로 기록된다(과잉 잠금 방지)', async () => {
    const t = await freshToken(manager.id, target.id)
    for (let i = 0; i < 4; i++) await login('verifyRecoveryEmail', { token: t, email: `wrong${i}@example.com` })
    const row = await tokenRow(t)
    expect(row.match_attempts).toBe(4)
    expect(row.locked_at).toBeNull()
  })
})

describe('⑤⑥⑦ 비밀번호 설정', () => {
  it('본인확인 단계를 건너뛰고 설정 시도 → 거절, 비밀번호 불변', async () => {
    const t = await freshToken(manager.id, target.id)
    const r = await login('setRecoveryPassword', { token: t, password: 'NewPass#5678', confirm: 'NewPass#5678' })
    expect(r.status).toBe(400)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    const r2 = await login('setRecoveryPassword', { token: t, password: 'NewPass#5678', confirm: 'NewPass#5678' })
    expect(r2.status).toBe(400) // 이메일만 통과, 휴대폰 미통과
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const { error } = await anon.auth.signInWithPassword({ email: target.email, password: 'OldPass#1234' })
    expect(error).toBeNull()
  })

  it('전 단계 통과 후: 8자 미만·불일치는 거절 → 정상 설정 시 새 비밀번호로 로그인되고 /cms 로 이동, 링크는 1회용', async () => {
    const t = await freshToken(manager.id, target.id)
    await login('verifyRecoveryEmail', { token: t, email: target.email })
    await login('sendRecoveryPhoneOtp', { token: t, phone: target.phone })
    const code = lastCode()
    expect((await login('verifyRecoveryPhoneOtp', { token: t, code })).success).toBe(true)

    expect((await login('setRecoveryPassword', { token: t, password: 'short1!', confirm: 'short1!' })).status).toBe(400)
    expect((await login('setRecoveryPassword', { token: t, password: 'NewPass#5678', confirm: 'Different#999' })).status).toBe(400)
    expect((await tokenRow(t)).used_at).toBeNull()

    let redirected: any = null
    try {
      await login('setRecoveryPassword', { token: t, password: 'NewPass#5678', confirm: 'NewPass#5678' })
    } catch (e) {
      redirected = e
    }
    expect(redirected?.status).toBe(303)
    expect(redirected?.location).toBe('/cms')
    expect((await tokenRow(t)).used_at).not.toBeNull()

    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const okNew = await anon.auth.signInWithPassword({ email: target.email, password: 'NewPass#5678' })
    expect(okNew.error).toBeNull()
    const oldFails = await createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY).auth.signInWithPassword({ email: target.email, password: 'OldPass#1234' })
    expect(oldFails.error).not.toBeNull()

    const { data: logs } = await admin.from('cms_admin_audit_log').select('action_type').eq('target_user_id', target.id).eq('action_type', 'password_recovery_completed')
    expect((logs ?? []).length).toBeGreaterThanOrEqual(1)

    const reuse = await login('setRecoveryPassword', { token: t, password: 'Another#9012', confirm: 'Another#9012' })
    expect(reuse.status).toBe(400)
    expect(reuse.data?.error).toContain('이미 사용')
  }, 60000)

  it('만료된 링크로는 어떤 단계도 진행되지 않는다', async () => {
    const t = await freshToken(manager.id, target.id)
    await admin.from('admin_password_recovery_tokens').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('token', t)
    const r = await login('verifyRecoveryEmail', { token: t, email: target.email })
    expect(r.status).toBe(400)
    expect(r.data?.error).toContain('만료')
  })

  it('존재하지 않는 토큰은 유효하지 않은 링크', async () => {
    const r = await login('verifyRecoveryEmail', { token: 'f'.repeat(48), email: target.email })
    expect(r.status).toBe(400)
    expect(r.data?.error).toContain('유효하지')
  })
})
