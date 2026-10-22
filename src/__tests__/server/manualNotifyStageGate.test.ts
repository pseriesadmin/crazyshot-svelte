import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 수동 채팅 알림 버튼(2026-10-16): 모든 단계 버튼을 노출하되 해당 단계에서만 활성, 서버도 같은 규칙으로 거절
const panel = readFileSync('src/lib/components/cms/RentalDetailPanel.svelte', 'utf-8')
const server = readFileSync('src/routes/cms/rentals/+page.server.ts', 'utf-8')

const RULES: Record<string, string[]> = {
  shipment_notify: ['confirmed'],
  return_remind: ['in_use', 'return_requested'],
  return_registration: ['return_requested'],
  rental_complete: ['return_requested', 'returned'],
}

describe('수동 알림 단계 규칙', () => {
  for (const [type, statuses] of Object.entries(RULES)) {
    it(`${type}: 화면 버튼·서버 허용 단계가 같다`, () => {
      const list = statuses.map((s) => `'${s}'`).join(', ')
      expect(panel).toMatch(new RegExp(`type: '${type}'[^\\n]*statuses: \\[${list}\\]`))
      expect(server).toMatch(new RegExp(`${type}:\\s*\\[${list}\\]`))
    })
  }
  it('해당 단계가 아닌 버튼은 비활성이고 서버가 현재 상태를 다시 검사한다', () => {
    expect(panel).toContain('disabled={isSubmitting || !stageOk}')
    expect(server).toContain('현재 예약 단계에서 보낼 수 없습니다')
  })
})
