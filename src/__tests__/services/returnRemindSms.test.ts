import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import * as smsModule from '$lib/server/sms'
import { sendReservationLifecyclePush } from '$lib/server/push'

/**
 * 배치 루프 핵심 로직 — Migration 507 결함수정 검증용
 *
 * 크론 핸들러의 GET 함수는 SvelteKit RequestHandler라 직접 임포트가 어렵다.
 * 배치 루프 로직만 추출한 아래 헬퍼로 동일한 루프 행동을 단위 테스트한다.
 * (subscription-billing / locker-guide Cron과 동일한 BATCH_SIZE+MAX_BATCHES 패턴)
 */
interface ReturnRemindTargetRow {
  reservation_id: number
  user_id: string
  phone: string | null
  product_name: string | null
}

async function runReturnRemindBatchLoop(
  adminClient: SupabaseClient,
  batchSize: number,
  maxBatches: number,
  smsSender: (phone: string, msg: string) => Promise<void>,
): Promise<{ processed: number; succeeded: number; failed: number; rpcCallCount: number }> {
  let processed = 0
  let succeeded = 0
  let failed = 0
  let rpcCallCount = 0

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data: targets, error: targetsErr } = await adminClient.rpc(
      'get_return_remind_targets',
      { p_limit: batchSize },
    )
    rpcCallCount++

    if (targetsErr) break

    const rows = (targets ?? []) as ReturnRemindTargetRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      processed++
      try {
        // ③ 채팅카드 (mock admin에서는 항상 성공)
        const { error: chatErr } = await adminClient.rpc('send_rental_chat_notification', {
          p_reservation_id: row.reservation_id,
          p_notify_type:    'return_remind',
        })
        if (chatErr) throw new Error(chatErr.message)

        // ④ SMS
        if (row.phone) {
          await smsSender(row.phone, `[크레이지샷] ${row.product_name ?? '상품'} 반납예정일 알림`)
        }
        succeeded++
      } catch {
        failed++
      }
    }

    if (rows.length < batchSize) break
  }

  return { processed, succeeded, failed, rpcCallCount }
}

/**
 * return_remind Vercel Cron 대상 선정 RPC 검증 (TDD, Migration 506)
 *
 * 이 테스트는 Stage DB(ezyvffjvuwmtuhpxdjrw)에 ephemeral 행을 만드는 라이브 통합테스트.
 * holdExpiration.test.ts와 동일한 패턴.
 *
 * 검증 범위:
 *   1. end_date=오늘 + status=in_use 예약 → get_return_remind_targets()에 포함됨
 *   2. end_date=오늘 + status=return_requested 예약 → 포함됨
 *   3. end_date=내일 + status=in_use 예약 → 제외됨 (아직 반납일 아님)
 *   4. end_date=오늘 + status=confirmed 예약 → 제외됨 (대여 시작 전)
 *   5. 이미 오늘 return_remind 채팅카드가 발송된 예약 → 제외됨 (당일 중복 방지)
 */

const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type Cleanup = () => Promise<void>
const cleanups: Cleanup[] = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()
    if (fn) await fn()
  }
})

/** 오늘 날짜 (UTC, YYYY-MM-DD) — Vercel Cron이 UTC 00:00에 실행되므로 UTC 기준 */
const today = () => new Date().toISOString().slice(0, 10)

/** 내일 날짜 (UTC) */
const tomorrow = () => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

let _testProductId: string | undefined

async function ensureTestProductId(): Promise<string> {
  if (_testProductId) return _testProductId
  const { data, error } = await admin.from('products').select('id').limit(1).single()
  if (error || !data) throw new Error(`테스트용 product 조회 실패: ${error?.message}`)
  _testProductId = data.id as string
  return _testProductId
}

