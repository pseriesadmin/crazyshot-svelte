// Stage 6 TDD — 접속로그 조회 권한 판정 로직 단위 테스트
// 완료기준: partner가 타인 로그 조회 시도 시 false(→403) GREEN
import { describe, it, expect } from 'vitest'
import { canViewLoginLogs } from '../../lib/server/loginLogsAccessCheck'

// cmsPermissions를 그대로 쓰는 순수 함수 — vi.mock 불필요
// (getRoleLevel 의존성이 있지만 외부 I/O 없음)

const SELF_ID   = 'user-self-123'
const OTHER_ID  = 'user-other-456'

describe('canViewLoginLogs — 접속로그 조회 권한 판정', () => {
  // ── partner ─────────────────────────────────────────────────
  it('partner: 본인 로그 조회 → true', () => {
    expect(canViewLoginLogs('partner', SELF_ID, SELF_ID)).toBe(true)
  })

  it('partner: 타인 로그 조회 → false (403)', () => {
    expect(canViewLoginLogs('partner', SELF_ID, OTHER_ID)).toBe(false)
  })

  // ── manager ──────────────────────────────────────────────────
  it('manager: 타인 로그 조회 → true', () => {
    expect(canViewLoginLogs('manager', SELF_ID, OTHER_ID)).toBe(true)
  })

  it('manager: 본인 로그 조회 → true', () => {
    expect(canViewLoginLogs('manager', SELF_ID, SELF_ID)).toBe(true)
  })

  // ── superadmin ───────────────────────────────────────────────
  it('superadmin: 타인 로그 조회 → true', () => {
    expect(canViewLoginLogs('superadmin', SELF_ID, OTHER_ID)).toBe(true)
  })

  // ── 미지 역할 ────────────────────────────────────────────────
  it('unknown role: 타인 로그 조회 → false', () => {
    expect(canViewLoginLogs('guest', SELF_ID, OTHER_ID)).toBe(false)
  })

  it('unknown role: 본인 로그 조회 → true (user_id 일치 조건으로 통과)', () => {
    expect(canViewLoginLogs('guest', SELF_ID, SELF_ID)).toBe(true)
  })
})
