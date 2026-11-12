import { describe, it, expect, vi, beforeEach } from 'vitest'

/** POST /api/reservations/edit-order — 신청대기 예약 '예약 수정' 저장 API (Migration 811 edit_submitted_reservation_order) */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

type RpcCall = { name: string; args: Record<string, unknown> }
const adminCalls: RpcCall[] = []
const userCalls: RpcCall[] = []
let logShouldThrow = false
let customerName = '홍길동'
let logInFlight = 0
let logMaxInFlight = 0
let logDelay = false
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
let rpcThrows = false

const adminClient = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    adminCalls.push({ name, args })
    if (name === 'log_rental_action') {
      logInFlight++
      logMaxInFlight = Math.max(logMaxInFlight, logInFlight)
      try {
        if (logDelay) await new Promise((r) => setTimeout(r, 5))
        if (logShouldThrow) throw new Error('log down')
      } finally {
        logInFlight--
      }
    }
    if (name === 'edit_submitted_reservation_order_for_user') {
      if (rpcThrows) throw new Error('SQL boom: relation secret_table')
      return rpcResult
    }
    return { data: null, error: null }
  }),
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: customerName }, error: null }) }) }),
  }),
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => adminClient }))

let allowRate = true
const rateCalls: unknown[] = []
vi.mock('$lib/server/guard/rateLimit', () => ({
  takeRate: vi.fn(async (_admin: unknown, rule: unknown) => {
    rateCalls.push(rule)
    return allowRate
  }),
}))

let pushShouldThrow = false
const pushCalls: Array<{ type: string; payload: Record<string, unknown> }> = []
vi.mock('$lib/server/push', () => ({
  sendPushToAdmins: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    pushCalls.push({ type, payload })
    if (pushShouldThrow) throw new Error('push down')
  }),
  sendPushToUser: vi.fn(),
}))

const userClient = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    userCalls.push({ name, args })
    if (rpcThrows) throw new Error('SQL boom: relation secret_table')
    return rpcResult
  }),
}

const rpcCount = () => adminCalls.filter((c) => c.name === 'edit_submitted_reservation_order_for_user').length

const COUPON_A = '123e4567-e89b-42d3-a456-426614174000'
const validBody = {
  reservationId: 10,
  expectedReservationIds: [10, 11],
  lines: [{ keep: true, reservation_id: 10 }, { keep: true, reservation_id: 11 }],
  selectedCouponIds: [COUPON_A],
  selectedPoints: 500,
}

const successData = {
  success: true,
  reason: 'ok',
  order_id: 77,
  reservation_ids: [20, 21],
  reservation_code: 'CS-2611-0001',
  previous_final_amount: 100000,
  final_amount: 90000,
  selected_points: 500,
  delivery_fee: 3000,
  total_amount: 93000,
  cancelled_reservation_ids: [10, 11],
  dropped_coupons: [{ userCouponId: COUPON_A, reason: 'MIN_AMOUNT' }],
  message: '수정했어요',
}

function makeEvent(opts: { loggedIn?: boolean; body?: unknown; rawBody?: string } = {}) {
  const { loggedIn = true, body = validBody, rawBody } = opts
  return {
    locals: {
      supabase: userClient,
      safeGetSession: async () => ({ session: loggedIn ? { user: { id: 'forged-cookie-id' } } : null, user: loggedIn ? { id: 'user-1' } : null }),
    },
    request: { json: async () => (rawBody !== undefined ? JSON.parse(rawBody) : body) },
    getClientAddress: () => '1.2.3.4',
  } as never
}

async function call(opts?: Parameters<typeof makeEvent>[0]) {
  const { POST } = await import('../../routes/api/reservations/edit-order/+server')
  return POST(makeEvent(opts))
}

beforeEach(() => {
  adminCalls.length = 0
  userCalls.length = 0
  rateCalls.length = 0
  pushCalls.length = 0
  logShouldThrow = false
  customerName = '홍길동'
  logInFlight = 0
  logMaxInFlight = 0
  logDelay = false
  pushShouldThrow = false
  rpcThrows = false
  allowRate = true
  rpcResult = { data: successData, error: null }
})

