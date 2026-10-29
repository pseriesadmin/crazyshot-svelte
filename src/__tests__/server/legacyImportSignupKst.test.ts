/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 레거시 회원 CSV 가입 시각 +9시간 밀림 수정 (2026-10-29)
 * CSV 의 가입 시각은 한국시간이다. 서버(Vercel=UTC)가 그대로 new Date()로 읽으면 UTC 로 해석돼 9시간 뒤로 저장됐다.
 * - 확정 등록은 서버 시간대와 무관하게 한국시간으로 해석해 저장한다
 * - 이상한 날짜가 있어도 등록 전체가 오류로 멈추지 않는다(가입 시각만 비움)
 * - 인증 직후 확인 화면은 저장된 시각을 한국 날짜로 보여 준다
 */
const h = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[] }))

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'svc-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessAction: async () => null }))
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => 'manager' }))
vi.mock('@sveltejs/kit', () => ({
  fail: (status: number, data: unknown) => ({ status, data }),
  redirect: (status: number, to: string) => ({ status, to }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.is = () => b
      b.maybeSingle = async () => ({ data: null, error: null })
      b.insert = async (row: Record<string, unknown>) => {
        h.inserts.push(row)
        return { error: null }
      }
      return b
    },
  }),
}))

import { actions } from '../../routes/cms/customers/legacy-import/+page.server'

const ROOT = process.cwd()

function group(signupAt: string | null, email = 'a@naver.com') {
  return {
    phone: '01011112222',
    rows: [{ name: '홍길동', phone: '01011112222', email, signupAt, purchaseCount: 1, source: 'csv', rawLine: '' }],
    representEmail: email,
    totalPurchaseCount: 1,
    excluded: false,
  }
}

async function confirm(groups: unknown[]) {
  const fd = new FormData()
  fd.set('groups_json', JSON.stringify(groups))
  const confirmAction = (actions as unknown as { confirm: (e: unknown) => Promise<unknown> }).confirm
  return confirmAction({ request: { formData: async () => fd }, locals: { safeGetSession: async () => ({ session: { user: { id: 'u' } } }) } })
}

beforeEach(() => {
  h.inserts.length = 0
})

describe('확정 등록 — 가입 시각을 한국시간으로 저장', () => {
  it('서버 시간대가 UTC 여도 "2026-04-11 19:13:29"(한국시간)는 10:13:29Z 로 저장된다', async () => {
    const before = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      await confirm([group('2026-04-11 19:13:29')])
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0].legacy_signup_at).toBe('2026-04-11T10:13:29.000Z')
  })

  it('서버 시간대가 한국이어도 같은 값이 저장된다', async () => {
    const before = process.env.TZ
    process.env.TZ = 'Asia/Seoul'
    try {
      await confirm([group('2026-04-11 19:13:29')])
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
    expect(h.inserts[0].legacy_signup_at).toBe('2026-04-11T10:13:29.000Z')
  })

  it('이상한 가입일이 있어도 등록은 계속되고 그 행의 가입 시각만 비워 둔다', async () => {
    const res = (await confirm([group('2026-13-45 99:99:99', 'bad@naver.com'), group('2026-05-31 01:08:27', 'ok@naver.com')])) as {
      ok: boolean
      summary: { successCount: number; errorCount: number }
    }
    expect(res.ok).toBe(true)
    expect(res.summary.successCount).toBe(2)
    expect(h.inserts[0].legacy_signup_at).toBeNull()
    expect(h.inserts[1].legacy_signup_at).toBe('2026-05-30T16:08:27.000Z')
  })

  it('가입일이 없으면 null', async () => {
    await confirm([group(null)])
    expect(h.inserts[0].legacy_signup_at).toBeNull()
  })

  it('소스에서 new Date(...signupAt) 직접 해석을 쓰지 않는다(서버 시간대 의존 방지)', () => {
    const src = readFileSync(join(ROOT, 'src/routes/cms/customers/legacy-import/+page.server.ts'), 'utf-8')
    expect(src).toContain('kstLocalToIso(repRow.signupAt)')
    expect(/new Date\(\s*repRow\.signupAt/.test(src)).toBe(false)
  })
})

describe('인증 직후 확인 화면 — 가입일은 한국 날짜', () => {
  it('저장된 시각을 앞 10자리로 자르지 않고 한국 날짜로 바꿔 보여 준다', () => {
    const src = readFileSync(join(ROOT, 'src/lib/components/auth/LegacyMemberVerifyModal.svelte'), 'utf-8')
    expect(src).toContain('formatKstDateDash(data.user?.signupAt)')
    expect(src).not.toContain('String(data.user.signupAt).slice(0, 10)')
  })
})
