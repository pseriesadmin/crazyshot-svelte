import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 대여현황 실시간 새로고침이 칩·필터·페이지 이동을 취소해 칩이 눌리지 않던 문제(2026-11-12) — 소스 점검
const page = readFileSync('src/routes/cms/rentals/+page.svelte', 'utf-8')

describe('/cms/rentals 실시간 새로고침과 사용자 이동', () => {
  it('실시간 변경 이벤트는 모아서(디바운스) 한 번만 새로고침한다', () => {
    expect(page).toContain('refreshTimer = setTimeout(runRefresh, 600)')
    expect(page).toContain('if (refreshTimer) clearTimeout(refreshTimer)')
  })
  it('사용자 이동 중에는 새로고침을 미룬다', () => {
    expect(page).toContain('if (userNavPending) { refreshTimer = setTimeout(runRefresh, 500); return }')
  })
  it('칩·필터·페이지 이동이 모두 userGoto 를 거친다', () => {
    expect(page).toMatch(/function applyFilters[\s\S]*?userGoto\(/)
    expect(page).toMatch(/function setStatus[\s\S]*?userGoto\(/)
    expect(page).toMatch(/function goPage[\s\S]*?userGoto\(/)
  })
})
