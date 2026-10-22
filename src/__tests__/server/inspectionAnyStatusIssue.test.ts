import { describe, it, expect, vi, beforeEach } from 'vitest'

// 검수 탭 상시 노출(2026-10-22): 이슈 등록은 예약 상태와 무관하게 가능 — 반납 전은 사전 접수+기록, 종료·예약 단계는 기록만.
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))
vi.mock('$lib/server/awardRentalCompletePoints', () => ({ awardRentalCompletePoints: vi.fn() }))
vi.mock('$lib/server/awardOnTimeReturnPoints', () => ({ awardOnTimeReturnPoints: vi.fn() }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => {} }))
const mockPrior = vi.fn()
vi.mock('$lib/server/priorIssue', () => ({ registerPriorIssue: (...a: unknown[]) => mockPrior(...a) }))
vi.mock('$lib/server/push', () => ({
  CUSTOMER_LIFECYCLE_PUSH_COPY: {},
  sendReservationLifecyclePush: vi.fn(),
  sendPushToAdmins: vi.fn(),
}))

import { registerInspectionIssue } from '$lib/server/inspection'

function admin(status: string, insertError = false) {
  const inserted: unknown[] = []
  const rpc = vi.fn(async () => ({ data: { ok: true, first: true }, error: null }))
  const client = {
    from(table: string) {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { status } }),
        insert: async (row: unknown) => { inserted.push({ table, row }); return { error: insertError ? { message: 'x' } : null } },
      })
      return q
    },
    rpc,
  }
  return { client: client as never, inserted, rpc }
}
const input = { types: ['exterior_damage'], detail: '메모', media: [] }

beforeEach(() => { mockPrior.mockReset(); mockPrior.mockResolvedValue({ ok: true }) })

describe('registerInspectionIssue — 상태 무관 이슈 등록', () => {
  it('대여중(반납 전): 사전 접수 + 이슈 기록, 검수 RPC 는 부르지 않는다', async () => {
    const a = admin('in_use')
    expect((await registerInspectionIssue(a.client, 5, 'adm', input)).ok).toBe(true)
    expect(mockPrior).toHaveBeenCalledTimes(1)
    expect(a.inserted.length).toBe(1)
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it('완료·취소 등: 이슈 기록만 남기고 사전 접수·RPC 는 없다', async () => {
    const a = admin('completed')
    expect((await registerInspectionIssue(a.client, 5, 'adm', input)).ok).toBe(true)
    expect(mockPrior).not.toHaveBeenCalled()
    expect(a.inserted.length).toBe(1)
    expect(a.rpc).not.toHaveBeenCalled()
  })
  it('반납완료: 기존 검수 이슈 RPC 를 쓴다(기록 직삽입 없음)', async () => {
    const a = admin('returned')
    expect((await registerInspectionIssue(a.client, 5, 'adm', input)).ok).toBe(true)
    expect(a.rpc).toHaveBeenCalledWith('register_return_inspection_issue', expect.anything())
    expect(a.inserted.length).toBe(0)
  })
  it('사전 접수 실패 시 이슈를 기록하지 않고 실패를 돌려준다', async () => {
    mockPrior.mockResolvedValue({ ok: false, error: '실패' })
    const a = admin('confirmed')
    expect((await registerInspectionIssue(a.client, 5, 'adm', input)).ok).toBe(false)
    expect(a.inserted.length).toBe(0)
  })
})

import { validateIssueInput, INSPECTION_ISSUE_TITLE_MAX } from '$lib/utils/inspection'
describe('CS 접수 입력 규칙(2026-10-22)', () => {
  const ok = () => true
  it("'기타' 유형을 받는다", () => {
    expect(validateIssueInput({ types: ['etc'], detail: '' }, ok).ok).toBe(true)
  })
  it('내용(목록 카드 제목)은 100자 이하만 받는다', () => {
    expect(INSPECTION_ISSUE_TITLE_MAX).toBe(100)
    expect(validateIssueInput({ types: ['etc'], detail: 'a'.repeat(100) }, ok).ok).toBe(true)
    expect(validateIssueInput({ types: ['etc'], detail: 'a'.repeat(101) }, ok).ok).toBe(false)
  })
})
