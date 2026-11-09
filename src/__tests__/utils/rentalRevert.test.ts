import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { revertTarget, revertLabel, normalizeRevertReason } from '$lib/utils/rentalRevert'

const read = (p: string): string => readFileSync(p, 'utf8')

describe('revertTarget — 되돌리기 허용표', () => {
  it('반납중은 대여중으로', () => {
    expect(revertTarget('return_requested', 'visit')).toBe('in_use')
    expect(revertTarget('return_requested', 'delivery')).toBe('in_use')
  })
  it('대여중: 방문 수령은 계약완료, 그 외는 반출중', () => {
    expect(revertTarget('in_use', 'visit')).toBe('confirmed')
    expect(revertTarget('in_use', 'delivery')).toBe('shipped')
    expect(revertTarget('in_use', null)).toBe('shipped')
  })
  it('반출중(shipped)은 되돌리지 않는다 — Stephen 제외 지시', () => {
    expect(revertTarget('shipped', 'delivery')).toBeNull()
  })
  it('반납완료 이후·예약 단계·종료 상태는 대상 아님', () => {
    for (const s of ['confirmed', 'returned', 'completed', 'cancelled', 'expired', 'damage_claimed', 'hold', 'pending']) {
      expect(revertTarget(s, 'visit')).toBeNull()
    }
  })
  it('버튼 이름이 목적지와 맞다', () => {
    expect(revertLabel('return_requested')).toBe('대여중 되돌림')
    expect(revertLabel('in_use', 'delivery')).toBe('반출중으로 되돌리기')
    expect(revertLabel('in_use', 'visit')).toBe('계약완료 되돌림')
    expect(revertLabel('shipped')).toBe('')
  })
})

describe('normalizeRevertReason', () => {
  it('공백 제거, 2~200자만 통과', () => {
    expect(normalizeRevertReason('  오조작  ')).toBe('오조작')
    expect(normalizeRevertReason('가')).toBeNull()
    expect(normalizeRevertReason('   ')).toBeNull()
    expect(normalizeRevertReason('가'.repeat(201))).toBeNull()
    expect(normalizeRevertReason(undefined)).toBeNull()
  })
})

describe('마이그레이션 #799 — 소스 점검', () => {
  const sql = read('supabase/migrations/20261108120000_799_revert_reservation_status.sql')
  it('서버 전용 권한(service_role만)', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.revert_reservation_status\(bigint, text, uuid, text\) FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.revert_reservation_status\(bigint, text, uuid, text\) TO service_role/)
  })
  it('차단 4종과 행 잠금·기대 상태 대조가 있다', () => {
    expect(sql).toMatch(/FOR UPDATE/)
    expect(sql).toMatch(/p_expected_status/)
    expect(sql).toMatch(/late_fees/)
    expect(sql).toMatch(/reservation_inspection_issues/)
    expect(sql).toMatch(/dhero_return_book_id/)
  })
  it('반출중(shipped)에서 되돌리는 분기가 없다', () => {
    expect(sql).not.toMatch(/WHEN 'shipped'\s+THEN/)
  })
  it('감사로그 허용값에 status_revert 추가, 기존 late_fee_confirm 유지', () => {
    expect(sql).toMatch(/'late_fee_confirm','status_revert'/)
  })
})

describe('서버 액션·패널 배선 — 소스 점검', () => {
  const server = read('src/routes/cms/reservation/+page.server.ts')
  const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
  it('revertStatus 액션: 매니저 이상 + 되돌리기 RPC + 감사로그', () => {
    const i = server.indexOf('revertStatus: async')
    expect(i).toBeGreaterThan(-1)
    const body = server.slice(i, i + 4500)
    expect(body).toMatch(/hasSettingsAccess\(cmsRole\)/)
    expect(body).toMatch(/revert_reservation_status/)
    expect(body).toMatch(/status_revert/)
    expect(body).not.toMatch(/send_rental_chat_notification|sendReservationLifecyclePush/)
  })
  it('패널: 대여현황 화면 + 매니저 이상에게만 되돌리기 버튼', () => {
    expect(panel).toMatch(/\/cms\/reservation\?\/revertStatus/)
    expect(panel).toMatch(/canManagePaymentAndLocker && isRentalView && revertTarget\(/)
  })
})
