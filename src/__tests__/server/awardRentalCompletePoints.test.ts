import { describe, it, expect, vi } from 'vitest'

/**
 * 대여완료(rental_complete) 포인트 자동적립 — 공용 헬퍼 단위 테스트
 * Harness Flow v3.2 — TDD
 *
 * 대상: src/lib/server/awardRentalCompletePoints.ts
 *
 * 케이스:
 *   EC-1: award_rental_complete_points RPC를 올바른 파라미터로 호출
 *   EC-2: RPC 실패(reject)해도 예외를 던지지 않음(fail-soft) — 메인 상태전이 흐름 보호
 */

const { awardRentalCompletePoints } = await import('$lib/server/awardRentalCompletePoints')

describe('awardRentalCompletePoints — 공용 헬퍼', () => {
  it('EC-1: award_rental_complete_points RPC를 예약ID와 함께 호출', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }) }

    await awardRentalCompletePoints(admin, 2001)

    expect(admin.rpc).toHaveBeenCalledWith('award_rental_complete_points', {
      p_reservation_id: 2001,
    })
  })

  it('EC-2: RPC가 reject되어도 예외를 던지지 않음(fail-soft)', async () => {
    const admin = { rpc: vi.fn().mockRejectedValue(new Error('DB 연결 오류')) }

    await expect(awardRentalCompletePoints(admin, 2002)).resolves.toBeUndefined()
  })
})
