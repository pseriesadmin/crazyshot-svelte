import { describe, it, expect } from 'vitest'
import { loginHref } from '../../lib/utils/loginRedirect'
import { safeReturnPath } from '../../lib/utils/safeReturnPath'

describe('loginHref — 로그인 후 직전 화면 복귀 링크', () => {
  it('일반 화면은 현재 경로(+쿼리)를 redirect로 붙인다', () => {
    expect(loginHref('/products/abc')).toBe('/auth/login?redirect=%2Fproducts%2Fabc')
    expect(loginHref('/products/abc', '?tab=review&x=1')).toBe('/auth/login?redirect=%2Fproducts%2Fabc%3Ftab%3Dreview%26x%3D1')
  })

  it('홈·인증 화면·빈 경로에서는 붙이지 않는다(루프 방지)', () => {
    expect(loginHref('/')).toBe('/auth/login')
    expect(loginHref('')).toBe('/auth/login')
    expect(loginHref('/auth/login', '?redirect=%2Fcart')).toBe('/auth/login')
    expect(loginHref('/auth/reset-password')).toBe('/auth/login')
  })

  it('너무 긴 경로는 붙이지 않는다', () => {
    expect(loginHref('/p', '?' + 'a'.repeat(600))).toBe('/auth/login')
  })

  it('로그인 화면이 검증(safeReturnPath)을 통과하는 값으로 복원된다', () => {
    const href = loginHref('/products/abc', '?tab=review')
    const raw = new URL(href, 'https://x.test').searchParams.get('redirect')
    expect(safeReturnPath(raw)).toBe('/products/abc?tab=review')
  })
})