describe('인증·형식·속도 제한', () => {
  it('세션 없음 → 401, RPC 호출 없음', async () => {
    const res = await call({ loggedIn: false })
    expect(res.status).toBe(401)
    expect(rpcCount()).toBe(0)
  })

  it.each([
    ['reservationId 누락', { ...validBody, reservationId: undefined }],
    ['reservationId 문자열', { ...validBody, reservationId: 'abc' }],
    ['reservationId 0', { ...validBody, reservationId: 0 }],
    ['expectedReservationIds 비배열', { ...validBody, expectedReservationIds: 10 }],
    ['expectedReservationIds 빈 배열', { ...validBody, expectedReservationIds: [] }],
    ['expectedReservationIds 문자 포함', { ...validBody, expectedReservationIds: [10, 'x'] }],
    ['lines 비배열', { ...validBody, lines: 'x' }],
    ['lines 항목이 객체 아님', { ...validBody, lines: [1] }],
    ['selectedCouponIds 비문자', { ...validBody, selectedCouponIds: [1] }],
    ['selectedPoints 음수', { ...validBody, selectedPoints: -1 }],
    ['selectedPoints 소수', { ...validBody, selectedPoints: 1.5 }],
    ['쿠폰 id가 UUID 아님', { ...validBody, selectedCouponIds: ['c1'] }],
    ['쿠폰 id에 SQL 조각', { ...validBody, selectedCouponIds: [`${COUPON_A}'; drop`] }],
    ['reservationId 상한 초과', { ...validBody, reservationId: 2147483648 }],
    ['expectedReservationIds 상한 초과', { ...validBody, expectedReservationIds: [10, 2147483648] }],
    ['selectedPoints 상한 초과', { ...validBody, selectedPoints: 2147483648 }],
    ['lines 전체 크기 65536자 초과', { ...validBody, lines: Array.from({ length: 50 }, () => ({ memo: 'a'.repeat(400), a: 'b'.repeat(400), c: 'd'.repeat(400), e: 'f'.repeat(400) })) }],
    ['줄 객체 키 41개', { ...validBody, lines: [Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, 1]))] }],
    ['문자열 값 501자', { ...validBody, lines: [{ memo: 'a'.repeat(501) }] }],
    ['중첩 깊이 5', { ...validBody, lines: [{ a: { b: { c: { d: { e: 1 } } } } }] }],
    ['배열 안 문자열 501자', { ...validBody, lines: [{ opts: [{ n: 'a'.repeat(501) }] }] }],
  ])('형식 오류(%s) → 400, RPC 호출 없음', async (_n, body) => {
    const res = await call({ body })
    expect(res.status).toBe(400)
    expect(rpcCount()).toBe(0)
  })

  it('경계값은 통과 — 상한 id·포인트, 키 40개, 문자열 500자, 깊이 4', async () => {
    const lines = [
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 1])),
      { memo: 'a'.repeat(500) },
      { a: { b: { c: { d: 1 } } } },
    ]
    const res = await call({ body: { reservationId: 2147483647, expectedReservationIds: [2147483647], lines, selectedCouponIds: [COUPON_A.toUpperCase()], selectedPoints: 2147483647 } })
    expect(res.status).toBe(200)
    expect(rpcCount()).toBe(1)
  })

  it('검증된 user 가 없으면(세션만 있음) 401, RPC 호출 없음 — 쿠키 위조 세션 id 는 쓰지 않는다', async () => {
    const { POST } = await import('../../routes/api/reservations/edit-order/+server')
    const res = await POST({
      locals: { supabase: userClient, safeGetSession: async () => ({ session: { user: { id: 'victim-id' } }, user: null }) },
      request: { json: async () => validBody },
      getClientAddress: () => '1.2.3.4',
    } as never)
    expect(res.status).toBe(401)
    expect(rpcCount()).toBe(0)
  })

  it('JSON 본문 파싱 실패 → 400', async () => {
    const { POST } = await import('../../routes/api/reservations/edit-order/+server')
    const res = await POST({
      locals: { supabase: userClient, safeGetSession: async () => ({ session: { user: { id: 'user-1' } }, user: { id: 'user-1' } }) },
      request: { json: async () => { throw new Error('bad json') } },
      getClientAddress: () => '1.2.3.4',
    } as never)
    expect(res.status).toBe(400)
  })

  it('속도 제한 초과 → 429, RPC 호출 없음. 규칙은 사용자 id 기준 60초 10회', async () => {
    allowRate = false
    const res = await call()
    expect(res.status).toBe(429)
    expect(rpcCount()).toBe(0)
    expect(rateCalls[0]).toEqual({ bucket: 'edit_order_user', key: 'user-1', windowSeconds: 60, max: 10 })
  })
})

