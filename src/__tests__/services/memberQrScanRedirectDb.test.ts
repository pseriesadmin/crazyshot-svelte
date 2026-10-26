import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { identifyQrPayload } from '../../lib/utils/qrProductId'
import { load } from '../../routes/cms/mobile/qr/member/[code]/+page.server'

/**
 * 고객 마이페이지 '회원 확인 QR'(/qr/member/{member_code}) → 모바일 CMS 스캐너 → 고객정보 패널 자동 이동 검증 (Stage 라이브)
 * 체인: MemberQrModal 페이로드 → identifyQrPayload(member) → /cms/mobile/qr/member/{code} 의 load → /cms/customers?selected={id}&tab=rental
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
let userId = ''
let memberCode = ''

async function run(code: string, cmsRole: string | null): Promise<{ status: number; location?: string; errorStatus?: number }> {
  try {
    await (load as unknown as (e: never) => Promise<unknown>)({ params: { code }, parent: async () => ({ cmsRole }) } as never)
    return { status: 200 }
  } catch (e) {
    const err = e as { status?: number; location?: string }
    if (err.location) return { status: err.status ?? 0, location: err.location }
    return { status: 0, errorStatus: err.status }
  }
}

beforeAll(async () => {
  const email = `tdd-qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`시험 계정 생성 실패: ${error?.message}`)
  userId = data.user.id
  const { data: prof } = await admin.from('user_profiles').select('member_code').eq('id', userId).maybeSingle()
  memberCode = (prof as { member_code: string | null } | null)?.member_code ?? ''
  if (!memberCode) throw new Error('회원코드가 발급되지 않았습니다(시험 전제)')
})
afterAll(async () => {
  await admin.from('user_profiles').delete().eq('id', userId)
  await admin.auth.admin.deleteUser(userId).catch(() => undefined)
})

describe('회원 QR → 모바일 CMS 스캔 → 고객정보 패널', () => {
  it('고객 화면이 만드는 QR 페이로드는 CMS 스캐너가 회원 QR 로 판별한다', () => {
    expect(identifyQrPayload(`/qr/member/${memberCode}`)).toEqual({ type: 'member', value: memberCode })
  })

  it('스캔한 회원코드로 /cms/customers?selected={고객}&tab=rental 로 자동 이동한다(대소문자 무관)', async () => {
    const expected = `/cms/customers?selected=${userId}&tab=rental`
    expect(await run(memberCode, 'partner')).toMatchObject({ status: 303, location: expected })
    expect(await run(memberCode.toLowerCase(), 'manager')).toMatchObject({ status: 303, location: expected })
  })

  it('CMS 직원이 아니면 로그인 화면으로 보내고 고객 정보는 조회하지 않는다', async () => {
    expect(await run(memberCode, null)).toMatchObject({ status: 303, location: '/cms/login' })
  })

  it('없는 회원코드는 404 로 안내한다', async () => {
    expect((await run('CSNOSUCHMEMBER999999', 'manager')).errorStatus).toBe(404)
  })

  it('삭제 처리된 계정의 회원코드로는 고객 패널로 이동하지 않는다', async () => {
    await admin.from('user_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', userId)
    const r = await run(memberCode, 'manager')
    expect(r.location ?? '').not.toContain(`selected=${userId}`)
  })
})
