import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// CMS 홈(/cms) 대여정보 모달의 '무인보관함 배정정보' 확인·입력 UI 는 패널이 cmsRole(매니저 이상)을 받아야 보인다.
// 홈 → 탭 → 간트 → 패널로 역할이 끊기지 않고 전달되는지 소스로 점검한다.
const read = (p: string): string => readFileSync(p, 'utf8')

describe('CMS 홈 간트 모달 — 무인보관함 UI 역할 전달', () => {
  it('탭이 간트에 cmsRole 을 넘긴다', () => {
    expect(read('src/lib/components/cms/dashboard/CmsDashboardTabs.svelte')).toMatch(/<CmsDashboardGantt[^>]*cmsRole=\{data\.cmsRole\}/)
  })
  it('간트가 RentalDetailPanel 에 cmsRole 을 넘긴다', () => {
    const src = read('src/lib/components/cms/dashboard/CmsDashboardGantt.svelte')
    expect(src).toMatch(/cmsRole\?: string \| null/)
    expect(src).toMatch(/<RentalDetailPanel[^>]*\{cmsRole\}/s)
  })
  it('홈 서버 로더가 cmsRole 을 내려준다', () => {
    expect(read('src/routes/cms/+page.server.ts')).toMatch(/\bcmsRole,/)
  })
})
