import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * CS 사전 이슈 접수 (3단계, Migration #728)
 *  · 접수: RPC 성공 시에만 고객에게 증빙 요청(채팅카드 버튼=폼 링크, 푸시+문자 링크=폼), 실패하면 알림 없음
 *  · 해제: 알림 없음
 *  · 고객 제출: 성공 시 관리자 푸시, 실패하면 없음
 *  · 표식 부착: 같은 주문 형제 중 하나라도 사전접수면 대표 행에 붙는다
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))

const mockPush = vi.fn()
const mockAdminPush = vi.fn()
vi.mock('$lib/server/push', () => ({
  CUSTOMER_LIFECYCLE_PUSH_COPY: {
    issue_report_request: { title: '증빙', body: (p: string) => `${p} 증빙 요청` },
  },
  sendReservationLifecyclePush: (...a: unknown[]) => mockPush(...a),
  sendPushToAdmins: (...a: unknown[]) => mockAdminPush(...a),
}))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => {} }))

import { cancelPriorIssue, issueReportPath, registerPriorIssue, submitPriorIssueReport } from '$lib/server/priorIssue'
import { attachPriorIssue } from '$lib/server/attachPriorIssue'
import { isIssueReportToken, PRIOR_ISSUE_KINDS, validatePriorReportInput } from '$lib/utils/inspection'

const TOKEN = 'a'.repeat(64)

function makeAdmin(rpcImpl: (fn: string) => unknown) {
  const rpc = vi.fn(async (fn: string) => rpcImpl(fn))
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: { products: { name: 'SONY FX3' } } })
  return { rpc, from: () => chain }
}

beforeEach(() => {
  mockPush.mockReset()
  mockAdminPush.mockReset()
})

describe('registerPriorIssue', () => {
  it('성공: 카드(버튼=증빙 폼 링크) + 푸시·문자(링크=폼, 같은 날 재요청도 발송)', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, token: TOKEN, reused: false }, error: null }))
    const r = await registerPriorIssue(admin, 7, 'admin-1')
    expect(r).toEqual({ ok: true, token: TOKEN, reused: false })
    expect(admin.rpc).toHaveBeenCalledWith('send_return_notice_card', expect.objectContaining({
      p_reservation_id: 7,
      p_notify_type: 'issue_report_request',
      p_content: 'SONY FX3 증빙 요청',
      p_action_url: `/issue-report/${TOKEN}`,
    }))
    expect(mockPush).toHaveBeenCalledWith(admin, 7, 'issue_report_request', { smsLink: `/issue-report/${TOKEN}`, forceSms: true })
  })

  it('실패(반납완료 후 등): 오류를 돌려주고 알림은 없다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '이미 반납완료된 예약이에요.' }, error: null }))
    const r = await registerPriorIssue(admin, 7, 'admin-1')
    expect(r).toEqual({ ok: false, error: '이미 반납완료된 예약이에요.' })
    expect(mockPush).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalledWith('send_return_notice_card', expect.anything())
  })

  it('폼 경로', () => {
    expect(issueReportPath(TOKEN)).toBe(`/issue-report/${TOKEN}`)
  })
})

