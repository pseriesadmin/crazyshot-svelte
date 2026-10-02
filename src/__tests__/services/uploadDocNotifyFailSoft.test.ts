import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * POST /api/profile/upload-doc — 관리자 검토요청 알림카드 fail-soft 회귀 테스트 (Migration #526)
 *
 * 완료기준(B-START):
 *   정상동작: update_user_doc_url RPC 성공 후 identity_review_request 알림카드를 시도한다.
 *   막아야할것: 알림카드 발송(find_or_create_general_chat_session RPC)이 실패/예외를 던져도
 *              업로드 자체의 성공 응답(ok:true)에는 전혀 영향을 주지 않는다(non-blocking).
 *
 * 2026-10-02 추가(Migration #631): 카드와 관리자 푸시(sendPushToAdmins 'identity_review')는
 *   "필수 파일 조합"을 모두 갖춘 등록 완료 시에만 함께 발송된다(docApproval.ts 정본) —
 *   일부만 등록한 중간 상태에서는 카드도 푸시도 보내지 않는다. 카드·푸시는 서로 독립(fail-soft).
 */

vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}))

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://example.supabase.co',
}))

vi.mock('$lib/utils/fileValidation', () => ({
  UPLOAD_ACCEPTED_TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/heif', 'image/heic', 'application/pdf'],
  getMimeExtension: () => 'png',
}))

const mockSendPushToAdmins = vi.fn(async () => undefined)
vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: (...args: unknown[]) => (mockSendPushToAdmins as (...a: unknown[]) => unknown)(...args),
}))

const mockCallTypedRpc = vi.fn()
vi.mock('$lib/utils/rpc', () => ({
  callTypedRpc: (...args: unknown[]) => mockCallTypedRpc(...args),
}))

function makeFromChain() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update']) chain[m] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
  return chain
}

const mockRpc = vi.fn()
const mockFrom = vi.fn((_table?: string) => makeFromChain())
const mockUpload = vi.fn(async () => ({ error: null }))
const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.supabase.co/storage/v1/object/public/user-documents/u/identity_x.png' } }))
const mockRemove = vi.fn(async () => ({ error: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    storage: {
      from: () => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl, remove: mockRemove }),
    },
    rpc: mockRpc,
  }),
}))

const { POST } = await import('../../routes/api/profile/upload-doc/+server')

function makeEvent(opts: { type?: 'identity' | 'foreign'; types?: string[]; merge?: boolean } = {}) {
  const type = opts.type ?? 'identity'
  // 기본값: 본인증명 필수 조합(주민등록증 + 주민등록등본)을 모두 갖춘 제출
  const types = opts.types ?? (type === 'identity' ? ['resident', 'resident_copy'] : ['passport_photo', 'accommodation_reservation'])
  const form = new FormData()
  form.append('type', type)
  if (opts.merge) form.append('merge', 'true')
  for (const t of types) {
    form.append('file', new File([new Uint8Array([1, 2, 3])], `${t}.png`, { type: 'image/png' }))
    form.append(type === 'identity' ? 'identity_type' : 'foreign_type', t)
  }

  return {
    request: { formData: async () => form },
    locals: {
      safeGetSession: async () => ({ session: { user: { id: 'test-user-id' } } }),
      supabase: {}, // callTypedRpc는 모킹되므로 실제 클라이언트 형태는 무관
    },
  } as unknown as Parameters<typeof POST>[0]
}

describe('POST /api/profile/upload-doc — identity_review_request 알림 fail-soft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation(() => makeFromChain())
    mockCallTypedRpc.mockResolvedValue({ data: { ok: true }, error: null })
  })

  it('알림카드 세션조회 RPC가 예외를 던져도 업로드 응답은 ok:true 그대로 유지된다', async () => {
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'find_or_create_general_chat_session') {
        throw new Error('세션조회 실패(시뮬레이션)')
      }
      return { data: null, error: null }
    })

    const result = (await POST(makeEvent())) as unknown as { status: number; data: { ok: boolean } }

    expect(result.status).toBe(200)
    expect(result.data.ok).toBe(true)
    expect(mockRpc).toHaveBeenCalledWith(
      'find_or_create_general_chat_session',
      expect.objectContaining({ p_user_id: 'test-user-id', p_reservation_id: null }),
    )
  })

  it('세션조회는 성공하지만 카드 INSERT가 실패해도 업로드 응답은 ok:true 그대로 유지된다', async () => {
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'find_or_create_general_chat_session') return { data: 'chat-session-id', error: null }
      return { data: null, error: null }
    })
    // chat_messages.insert()가 실패하도록 from()의 .insert 체인만 별도로 에러 반환
    mockFrom.mockImplementation((table?: string) => {
      const chain = makeFromChain()
      if (table === 'chat_messages') {
        chain.insert = vi.fn(async () => ({ data: null, error: { message: 'insert failed' } }))
      }
      return chain
    })

    const result = (await POST(makeEvent())) as unknown as { status: number; data: { ok: boolean } }

    expect(result.status).toBe(200)
    expect(result.data.ok).toBe(true)
  })

  it('update_user_doc_url RPC 자체가 실패하면(핵심 업로드 실패) ok:false를 반환한다 — fail-soft 대상이 아님', async () => {
    mockCallTypedRpc.mockResolvedValue({ data: { ok: false }, error: null })

    const result = (await POST(makeEvent())) as unknown as { status: number; data: { ok: boolean } }

    expect(result.status).toBe(500)
    expect(result.data.ok).toBe(false)
    // 핵심 RPC 실패 시 알림 로직에 도달하기 전에 반환되므로 find_or_create_general_chat_session은 호출되지 않는다
    expect(mockRpc).not.toHaveBeenCalledWith(
      'find_or_create_general_chat_session',
      expect.anything(),
    )
  })
})