describe('RPC 호출 방식', () => {
  it('서비스 클라이언트로 for_user 호출, p_user_id 는 세션 사용자(사용자 클라이언트로는 호출 안 함)', async () => {
    await call()
    expect(userCalls).toHaveLength(0)
    const calls = adminCalls.filter((c) => c.name === 'edit_submitted_reservation_order_for_user')
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual({
      p_user_id: 'user-1',
      p_reservation_id: 10,
      p_expected_reservation_ids: [10, 11],
      p_lines: validBody.lines,
      p_selected_coupon_ids: [COUPON_A],
      p_selected_points: 500,
    })
    expect(adminCalls.some((c) => c.name === 'edit_submitted_reservation_order')).toBe(false)
  })

  it('본문에 userId·p_user_id 를 넣어도 무시 — 세션 사용자만 전달', async () => {
    await call({ body: { ...validBody, userId: 'attacker', user_id: 'attacker', p_user_id: 'attacker' } })
    const calls = adminCalls.filter((c) => c.name === 'edit_submitted_reservation_order_for_user')
    expect(calls).toHaveLength(1)
    expect(calls[0].args.p_user_id).toBe('user-1')
    expect(JSON.stringify(calls[0].args)).not.toContain('attacker')
  })

  it('쿠폰·포인트 생략 시 null 전달', async () => {
    await call({ body: { reservationId: 10, expectedReservationIds: [10], lines: [{ keep: true, reservation_id: 10 }] } })
    const args = adminCalls.find((c) => c.name === 'edit_submitted_reservation_order_for_user')?.args
    expect(args?.p_selected_coupon_ids).toBeNull()
    expect(args?.p_selected_points).toBeNull()
  })
})

describe('실패 reason → HTTP 상태 매핑', () => {
  const table: Array<[string, number]> = [
    ['STALE', 409], ['SIGNED', 409], ['PAID', 409], ['CANCEL_REQUESTED', 409], ['EXPIRED', 409],
    ['DIRECT_PAY', 409], ['NOT_HOLD', 409],
    ['HOLD_FAILED', 409], ['OPTION_STOCK_EXCEEDED', 409], ['HOLIDAY_EXTENSION_CONFLICT', 409], ['BUNDLE_HOLIDAY_EXTENSION_CONFLICT', 409],
    ['NOT_OWNER', 403], ['UNAUTHENTICATED', 401],
    ['BAD_REQUEST', 400], ['MIN_ONE_LINE', 400], ['SALE_ONLY_NOT_EDITABLE', 400], ['INVALID_METHOD', 400],
    ['INVALID_TIME', 400], ['PRICE_UNSET', 400], ['OPTION_DELIVERY_DISABLED', 400], ['OPTION_NOT_LINKED', 400],
    ['COUPON_STACKING_NOT_ALLOWED', 400], ['RETURN_DELIVERY_RESTRICTED', 400], ['OUT_OF_DELIVERY_AREA', 400],
    ['FRONTDOOR_PASSWORD_TOO_LONG', 400], ['RETURN_ADDRESS_TOO_LONG', 400], ['RETURN_POSTAL_CODE_TOO_LONG', 400],
    ['PICKUP_LEAD_TIME', 400], ['RENTAL_PERIOD_EXCEEDED', 400],
    ['ERROR', 500], ['CANCEL_FAILED', 500], ['DELIVERY_FEE_FAILED', 500], ['SOMETHING_NEW', 500],
  ]

  it.each(table)('%s → %i, 고객용 한국어 문구, 내부 원문 비노출', async (reason, status) => {
    rpcResult = { data: { success: false, reason, message: 'RAW internal sql detail', order_id: 77 }, error: null }
    const res = await call()
    expect(res.status).toBe(status)
    const json = await res.json()
    expect(typeof json.error).toBe('string')
    expect(json.error).toMatch(/[가-힣]/)
    expect(JSON.stringify(json)).not.toContain('RAW internal')
    expect(JSON.stringify(json)).not.toContain('order_id')
    expect(adminCalls.filter((c) => c.name === 'log_rental_action')).toHaveLength(0)
    expect(pushCalls).toHaveLength(0)
  })

  it('PICKUP_LEAD_TIME과 RENTAL_PERIOD_EXCEEDED는 서로 다른 문구', async () => {
    rpcResult = { data: { success: false, reason: 'PICKUP_LEAD_TIME' }, error: null }
    const a = await (await call()).json()
    rpcResult = { data: { success: false, reason: 'RENTAL_PERIOD_EXCEEDED' }, error: null }
    const b = await (await call()).json()
    expect(a.error).not.toBe(b.error)
  })

  it('편집 불가 계열 문구는 신청대기·예약 수정 용어를 쓴다', async () => {
    rpcResult = { data: { success: false, reason: 'PAID' }, error: null }
    const json = await (await call()).json()
    expect(json.error).toMatch(/예약 수정|신청대기/)
  })

  it('RPC가 error를 돌려주면 500 일반 문구', async () => {
    rpcResult = { data: null, error: { message: 'permission denied for table secret' } }
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })

  it('RPC가 예외를 던지면 500 일반 문구, 내부 메시지 비노출', async () => {
    rpcThrows = true
    const res = await call()
    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('SQL boom')
    expect(text).not.toContain('secret_table')
  })

  it('RPC 결과가 비어 있어도(null) 500', async () => {
    rpcResult = { data: null, error: null }
    expect((await call()).status).toBe(500)
  })
})

