import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { liveTracking } from '$lib/utils/trackingNotice'

/** 알림(푸시·문자)에 두발히어로 취소 접수번호를 싣지 않는다 (2026-10-27, sp3 MAJOR) */
describe('liveTracking', () => {
  const CANCELED = { canceledAt: '2026-10-27T01:00:00Z' }
  it('LT-1 취소된 두발히어로 접수는 번호·택배사를 비운다', () => {
    expect(liveTracking('두발히어로', 'CS-1', CANCELED)).toEqual({ courier: null, number: null })
  })
  it('LT-2 살아 있는 두발히어로 접수는 그대로', () => {
    expect(liveTracking('두발히어로', 'CS-1', {})).toEqual({ courier: '두발히어로', number: 'CS-1' })
    expect(liveTracking('두발히어로', 'CS-1', null)).toEqual({ courier: '두발히어로', number: 'CS-1' })
  })
  it('LT-3 다른 택배사는 canceledAt 과 무관하게 그대로', () => {
    expect(liveTracking('CJ대한통운', '123', CANCELED)).toEqual({ courier: 'CJ대한통운', number: '123' })
  })
  it('LT-4 번호가 없으면 둘 다 null', () => {
    expect(liveTracking('두발히어로', null, {})).toEqual({ courier: null, number: null })
  })
  it('LT-5 push.ts 허브가 dhero_meta 를 읽고 liveTracking 으로 번호를 거른다', () => {
    const src = readFileSync('src/lib/server/push.ts', 'utf8')
    expect(src).toContain('dhero_meta')
    expect(src).toContain('liveTracking(')
  })
})
