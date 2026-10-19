import { describe, it, expect } from 'vitest'
import { assignInspectionIssue } from '$lib/server/inspection'

function fake(staffExists: boolean, updateError = false) {
  const calls: { table: string; patch?: unknown }[] = []
  const client = {
    from(table: string) {
      if (table === 'user_profiles') {
        return { select: () => ({ eq: () => ({ not: () => ({ maybeSingle: async () => ({ data: staffExists ? { id: 'x' } : null }) }) }) }) }
      }
      return {
        update: (patch: unknown) => {
          calls.push({ table, patch })
          const chain: Record<string, unknown> = {}
          const self = () => chain
          Object.assign(chain, { eq: self, is: self, gte: async () => ({ error: updateError ? { message: 'x' } : null }) })
          return chain
        },
      }
    },
  }
  return { client: client as never, calls }
}

describe('assignInspectionIssue — 이슈 담당자 지정', () => {
  it('CMS 직원이면 이번 등록분에 담당자를 기록한다', async () => {
    const f = fake(true)
    expect(await assignInspectionIssue(f.client, 1, 'admin', 'staff', new Date().toISOString())).toBe(true)
    expect(f.calls[0]).toEqual({ table: 'reservation_inspection_issues', patch: { assigned_admin: 'staff' } })
  })
  it('CMS 직원이 아니면 기록하지 않는다', async () => {
    const f = fake(false)
    expect(await assignInspectionIssue(f.client, 1, 'admin', 'nobody', new Date().toISOString())).toBe(false)
    expect(f.calls.length).toBe(0)
  })
  it('기록 오류는 false 로 흡수한다(이슈 등록은 막지 않음)', async () => {
    expect(await assignInspectionIssue(fake(true, true).client, 1, 'admin', 'staff', new Date().toISOString())).toBe(false)
  })
})
