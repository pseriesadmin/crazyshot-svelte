import { describe, it, expect } from 'vitest'
import { safeReturnPath } from '$lib/utils/safeReturnPath'

describe('safeReturnPath', () => {
  it.each([
    ['/products/abc', '/products/abc'],
    ['/products/abc?x=1#y', '/products/abc?x=1#y'],
    ['/', '/'],
    ['/%2F%2Fevil', '/%2F%2Fevil'], // 리터럴 인코딩 문자열은 같은 오리진 경로로만 해석되므로 허용(외부 이동 불가)
  ])('내부 경로 허용 %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected)
  })

  it.each([
    [null], [undefined], [''], ['products/abc'], ['//evil.com'], ['/\\evil.com'],
    ['https://evil.com'], ['javascript:alert(1)'], ['/ok\nSet-Cookie: x'], ['/ok\tx'],
  ])('외부·위험 경로 거부 %j', (input) => {
    expect(safeReturnPath(input as string | null | undefined)).toBeNull()
  })
})
