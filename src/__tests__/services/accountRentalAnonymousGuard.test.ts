import { describe, it, expect, vi } from 'vitest'

/**
 * 문자·알림 링크(/account/rental)를 채팅 게스트(익명) 세션으로 열면 "대여 내역이 없습니다"만 보이던 문제 (2026-10-27)
 * 익명 세션은 가입 전 계정이라 예약이 없다 — 빈 목록이 아니라 로그인 화면으로 보내야 한다(로그인 뒤 같은 주소로 복귀).
 */
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'a' }))

import { load } from '../../routes/account/rental/+page.server'
import { load as loadAccount } from '../../routes/account/+page.server'
import { load as loadCancel } from '../../routes/account/cancel/+page.server'
import { load as loadInquiry } from '../../routes/account/inquiry/+page.server'
import { load as loadProfile } from '../../routes/account/profile/+page.server'
import { load as loadRentalDetail } from '../../routes/account/rental/[id]/+page.server'

const run = (session: unknown) =>
  (load as unknown as (e: unknown) => Promise<unknown>)({
    locals: { safeGetSession: async () => ({ session }), supabase: { from: () => { throw new Error('should not query') } } },
    url: new URL('https://crazyshot.kr/account/rental'),
  })

describe('/account/rental 로더 — 익명 세션', () => {
  it('AN-1 세션 없음 → 로그인으로 이동(복귀 주소 포함)', async () => {
    await expect(run(null)).rejects.toMatchObject({ status: 303, location: '/auth/login?redirect=%2Faccount%2Frental' })
  })
  it('AN-2 익명 세션 → 빈 목록이 아니라 로그인으로 이동(예약 조회도 하지 않는다)', async () => {
    await expect(run({ user: { id: 'anon-1', is_anonymous: true } })).rejects.toMatchObject({ status: 303, location: '/auth/login?redirect=%2Faccount%2Frental' })
  })
})

// 마이페이지 나머지 화면도 같은 기준(2026-10-27)
const OTHERS: Array<[string, string, unknown]> = [
  ['/account', '/account', loadAccount],
  ['/account/cancel', '/account/cancel', loadCancel],
  ['/account/inquiry', '/account/inquiry', loadInquiry],
  ['/account/profile', '/account/profile', loadProfile],
  ['/account/rental/[id]', '/account/rental/77', loadRentalDetail],
]
describe('마이페이지 나머지 로더 — 익명 세션', () => {
  for (const [name, path, fn] of OTHERS) {
    const call = (session: unknown) =>
      (fn as (e: unknown) => Promise<unknown>)({
        locals: { safeGetSession: async () => ({ session }), supabase: { from: () => { throw new Error('should not query') }, rpc: () => { throw new Error('should not query') } } },
        url: new URL(`https://crazyshot.kr${path}`),
        params: { id: '77' },
        depends: () => undefined,
      })
    const location = `/auth/login?redirect=${encodeURIComponent(path)}`
    it(`AN-3 ${name}: 세션 없음 → 로그인`, async () => {
      await expect(call(null)).rejects.toMatchObject({ status: 303, location })
    })
    it(`AN-4 ${name}: 익명 세션 → 로그인(조회하지 않음)`, async () => {
      await expect(call({ user: { id: 'anon-1', is_anonymous: true } })).rejects.toMatchObject({ status: 303, location })
    })
  }
})