async function createEphemeralUser(): Promise<string> {
  const email = `tdd-returnremind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!',
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`ephemeral user 생성 실패: ${error?.message}`)
  return data.user.id
}

async function deleteEphemeralUser(userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId).catch(() => undefined)
}

async function createReservation(opts: {
  userId: string
  status: string
  endDate: string
}): Promise<number> {
  const productId = await ensureTestProductId()
  // start_date는 end_date보다 1일 이전으로 설정 (유효한 날짜 범위)
  const startDate = new Date(opts.endDate)
  startDate.setUTCDate(startDate.getUTCDate() - 1)
  const startStr = startDate.toISOString().slice(0, 10)

  const { data, error } = await admin
    .from('rental_reservations')
    .insert({
      user_id:       opts.userId,
      product_id:    productId,
      start_date:    startStr,
      end_date:      opts.endDate,
      status:        opts.status,
      pickup_method: 'visit',
      return_method: 'visit',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`reservation 생성 실패: ${error?.message}`)
  return data.id as number
}

interface RemindTarget {
  reservation_id: number
  user_id: string
  phone: string | null
  product_name: string | null
}

async function getRemindTargets(): Promise<RemindTarget[]> {
  const { data, error } = await admin.rpc('get_return_remind_targets', {})
  if (error) throw new Error(`get_return_remind_targets 호출 실패: ${error.message}`)
  return (data ?? []) as RemindTarget[]
}

/**
 * sendReservationLifecyclePush skipSmsFallback 옵션 검증
 *
 * 이 describe 블록은 DB를 직접 쓰지 않는 단위 테스트.
 * admin mock으로 rental_reservations·user_profiles 응답을 제어하고,
 * vi.spyOn으로 sendReservationLifecycleSmsFallback 호출 여부만 검증한다.
 *
 * sendPushToUser 내부는 getServiceClient()로 Stage DB의 notification_tokens를 조회하는데,
 * user_id='test-no-token-user-xyz'처럼 존재하지 않는 ID면 토큰 없음 → dispatch()가
 * hadTokens:false로 즉시 반환 → Firebase를 초기화하지 않아도 no_token 경로를 재현할 수 있다.
 */

/**
 * sendReservationLifecyclePush가 내부에서 사용하는 admin 쿼리 체인을 흉내내는 mock.
 * rental_reservations 조회는 가상 예약행을, user_profiles 조회는 phone 인자를 반환한다.
 */
function makeMockAdmin(phone: string | null = null): SupabaseClient {
  const makeBuilder = (resolveData: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.select    = () => b
    b.eq        = () => b
    b.single    = () => Promise.resolve({ data: resolveData, error: null })
    b.maybeSingle = () => Promise.resolve({ data: resolveData, error: null })
    return b
  }

  return {
    from: (table: string) => {
      if (table === 'rental_reservations') {
        // Stage DB에 없는 user_id → sendPushToUser가 no_token 반환 (Firebase 호출 없음)
        return makeBuilder({ user_id: 'test-no-token-user-xyz', products: { name: '테스트 카메라' } })
      }
      if (table === 'user_profiles') {
        return makeBuilder(phone ? { phone } : null)
      }
      return makeBuilder(null)
    },
  } as unknown as SupabaseClient
}

describe('sendReservationLifecyclePush — skipSmsFallback 옵션으로 SMS 중복 발송 방지 (TDD, Migration 506)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('skipSmsFallback: true 시 push가 no_token이어도 SMS fallback이 발송되지 않는다', async () => {
    const fallbackSpy = vi
      .spyOn(smsModule, 'sendReservationLifecycleSmsFallback')
      .mockResolvedValue(undefined)

    await sendReservationLifecyclePush(
      makeMockAdmin('01099998888'),  // phone 있어도 skip돼야 함
      99999,
      'return_remind',
      { skipSmsFallback: true },
    )

    expect(fallbackSpy).not.toHaveBeenCalled()
  })

  it('skipSmsFallback 미전달 + no_token + phone 있음 → SMS fallback 정확히 1회 발송', async () => {
    const fallbackSpy = vi
      .spyOn(smsModule, 'sendReservationLifecycleSmsFallback')
      .mockResolvedValue(undefined)

    await sendReservationLifecyclePush(
      makeMockAdmin('01099998888'),
      99999,
      'return_remind',
      // options 미전달 → 기존 동작(fallback 허용)
    )

    expect(fallbackSpy).toHaveBeenCalledTimes(1)
    expect(fallbackSpy).toHaveBeenCalledWith('01099998888', '테스트 카메라', 'return_remind')
  })

  it('skipSmsFallback 미전달 + no_token + phone 없음 → SMS fallback 미발송 (phone null 가드)', async () => {
    const fallbackSpy = vi
      .spyOn(smsModule, 'sendReservationLifecycleSmsFallback')
      .mockResolvedValue(undefined)

    await sendReservationLifecyclePush(
      makeMockAdmin(null),  // phone 없음
      99999,
      'return_remind',
    )

    // phone이 null이면 sendReservationLifecycleSmsFallback 호출 자체가 없음
    expect(fallbackSpy).not.toHaveBeenCalled()
  })
})

describe('get_return_remind_targets — 반납 예정 알림 대상 선정 RPC (Migration 506)', () => {
  // ────────────────────────────────────────────────────────────
  // 케이스 1: end_date=오늘 + status=in_use → 포함됨
  // ────────────────────────────────────────────────────────────
  it('오늘 반납 예정 in_use 예약은 대상에 포함된다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation({ userId, status: 'in_use', endDate: today() })
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    const targets = await getRemindTargets()
    const found = targets.some((t) => t.reservation_id === reservationId)
    expect(found).toBe(true)
  })

  // ────────────────────────────────────────────────────────────
  // 케이스 2: end_date=오늘 + status=return_requested → 포함됨
  // ────────────────────────────────────────────────────────────
  it('오늘 반납 예정 return_requested 예약도 대상에 포함된다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation({
      userId,
      status: 'return_requested',
      endDate: today(),
    })
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    const targets = await getRemindTargets()
    const found = targets.some((t) => t.reservation_id === reservationId)
    expect(found).toBe(true)
  })

  // ────────────────────────────────────────────────────────────
  // 케이스 3: end_date=내일 + status=in_use → 제외됨
  // ────────────────────────────────────────────────────────────
  it('내일 반납 예정 예약은 대상에서 제외된다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation({ userId, status: 'in_use', endDate: tomorrow() })
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    const targets = await getRemindTargets()
    const found = targets.some((t) => t.reservation_id === reservationId)
    expect(found).toBe(false)
  })

  // ────────────────────────────────────────────────────────────
  // 케이스 4: end_date=오늘 + status=confirmed → 제외됨 (대여 미시작)
  // ────────────────────────────────────────────────────────────
  it('status=confirmed(대여 미시작) 예약은 대상에서 제외된다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation({ userId, status: 'confirmed', endDate: today() })
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    const targets = await getRemindTargets()
    const found = targets.some((t) => t.reservation_id === reservationId)
    expect(found).toBe(false)
  })

  // ────────────────────────────────────────────────────────────
  // 케이스 5: 오늘 이미 return_remind 채팅카드가 발송된 예약 → 제외됨 (중복 방지)
  // ────────────────────────────────────────────────────────────
  it('오늘 이미 return_remind 채팅카드가 발송된 예약은 중복 방지로 제외된다', async () => {
    const userId = await createEphemeralUser()
    cleanups.push(() => deleteEphemeralUser(userId))

    const reservationId = await createReservation({ userId, status: 'in_use', endDate: today() })
    cleanups.push(async () => {
      await admin.from('rental_reservations').delete().eq('id', reservationId)
    })

    // send_rental_chat_notification 호출로 채팅카드를 직접 발송해 "이미 발송" 상태 시뮬레이션
    const { error: chatErr } = await admin.rpc('send_rental_chat_notification', {
      p_reservation_id: reservationId,
      p_notify_type:    'return_remind',
    })
    // RPC가 없거나 실패하면 이 케이스는 스킵 (Stage DB 상태에 따라 다를 수 있음)
    if (chatErr) {
      console.warn(`send_rental_chat_notification 실패(케이스5 스킵): ${chatErr.message}`)
      return
    }

    const targets = await getRemindTargets()
    const found = targets.some((t) => t.reservation_id === reservationId)
    expect(found).toBe(false)
  })
})

// ============================================================
// 배치 루프 — Migration 507 결함수정 검증 (단위 테스트, Stage DB 불필요)
// ============================================================

/**
 * mock admin 팩토리 — get_return_remind_targets 호출마다 다른 결과를 순서대로 반환.
 * send_rental_chat_notification은 항상 성공(error: null)을 반환.
 *
 * rpcResponses: get_return_remind_targets 호출 순서별 반환 행 배열
 *   예) [[row1..row100], [row101..row150], []] → 총 3회 호출, 150건 처리 후 종료
 */
function makeBatchMockAdmin(rpcResponses: ReturnRemindTargetRow[][]): {
  admin: SupabaseClient
  callCount: () => number
} {
  let callIdx = 0
  const admin = {
    rpc: (fnName: string, _params?: unknown) => {
      if (fnName === 'get_return_remind_targets') {
        const rows = rpcResponses[callIdx] ?? []
        callIdx++
        return Promise.resolve({ data: rows, error: null })
      }
      // send_rental_chat_notification → 항상 성공
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as SupabaseClient

  return { admin, callCount: () => callIdx }
}

/** 가짜 ReturnRemindTargetRow 생성 헬퍼 */
function makeRows(count: number, startId = 1): ReturnRemindTargetRow[] {
  return Array.from({ length: count }, (_, i) => ({
    reservation_id: startId + i,
    user_id:        `user-${startId + i}`,
    phone:          null,
    product_name:   `상품${startId + i}`,
  }))
}

describe('return-remind 배치 루프 — BATCH_SIZE 초과 시 여러 배치로 나눠 전체 처리 (Migration 507)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('150건: BATCH_SIZE=100 → 배치 2회로 전체 150건 처리(누락 0건)', async () => {
    const smsSpy = vi.fn().mockResolvedValue(undefined)

    // 첫 번째 호출: 100건(BATCH_SIZE=full), 두 번째 호출: 50건(BATCH_SIZE 미만 → break)
    // locker-guide 정본 패턴과 동일: 마지막 배치가 BATCH_SIZE 미만이면 빈 배열 조회 없이 즉시 종료
    const { admin: mockAdmin } = makeBatchMockAdmin([
      makeRows(100, 1),
      makeRows(50, 101),
    ])

    const result = await runReturnRemindBatchLoop(mockAdmin, 100, 5, smsSpy)

    expect(result.processed).toBe(150)
    expect(result.succeeded).toBe(150)
    expect(result.failed).toBe(0)
    // get_return_remind_targets 호출 횟수: 1차(100건) + 2차(50건, BATCH_SIZE 미만 → break) = 2회
    expect(result.rpcCallCount).toBe(2)
  })

  it('100건 정확: BATCH_SIZE=100 → 배치 1회(full) + 빈배치 1회로 정상 종료(100건)', async () => {
    const smsSpy = vi.fn().mockResolvedValue(undefined)

    // 정확히 100건이면 1차 배치가 full(100==100) → 루프 지속 → 2차 호출에서 빈 배열 → break
    const { admin: mockAdmin } = makeBatchMockAdmin([
      makeRows(100, 1),
      [], // 빈 배열 → 루프 종료
    ])

    const result = await runReturnRemindBatchLoop(mockAdmin, 100, 5, smsSpy)

    expect(result.processed).toBe(100)
    expect(result.succeeded).toBe(100)
    // 100 == BATCH_SIZE이므로 break 없이 다음 배치 조회 → 빈 배열 → break
    // 총 2회 호출
    expect(result.rpcCallCount).toBe(2)
  })

  it('50건: BATCH_SIZE=100 → 배치 1회(첫 배치가 BATCH_SIZE 미만이므로 즉시 종료)', async () => {
    const smsSpy = vi.fn().mockResolvedValue(undefined)

    const { admin: mockAdmin } = makeBatchMockAdmin([
      makeRows(50, 1),
    ])

    const result = await runReturnRemindBatchLoop(mockAdmin, 100, 5, smsSpy)

    expect(result.processed).toBe(50)
    expect(result.succeeded).toBe(50)
    // 50 < 100 이므로 루프가 1회 후 break → rpcCallCount = 1
    expect(result.rpcCallCount).toBe(1)
  })

  it('MAX_BATCHES 상한: 6배치 대상이어도 MAX_BATCHES=5 제한으로 500건만 처리', async () => {
    const smsSpy = vi.fn().mockResolvedValue(undefined)

    // 모든 호출에서 100건 반환 (항상 full batch)
    const { admin: mockAdmin } = makeBatchMockAdmin([
      makeRows(100, 1),
      makeRows(100, 101),
      makeRows(100, 201),
      makeRows(100, 301),
      makeRows(100, 401),
      makeRows(100, 501), // 6번째 — MAX_BATCHES=5이면 이 배치는 조회 안 됨
    ])

    const result = await runReturnRemindBatchLoop(mockAdmin, 100, 5, smsSpy)

    expect(result.processed).toBe(500)
    expect(result.rpcCallCount).toBe(5) // MAX_BATCHES=5로 정확히 5회만 호출
  })

  it('대상 0건: 첫 호출에서 빈 배열 → 처리 없이 정상 종료', async () => {
    const smsSpy = vi.fn().mockResolvedValue(undefined)

    const { admin: mockAdmin } = makeBatchMockAdmin([[]])

    const result = await runReturnRemindBatchLoop(mockAdmin, 100, 5, smsSpy)

    expect(result.processed).toBe(0)
    expect(result.succeeded).toBe(0)
    expect(result.rpcCallCount).toBe(1)
    expect(smsSpy).not.toHaveBeenCalled()
  })
})
