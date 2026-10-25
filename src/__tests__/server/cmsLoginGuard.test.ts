import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  LOGIN_FAIL_MAX_PER_EMAIL,
  LOGIN_FAIL_MAX_PER_EMAIL_IP,
  LOGIN_FAIL_MAX_PER_IP,
  hashLoginEmail,
  isLoginBlocked,
  isNewLoginEnvironment,
  recordLoginFailure,
} from '../../lib/server/cmsLoginGuard'

/** CMS 로그인 보호 — 실패 제한(이메일+접속지 5·접속지 20·이메일 전체 30, fail-open)·이메일 해시·새 환경 판별 */
function adminWithCounts(counts: { pair: number; ip: number; email: number }, opts: { error?: boolean } = {}): SupabaseClient {
  return {
    from: () => ({
      select: () => {
        const f: { email?: boolean; ip?: boolean } = {}
        const q: Record<string, unknown> = {}
        q.eq = (column: string) => {
          if (column === 'email_hash') f.email = true
          if (column === 'ip_address') f.ip = true
          return q
        }
        q.gte = async () => {
          if (opts.error) return { count: null, error: { message: 'db down' } }
          const count = f.email && f.ip ? counts.pair : f.ip ? counts.ip : counts.email
          return { count, error: null }
        }
        return q
      },
      insert: vi.fn(async () => ({ error: null })),
      delete: () => ({ lt: async () => ({ error: null }), eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient
}

describe('hashLoginEmail', () => {
  it('대소문자·공백 차이는 같은 해시, 원문은 노출되지 않는다', () => {
    expect(hashLoginEmail(' Admin@Example.com ')).toBe(hashLoginEmail('admin@example.com'))
    expect(hashLoginEmail('admin@example.com')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isLoginBlocked', () => {
  it('같은 이메일+접속지 실패가 한도에 닿으면 차단, 미만이면 허용', async () => {
    expect(await isLoginBlocked(adminWithCounts({ pair: LOGIN_FAIL_MAX_PER_EMAIL_IP - 1, ip: 0, email: 0 }), 'h', '1.1.1.1')).toBe(false)
    expect(await isLoginBlocked(adminWithCounts({ pair: LOGIN_FAIL_MAX_PER_EMAIL_IP, ip: 0, email: 0 }), 'h', '1.1.1.1')).toBe(true)
  })
  it('다른 접속지에서 이 이메일로 5번 틀려도(이메일 전체 30 미만) 정상 접속지의 로그인은 막히지 않는다(계정 잠금 DoS 방지)', async () => {
    expect(await isLoginBlocked(adminWithCounts({ pair: 0, ip: 0, email: LOGIN_FAIL_MAX_PER_EMAIL - 1 }), 'h', '9.9.9.9')).toBe(false)
  })
  it('접속지 실패가 20회에 닿으면 차단', async () => {
    expect(await isLoginBlocked(adminWithCounts({ pair: 0, ip: LOGIN_FAIL_MAX_PER_IP - 1, email: 0 }), 'h', '1.1.1.1')).toBe(false)
    expect(await isLoginBlocked(adminWithCounts({ pair: 0, ip: LOGIN_FAIL_MAX_PER_IP, email: 0 }), 'h', '1.1.1.1')).toBe(true)
  })
  it('이메일 전체 실패가 30회에 닿으면(분산 대입) 차단', async () => {
    expect(await isLoginBlocked(adminWithCounts({ pair: 0, ip: 0, email: LOGIN_FAIL_MAX_PER_EMAIL }), 'h', '1.1.1.1')).toBe(true)
  })
  it('조회 오류면 차단하지 않는다(fail-open)', async () => {
    expect(await isLoginBlocked(adminWithCounts({ pair: 99, ip: 99, email: 99 }, { error: true }), 'h', '1.1.1.1')).toBe(false)
  })
})

describe('recordLoginFailure', () => {
  it('기록 오류가 예외로 번지지 않는다', async () => {
    const admin = { from: () => { throw new Error('boom') } } as unknown as SupabaseClient
    await expect(recordLoginFailure(admin, 'h', '1.1.1.1')).resolves.toBeUndefined()
  })
})

describe('isNewLoginEnvironment', () => {
  const prev = [{ ip_address: '1.1.1.1', user_agent: 'UA-A' }]
  it('첫 로그인(이전 기록 없음)은 새 환경이 아니다', () => {
    expect(isNewLoginEnvironment([], '1.1.1.1', 'UA-A')).toBe(false)
  })
  it('같은 접속지+브라우저면 새 환경이 아니다', () => {
    expect(isNewLoginEnvironment(prev, '1.1.1.1', 'UA-A')).toBe(false)
  })
  it('접속지나 브라우저 중 하나라도 다르면 새 환경이다', () => {
    expect(isNewLoginEnvironment(prev, '2.2.2.2', 'UA-A')).toBe(true)
    expect(isNewLoginEnvironment(prev, '1.1.1.1', 'UA-B')).toBe(true)
  })
})

import { UNKNOWN_IP, normalizeLoginIp, normalizeLoginUserAgent } from '../../lib/server/cmsLoginGuard'

describe('접속지를 모를 때·해시 salt·정규화(sp3 m1·m2·m3)', () => {
  it("접속지가 'unknown' 이면 접속지 기준 제한은 적용하지 않는다(다른 사용자와 함께 잠기지 않는다)", async () => {
    expect(await isLoginBlocked(adminWithCounts({ pair: 99, ip: 99, email: 0 }), 'h', UNKNOWN_IP)).toBe(false)
    expect(await isLoginBlocked(adminWithCounts({ pair: 0, ip: 0, email: LOGIN_FAIL_MAX_PER_EMAIL }), 'h', UNKNOWN_IP)).toBe(true)
  })
  it('salt 가 있으면 같은 이메일도 해시가 다르고(역추적 불가), 같은 salt 면 대소문자 차이는 같은 해시', () => {
    expect(hashLoginEmail('a@b.com', 'secret')).not.toBe(hashLoginEmail('a@b.com'))
    expect(hashLoginEmail('A@B.com ', 'secret')).toBe(hashLoginEmail('a@b.com', 'secret'))
  })
  it('접속지는 x-forwarded-for 첫 값만, 브라우저는 버전 숫자를 지워 비교한다', () => {
    expect(normalizeLoginIp('1.1.1.1, 10.0.0.1')).toBe('1.1.1.1')
    expect(normalizeLoginUserAgent('Mozilla/5.0 Chrome/130.0.1 Safari/537.36')).toBe(normalizeLoginUserAgent('Mozilla/5.0 Chrome/131.0.2 Safari/537.36'))
    expect(isNewLoginEnvironment([{ ip_address: '1.1.1.1, 10.0.0.1', user_agent: 'Chrome/130.0.1' }], '1.1.1.1', 'Chrome/131.0.2')).toBe(false)
    expect(isNewLoginEnvironment([{ ip_address: '1.1.1.1', user_agent: 'Chrome/130' }], '2.2.2.2', 'Chrome/130')).toBe(true)
  })
})