describe('POST /api/profile/upload-doc — 필수 조합 완료 시에만 카드 + 관리자 푸시', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation(() => makeFromChain())
    mockCallTypedRpc.mockResolvedValue({ data: { ok: true }, error: null })
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'find_or_create_general_chat_session') return { data: 'chat-session-id', error: null }
      return { data: null, error: null }
    })
  })

  const sessionCalled = () => mockRpc.mock.calls.some((c) => c[0] === 'find_or_create_general_chat_session')

  it('본인증명 필수 조합 완료 → 카드 세션조회 + 관리자 푸시(identity_review, 고객 딥링크) 발송', async () => {
    const result = (await POST(makeEvent())) as unknown as { status: number; data: { ok: boolean } }
    expect(result.data.ok).toBe(true)
    expect(sessionCalled()).toBe(true)
    expect(mockSendPushToAdmins).toHaveBeenCalledTimes(1)
    expect(mockSendPushToAdmins).toHaveBeenCalledWith(
      'identity_review',
      expect.objectContaining({ link: '/cms/customers?selected=test-user-id' }),
    )
  })

  it('본인증명 일부만(주민등록증만, 등본 누락) → 카드도 푸시도 보내지 않는다', async () => {
    const result = (await POST(makeEvent({ types: ['resident'] }))) as unknown as { data: { ok: boolean } }
    expect(result.data.ok).toBe(true)
    expect(sessionCalled()).toBe(false)
    expect(mockSendPushToAdmins).not.toHaveBeenCalled()
  })

  it('운전면허증 + 주민등록등본도 필수 조합 충족 → 발송', async () => {
    await POST(makeEvent({ types: ['driver', 'resident_copy'] }))
    expect(mockSendPushToAdmins).toHaveBeenCalledTimes(1)
  })

  it('외국인증명: 4종 미만(여권만 / 여권+숙소예약 2종)은 필수 조합을 갖춰도 미발송 — #495 규칙(4종 완료 시에만 등록완료)과 동일 시점', async () => {
    await POST(makeEvent({ type: 'foreign', types: ['passport_photo'] }))
    await POST(makeEvent({ type: 'foreign', types: ['passport_photo', 'accommodation_reservation'] }))
    expect(mockSendPushToAdmins).not.toHaveBeenCalled()
    expect(sessionCalled()).toBe(false)
  })

  it('외국인증명: 단기체류 4종 / 장기체류 4종 모두 등록 → 발송', async () => {
    await POST(makeEvent({ type: 'foreign', types: ['passport_photo', 'accommodation_reservation', 'entry_eticket', 'exit_eticket'] }))
    expect(mockSendPushToAdmins).toHaveBeenCalledTimes(1)

    await POST(makeEvent({ type: 'foreign', types: ['arc_front', 'arc_back', 'passport_photo', 'foreign_fact_cert'] }))
    expect(mockSendPushToAdmins).toHaveBeenCalledTimes(2)
  })

  it('병합(merge) 모드: 기존 주민등록증 + 이번에 주민등록등본 추가 → 합쳐서 필수 조합 완성 → 발송', async () => {
    mockFrom.mockImplementation(() => {
      const chain = makeFromChain()
      chain.maybeSingle = vi.fn(async () => ({
        data: { identity_doc_url: ['https://example.supabase.co/storage/v1/object/public/user-documents/test-user-id/old.png'], identity_type: ['resident'], full_name: '홍길동' },
        error: null,
      }))
      return chain
    })
    await POST(makeEvent({ merge: true, types: ['resident_copy'] }))
    expect(mockSendPushToAdmins).toHaveBeenCalledTimes(1)
  })

  it('병합(merge) 모드: 기존 주민등록증 + 이번에 운전면허증 추가(등본 없음) → 필수 조합 미완성 → 미발송', async () => {
    mockFrom.mockImplementation(() => {
      const chain = makeFromChain()
      chain.maybeSingle = vi.fn(async () => ({
        data: { identity_doc_url: ['https://example.supabase.co/storage/v1/object/public/user-documents/test-user-id/old.png'], identity_type: ['resident'] },
        error: null,
      }))
      return chain
    })
    await POST(makeEvent({ merge: true, types: ['driver'] }))
    expect(mockSendPushToAdmins).not.toHaveBeenCalled()
  })

  it('카드 세션조회가 예외를 던져도 관리자 푸시는 독립적으로 발송되고 업로드는 ok:true', async () => {
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'find_or_create_general_chat_session') throw new Error('세션조회 실패(시뮬레이션)')
      return { data: null, error: null }
    })
    const result = (await POST(makeEvent())) as unknown as { data: { ok: boolean } }
    expect(result.data.ok).toBe(true)
    expect(mockSendPushToAdmins).toHaveBeenCalledTimes(1)
  })
})