describe('성공 처리', () => {
  it('옛 예약 id마다 로그 1건 + 새 대표 예약 1건, 인자 정확', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const logs = adminCalls.filter((c) => c.name === 'log_rental_action')
    expect(logs).toHaveLength(3)
    const note = 'edit_order:새 예약 20,21로 교체'
    expect(logs[0].args).toEqual({ p_reservation_id: 10, p_action_type: 'customer_edit_order', p_admin_id: 'user-1', p_note: note })
    expect(logs[1].args).toEqual({ p_reservation_id: 11, p_action_type: 'customer_edit_order', p_admin_id: 'user-1', p_note: note })
    expect(logs[2].args).toEqual({ p_reservation_id: 20, p_action_type: 'customer_edit_order', p_admin_id: 'user-1', p_note: note })
  })

  it('관리자 푸시 1회(new_reservation, 고객명·예약코드 포함), 고객 푸시 없음', async () => {
    const push = await import('$lib/server/push')
    await call()
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0].type).toBe('new_reservation')
    expect(pushCalls[0].payload).toEqual({
      title: '예약 신청이 수정됐어요',
      body: '홍길동님이 예약 CS-2611-0001 내용을 수정했어요.',
      link: '/cms/reservation',
    })
    expect(push.sendPushToUser).not.toHaveBeenCalled()
  })

  it('로그 RPC는 병렬로 호출된다(동시에 3건 진행) — 인자 동일', async () => {
    logDelay = true
    await call()
    expect(logMaxInFlight).toBe(3)
    expect(adminCalls.filter((c) => c.name === 'log_rental_action')).toHaveLength(3)
  })

  it('로그 일부가 실패해도 나머지 로그·푸시·200 유지', async () => {
    logShouldThrow = true
    const res = await call()
    expect(res.status).toBe(200)
    expect(adminCalls.filter((c) => c.name === 'log_rental_action')).toHaveLength(3)
    expect(pushCalls).toHaveLength(1)
  })

  it('푸시 본문의 고객 이름은 제어문자 제거 후 20자로 자른다', async () => {
    customerName = '홍\n길\u0000동\u001f' + '가'.repeat(30)
    await call()
    const body = String(pushCalls[0].payload.body)
    // eslint-disable-next-line no-control-regex
    expect(body).not.toMatch(/[\u0000-\u001f\u007f]/)
    const expectedName = ('홍길동' + '가'.repeat(30)).slice(0, 20)
    expect(body).toBe(`${expectedName}님이 예약 CS-2611-0001 내용을 수정했어요.`)
  })

  it('dropped_coupons는 허용 키(문자열·숫자만)만 응답에 싣는다', async () => {
    rpcResult = {
      data: {
        ...successData,
        dropped_coupons: [
          { userCouponId: COUPON_A, name: '5천원', reason: 'MIN_AMOUNT', secret: 'x', nested: { a: 1 }, user_coupon_id: 7, flag: true },
          'junk',
          null,
          { name: { evil: 1 }, reason: 3 },
        ],
      },
      error: null,
    }
    const json = await (await call()).json()
    expect(json.dropped_coupons).toEqual([
      { userCouponId: COUPON_A, name: '5천원', reason: 'MIN_AMOUNT', user_coupon_id: 7 },
      { reason: 3 },
    ])
  })

  it('로그·푸시가 실패해도 200', async () => {
    logShouldThrow = true
    pushShouldThrow = true
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('응답은 허용된 필드만 — 내부 필드(order_id·cancelled_reservation_ids·selected_points·reason) 비노출', async () => {
    const json = await (await call()).json()
    expect(Object.keys(json).sort()).toEqual(
      ['delivery_fee', 'dropped_coupons', 'final_amount', 'message', 'previous_final_amount', 'reservation_code', 'reservation_ids', 'success', 'total_amount'].sort(),
    )
    expect(json.reservation_ids).toEqual([20, 21])
    expect(json.final_amount).toBe(90000)
  })
})
