import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * /api/chat/messages/[id]/execute-action — 접근제어 회귀 테스트
 * (2026-09-08, Stephen 리포트: "전자계약 대화카드 선택 시 '기한만료' 전환 오류")
 *
 * 배경: isParticipant 체크가 "고객 본인" 또는 "그 세션에 배정된 admin_id 1명"만 허용하고
 * 있어, 계약을 발행한 관리자 본인이 아닌 다른 CMS 관리자가 같은 카드를 클릭하면 403이
 * 발생 → ActionCard.svelte가 이를 "기한 만료"로 오표시하던 실사용 결함으로 이어졌다.
 * getCmsRoleForAction()으로 cms_role 보유자는 admin_id 배정 여부와 무관하게 허용하도록
 * 수정(RSV) — 이 테스트는 그 수정을 고정한다.
 *
 * EC-1: 배정 안 된 다른 CMS 관리자 → 200 (이번 회귀의 핵심 재현 케이스)
 * EC-2: 무관한 일반 로그인 사용자(고객도 배정admin도 cms_role도 아님) → 403 (여전히 차단)
 * + 기존 정상 경로(고객 본인·배정 admin) 무회귀 + 비로그인 401 + 진짜 만료 410
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))

const mockGetCmsRoleForAction = vi.fn()
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: (...args: unknown[]) => mockGetCmsRoleForAction(...args),
}))

const { POST } = await import('../../routes/api/chat/messages/[id]/execute-action/+server')

const MESSAGE_ID = 'msg-1'
const SESSION_ID = 'session-1'
const CUSTOMER_ID = 'customer-uid'
const ASSIGNED_ADMIN_ID = 'assigned-admin-uid'
const OTHER_ADMIN_ID = 'other-admin-uid'
const RANDOM_USER_ID = 'random-uid'

type TableResult = { data: unknown; error?: unknown }

function makeChain(result: TableResult) {
  // select/eq는 체이닝만 하고 maybeSingle에서 최종 결과를 반환 — 이 엔드포인트가 실제로
  // 쓰는 메서드만 최소로 스텁한다(경량 테스트 취지).
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  return chain
}

function makeLocalsSupabase(tables: Record<string, TableResult>) {
  return {
    from: vi.fn((table: string) => makeChain(tables[table] ?? { data: null, error: null })),
  }
}

