import { describe, it, expect } from 'vitest'
import { attachReturnStage, RETURN_STAGE_RANK } from '$lib/server/attachReturnStage'

function fakeAdmin(subs: number[], logs: number[]) {
  return {
    from(table: string) {
      const ids = table === 'reservation_return_submissions' ? subs : logs
      return { select: () => ({ in: async () => ({ data: ids.map((reservation_id) => ({ reservation_id })), error: null }) }) }
    },
  } as never
}

describe('attachReturnStage — 반납중 칩 배지', () => {
  it('제출 있음=registered, 대여중+알림 기록=notice_sent, 대여중+기록 없음=notice_due', async () => {
    const rows = [
      { reservation_id: 1, status: 'return_requested' },
      { reservation_id: 2, status: 'in_use' },
      { reservation_id: 3, status: 'in_use' },
      { reservation_id: 4, status: 'confirmed' },
    ] as { reservation_id: number; status: string; return_stage?: string }[]
    await attachReturnStage(fakeAdmin([1], [2]), rows as never)
    expect(rows.map((r) => r.return_stage)).toEqual(['registered', 'notice_sent', 'notice_due', undefined])
  })
  it('정렬 순위: 예정 → 발송 → 등록', () => {
    expect(RETURN_STAGE_RANK.notice_due).toBeLessThan(RETURN_STAGE_RANK.notice_sent)
    expect(RETURN_STAGE_RANK.notice_sent).toBeLessThan(RETURN_STAGE_RANK.registered)
  })
})