describe('cancelPriorIssue', () => {
  it('해제는 고객 알림을 보내지 않는다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true }, error: null }))
    expect((await cancelPriorIssue(admin, 7, 'admin-1')).ok).toBe(true)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('submitPriorIssueReport', () => {
  const input = { types: ['damage'], detail: '렌즈 파손', media: [] }

  it('성공하면 관리자에게 푸시', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, reservation_id: 7 }, error: null }))
    expect((await submitPriorIssueReport(admin, TOKEN, input)).ok).toBe(true)
    expect(mockAdminPush).toHaveBeenCalledTimes(1)
    expect(mockAdminPush.mock.calls[0][1]).toMatchObject({ link: '/cms/rentals?selected=7' })
  })

  it("상담채팅에 'CS 등록완료' 카드를 보내고(유형·첨부·내용 요약), 관리자 푸시에도 같은 요약을 싣는다", async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, reservation_id: 7 }, error: null }))
    await submitPriorIssueReport(admin, TOKEN, { types: ['damage', 'lost'], detail: '메모리를 분실했어요.', media: [{ path: '7/prior/a.jpg', kind: 'photo' }] })
    const card = (admin.rpc.mock.calls as unknown[][]).find((c) => c[0] === 'send_return_notice_card')?.[1] as { p_notify_type: string; p_content: string; p_reservation_id: number }
    expect(card.p_reservation_id).toBe(7)
    expect(card.p_notify_type).toBe('issue_report_submitted')
    expect(card.p_content).toContain('CS 등록완료')
    expect(card.p_content).toContain('첨부: 사진·영상 1건')
    expect(card.p_content).toContain('메모리를 분실했어요.')
    const push = mockAdminPush.mock.calls[0][1] as { title: string; body: string }
    expect(push.title).toContain('CS 접수 등록 완료')
    expect(push.body).toContain('첨부 1건')
    expect(push.body).toContain('메모리를 분실했어요.')
  })

  it('실패 제출은 카드도 보내지 않는다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '만료' }, error: null }))
    await submitPriorIssueReport(admin, TOKEN, input)
    expect(admin.rpc).not.toHaveBeenCalledWith('send_return_notice_card', expect.anything())
  })

  it('만료·잘못된 링크면 실패하고 푸시도 없다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '만료되었거나 취소된 요청이에요.' }, error: null }))
    const r = await submitPriorIssueReport(admin, TOKEN, input)
    expect(r.ok).toBe(false)
    expect(mockAdminPush).not.toHaveBeenCalled()
  })
})

describe('고객 제출 검증·토큰 형식', () => {
  const owns = (p: string) => /^7\/prior\/[0-9a-f-]{36}\.jpg$/.test(p)
  const UUID = '123e4567-e89b-12d3-a456-426614174000'

  it('유형 3종(장비 이상·파손·분실)만 인정, 비면 거절', () => {
    expect(PRIOR_ISSUE_KINDS.map((k) => k.key)).toEqual(['malfunction', 'damage', 'lost'])
    expect(validatePriorReportInput({ types: [] }, owns).ok).toBe(false)
    expect(validatePriorReportInput({ types: ['weird'] }, owns).ok).toBe(false)
    const ok = validatePriorReportInput({ types: ['damage', 'damage'], detail: ' 렌즈 ' }, owns)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value).toEqual({ types: ['damage'], detail: '렌즈', media: [] })
  })

  it('다른 예약·다른 폴더 경로는 거절', () => {
    expect(validatePriorReportInput({ types: ['lost'], media: [{ path: `7/prior/${UUID}.jpg`, kind: 'photo' }] }, owns).ok).toBe(true)
    expect(validatePriorReportInput({ types: ['lost'], media: [{ path: `8/prior/${UUID}.jpg`, kind: 'photo' }] }, owns).ok).toBe(false)
    expect(validatePriorReportInput({ types: ['lost'], media: [{ path: `7/issue/${UUID}.jpg`, kind: 'photo' }] }, owns).ok).toBe(false)
  })

  it('토큰은 64자 16진수만', () => {
    expect(isIssueReportToken(TOKEN)).toBe(true)
    expect(isIssueReportToken('abc')).toBe(false)
    expect(isIssueReportToken('G'.repeat(64))).toBe(false)
  })
})

describe('attachPriorIssue', () => {
  function adminFor(tables: Record<string, unknown[]>) {
    return {
      from(table: string) {
        const rows = tables[table] ?? []
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.in = () => chain
        chain.eq = () => chain
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
        return chain
      },
    }
  }

  it('같은 주문 형제 중 하나라도 사전접수면 대표 행에 표식이 붙는다', async () => {
    const admin = adminFor({
      order_items: [{ order_id: 1, reservation_id: 10 }, { order_id: 1, reservation_id: 11 }],
      rental_reservations: [{ id: 11 }],
    })
    const rows: { reservation_id: number; prior_issue?: boolean }[] = [{ reservation_id: 10 }, { reservation_id: 99 }]
    await attachPriorIssue(admin as never, rows)
    expect(rows[0].prior_issue).toBe(true)
    expect(rows[1].prior_issue).toBeUndefined()
  })
})