function makeEvent(opts: {
  userId?: string | null
  cmsRole?: string | null
  sessionUserId?: string
  sessionAdminId?: string | null
  actionPayload?: Record<string, unknown> | null
  messageFound?: boolean
  sessionFound?: boolean
  rentalReservationStatus?: string | null
  contractHasContent?: boolean | null
}) {
  const {
    userId = RANDOM_USER_ID,
    cmsRole = null,
    sessionUserId = CUSTOMER_ID,
    sessionAdminId = ASSIGNED_ADMIN_ID,
    actionPayload = { type: 'PRODUCT_CARD', action_url: '/products/x' },
    messageFound = true,
    sessionFound = true,
    rentalReservationStatus = null,
    contractHasContent = null,
  } = opts

  mockGetCmsRoleForAction.mockResolvedValue(cmsRole)

  const tables: Record<string, TableResult> = {
    chat_messages: messageFound
      ? {
          data: {
            id: MESSAGE_ID,
            session_id: SESSION_ID,
            message_type: 'action_card',
            action_payload: actionPayload,
          },
        }
      : { data: null },
    chat_sessions: sessionFound
      ? { data: { user_id: sessionUserId, admin_id: sessionAdminId } }
      : { data: null },
    rental_reservations: rentalReservationStatus
      ? { data: { status: rentalReservationStatus } }
      : { data: null },
    contracts: contractHasContent == null
      ? { data: null }
      : {
          data: contractHasContent
            ? { content_blocks: [{ type: 'p' }], canvas_document: null, spreadsheet_document: null, html_document: null }
            : { content_blocks: [], canvas_document: null, spreadsheet_document: null, html_document: null },
        },
  }

  return {
    params: { id: MESSAGE_ID },
    locals: {
      safeGetSession: vi.fn().mockResolvedValue(
        userId ? { session: { user: { id: userId } } } : { session: null },
      ),
      supabase: makeLocalsSupabase(tables),
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('/api/chat/messages/[id]/execute-action — 접근제어', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('비로그인 → 401', async () => {
    const result = (await POST(makeEvent({ userId: null }))) as unknown as { status: number }
    expect(result.status).toBe(401)
  })

  it('고객 본인 → 200 (기존 정상 경로, 무회귀)', async () => {
    const result = (await POST(
      makeEvent({ userId: CUSTOMER_ID, sessionUserId: CUSTOMER_ID }),
    )) as unknown as { status: number }
    expect(result.status).toBe(200)
  })

  it('세션에 배정된 admin → 200 (기존 정상 경로, 무회귀)', async () => {
    const result = (await POST(
      makeEvent({ userId: ASSIGNED_ADMIN_ID, sessionAdminId: ASSIGNED_ADMIN_ID }),
    )) as unknown as { status: number }
    expect(result.status).toBe(200)
  })

  it('RED → GREEN: 배정 안 된 다른 CMS 관리자(cms_role 보유) → 200 (이번에 고친 회귀 케이스)', async () => {
    const result = (await POST(
      makeEvent({
        userId: OTHER_ADMIN_ID,
        cmsRole: 'manager',
        sessionUserId: CUSTOMER_ID,
        sessionAdminId: ASSIGNED_ADMIN_ID,
      }),
    )) as unknown as { status: number }
    expect(result.status).toBe(200)
  })

  it('무관한 일반 로그인 사용자(고객도 배정admin도 cms_role도 아님) → 403 (여전히 차단돼야 함)', async () => {
    const result = (await POST(
      makeEvent({
        userId: RANDOM_USER_ID,
        cmsRole: null,
        sessionUserId: CUSTOMER_ID,
        sessionAdminId: ASSIGNED_ADMIN_ID,
      }),
    )) as unknown as { status: number }
    expect(result.status).toBe(403)
  })

  it('진짜 만료(is_expired 플래그) → 410, code=expired (권한 통과 후에도 만료 판정은 그대로 동작)', async () => {
    const result = (await POST(
      makeEvent({
        userId: CUSTOMER_ID,
        sessionUserId: CUSTOMER_ID,
        actionPayload: { type: 'PAYMENT_REQUEST_CARD', is_expired: true },
      }),
    )) as unknown as { status: number; data: { code?: string } }
    expect(result.status).toBe(410)
    expect(result.data.code).toBe('expired')
  })

  it('RED → GREEN(QA 관찰사항 수정): reservation_hold + 예약상태=cancelled → 410, code=cancelled (예전엔 항상 code="expired"로 고정 반환돼 "취소됨"과 "기한 만료"를 구분할 수 없었음)', async () => {
    const result = (await POST(
      makeEvent({
        userId: CUSTOMER_ID,
        sessionUserId: CUSTOMER_ID,
        actionPayload: { type: 'reservation_hold', reservation_id: 123 },
        rentalReservationStatus: 'cancelled',
      }),
    )) as unknown as { status: number; data: { code?: string; error?: string } }
    expect(result.status).toBe(410)
    expect(result.data.code).toBe('cancelled')
    expect(result.data.error).toBe('취소된 예약입니다.')
  })

  it('reservation_hold + 예약상태=expired → 410, code=expired (기존 동작 무회귀)', async () => {
    const result = (await POST(
      makeEvent({
        userId: CUSTOMER_ID,
        sessionUserId: CUSTOMER_ID,
        actionPayload: { type: 'reservation_hold', reservation_id: 123 },
        rentalReservationStatus: 'expired',
      }),
    )) as unknown as { status: number; data: { code?: string } }
    expect(result.status).toBe(410)
    expect(result.data.code).toBe('expired')
  })

  it('reservation_hold + 예약상태=hold(진행중) → 200 (여전히 유효한 액션)', async () => {
    const result = (await POST(
      makeEvent({
        userId: CUSTOMER_ID,
        sessionUserId: CUSTOMER_ID,
        actionPayload: { type: 'reservation_hold', reservation_id: 123 },
        rentalReservationStatus: 'hold',
      }),
    )) as unknown as { status: number }
    expect(result.status).toBe(200)
  })

  it('RED → GREEN(계약카드 라벨 정정): contract_link + 콘텐츠 없음(발행취소됨) → 410, code=cancelled (예전엔 code="expired"로 고정 반환돼 "기한 만료"로 오표시됐음)', async () => {
    const result = (await POST(
      makeEvent({
        userId: CUSTOMER_ID,
        sessionUserId: CUSTOMER_ID,
        actionPayload: { type: 'contract_link', contract_id: 'contract-1' },
        contractHasContent: false,
      }),
    )) as unknown as { status: number; data: { code?: string; error?: string } }
    expect(result.status).toBe(410)
    expect(result.data.code).toBe('cancelled')
    expect(result.data.error).toBe('발행이 취소된 계약입니다.')
  })

  it('contract_signed + 콘텐츠 있음 → 200 (기존 동작 무회귀)', async () => {
    const result = (await POST(
      makeEvent({
        userId: CUSTOMER_ID,
        sessionUserId: CUSTOMER_ID,
        actionPayload: { type: 'contract_signed', contract_id: 'contract-1' },
        contractHasContent: true,
      }),
    )) as unknown as { status: number }
    expect(result.status).toBe(200)
  })
})
