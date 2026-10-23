import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { lookupLegacyForClaim, normalizeLegacyName, validateNewPassword } from '$lib/server/legacyClaim'

/**
 * 기존 회원 인증 조회 사유 구분·이름 공백 무시·이메일 중복 확인(auth.users 포함) — Migration #746 (2026-10-23)
 * Stage DB 라이브 통합테스트. 만든 데이터는 afterEach 에서 모두 정리한다.
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn().catch(() => undefined)
  }
})

const rnd = () => Math.random().toString(36).slice(2, 8)
const randomPhone = () => '010' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')

async function createStaging(name: string, phone: string): Promise<void> {
  const email = `tdd-legacy-${Date.now()}-${rnd()}@example.com`
  const { data, error } = await admin.from('legacy_member_staging').insert({ full_name: name, phone, email, legacy_source: 'csv' }).select('id').single()
  if (error || !data) throw new Error(`staging 생성 실패: ${error?.message}`)
  cleanups.push(async () => { await admin.from('legacy_member_staging').delete().eq('id', data.id) })
}

async function createAccount(opts: { name: string; phone: string; claimed?: boolean }): Promise<{ id: string; email: string }> {
  const email = `tdd-legacy-acct-${Date.now()}-${rnd()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`계정 생성 실패: ${error?.message}`)
  const id = data.user.id
  cleanups.push(async () => { await admin.auth.admin.deleteUser(id) })
  const { error: upErr } = await admin.from('user_profiles').update({
    full_name: opts.name, phone: opts.phone, ...(opts.claimed ? { legacy_claimed_at: new Date().toISOString() } : {}),
  }).eq('user_id', id)
  if (upErr) throw new Error(`프로필 갱신 실패: ${upErr.message}`)
  return { id, email }
}

describe('[TDD] find_legacy_member — 이름 공백 무시(#746)', () => {
  it('대기 목록 이름에 가운데 공백이 있어도 공백 없이 입력하면 찾는다(반대도 동일)', async () => {
    const phone = randomPhone()
    await createStaging('김 철수', phone)
    expect((await lookupLegacyForClaim(admin, '김철수', phone)).status).toBe('found')
    expect((await lookupLegacyForClaim(admin, ' 김  철수 ', phone)).status).toBe('found')
  })

  it('전화번호가 다르면 찾지 못한다', async () => {
    const phone = randomPhone()
    await createStaging('홍길동', phone)
    expect((await lookupLegacyForClaim(admin, '홍길동', randomPhone())).status).toBe('not_found')
  })
})

describe('[TDD] lookupLegacyForClaim — 못 찾은 사유 구분', () => {
  it('이미 같은 이름·번호로 인증을 끝낸 계정이면 already_claimed', async () => {
    const phone = randomPhone()
    await createAccount({ name: '이영희', phone, claimed: true })
    expect((await lookupLegacyForClaim(admin, '이영희', phone)).status).toBe('already_claimed')
  })

  it('일반 가입으로 이미 만든 계정이면 already_registered', async () => {
    const phone = randomPhone()
    await createAccount({ name: '박민수', phone })
    expect((await lookupLegacyForClaim(admin, '박 민수', phone)).status).toBe('already_registered')
  })

  it('번호만 같고 이름이 다르면 가입 여부를 알려 주지 않고 not_found(정보 노출 방지)', async () => {
    const phone = randomPhone()
    await createAccount({ name: '최지우', phone, claimed: true })
    expect((await lookupLegacyForClaim(admin, '다른사람', phone)).status).toBe('not_found')
  })

  it('아무 데도 없으면 not_found', async () => {
    expect((await lookupLegacyForClaim(admin, '없는사람', randomPhone())).status).toBe('not_found')
  })
})

describe('[TDD] check_email_registered — 프로필 + 로그인 계정(auth.users) 모두 확인(#746)', () => {
  const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
  const check = async (email: string) => {
    const { data, error } = await (anon.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }>)('check_email_registered', { p_email: email })
    expect(error).toBeNull()
    return data
  }

  it('가입된 이메일은 true(대소문자 무시), 없는 이메일은 false', async () => {
    const acct = await createAccount({ name: '정다은', phone: randomPhone() })
    expect(await check(acct.email)).toBe(true)
    expect(await check(acct.email.toUpperCase())).toBe(true)
    expect(await check(`nobody-${Date.now()}-${rnd()}@example.com`)).toBe(false)
  })

  it('프로필이 삭제 처리돼도 로그인 계정에 남아 있으면 true(가입 마지막에 막히는 불일치 방지)', async () => {
    const acct = await createAccount({ name: '한서준', phone: randomPhone() })
    await admin.from('user_profiles').update({ deleted_at: new Date().toISOString(), phone: null }).eq('user_id', acct.id)
    expect(await check(acct.email)).toBe(true)
  })
})

describe('순수 함수', () => {
  it('normalizeLegacyName — 모든 공백 제거·대문자', () => {
    expect(normalizeLegacyName(' 김 철 수 ')).toBe('김철수')
    expect(normalizeLegacyName('Kim  Min')).toBe('KIMMIN')
  })

  it('validateNewPassword — 6~72자 ASCII', () => {
    expect(validateNewPassword('abc123!').ok).toBe(true)
    expect(validateNewPassword('12345').ok).toBe(false)
    expect(validateNewPassword('가나다라마바사').ok).toBe(false)
    expect(validateNewPassword('a b c d e f').ok).toBe(false)
    expect(validateNewPassword('x'.repeat(73)).ok).toBe(false)
    expect(validateNewPassword(undefined).ok).toBe(false)
  })
})
