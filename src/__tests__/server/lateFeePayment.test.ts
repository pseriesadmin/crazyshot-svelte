import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 연체료 결제 TDD 테스트
 *
 * 핵심 비즈니스 로직 3가지 커버:
 *   1. enrichPaymentRequestCard — 미납 연체료 조회 및 ActionPayload 채우기
 *   2. validateLateFeeAccess   — 소유권 + 중복결제 방지
 *
 * RED → 아직 구현이 없어 모두 FAIL 예정.
 * 참조: TASK.md "4단계 ① 결제요청" / chatActionEnrich.ts 패턴 동일 적용
 */

// ── Supabase mock 유틸 ────────────────────────────────────────────────────────

type QueryResult<T> = Promise<{ data: T | null; error: null }>

function makeChain<T>(data: T | null): Record<string, unknown> {
  // 배열 쿼리(maybeSingle 없이 await) 지원용 thenable
  // Supabase client는 체인 자체가 Promise-like — await chain → { data: Row[], error }
  const arrayData: unknown[] = data !== null ? [data] : []
  const resolvedArray = { data: arrayData, error: null }

  const chain: Record<string, unknown> = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    in:          vi.fn().mockReturnThis(),
    order:       vi.fn().mockReturnThis(),
    limit:       vi.fn().mockReturnThis(),
    not:         vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null } as Awaited<QueryResult<T>>),
    single:      vi.fn().mockResolvedValue({ data, error: null } as Awaited<QueryResult<T>>),
    // thenable: 체인 자체를 await 했을 때 배열 반환 (array select용)
    then: (onfulfilled: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolvedArray).then(onfulfilled, onrejected),
  }
  return chain
}

function makeAdmin(tableResponses: Record<string, unknown[]>): SupabaseClient {
  const callCounts: Record<string, number> = {}
  return {
    from: vi.fn().mockImplementation((table: string) => {
      callCounts[table] = callCounts[table] ?? 0
      const queue = tableResponses[table] ?? []
      const idx   = callCounts[table]
      callCounts[table]++
      return makeChain(queue[idx] ?? null)
    }),
    rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }),
  } as unknown as SupabaseClient
}

// ── enrichActionCard — PAYMENT_REQUEST_CARD (연체료) ─────────────────────────

import { enrichActionCard } from '$lib/server/chatActionEnrich'
import type { EnrichContext } from '$lib/server/chatActionEnrich'

const GENERAL_CTX: EnrichContext = { context_type: 'general', context_id: null }
const USER_ID = 'user-uuid-test-0001'

describe('enrichActionCard — PAYMENT_REQUEST_CARD (연체료)', () => {
  it('미납 연체료 있음 → fee_amount·hours_late·late_fee_id·action_url 채움', async () => {
    // late_fees 테이블 → unpaid 행 1건 반환
    // late_fees JOIN rental_reservations: late_fees에는 user_id가 없어 2단계 조회 필요
    const admin = makeAdmin({
      late_fees: [
        {
          id: 'late-fee-uuid-001',
          reservation_id: 42,
          fee_amount: 30000,
          hours_late: 6,
          is_paid: false,
        },
      ],
      rental_reservations: [
        {
          id: 42,
          user_id: USER_ID,
        },
      ],
    })

    const result = await enrichActionCard('PAYMENT_REQUEST_CARD', USER_ID, GENERAL_CTX, admin)

    expect(result.type).toBe('PAYMENT_REQUEST_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.late_fee_id).toBe('late-fee-uuid-001')
    expect(result.fee_amount).toBe(30000)
    expect(result.hours_late).toBe(6)
    expect(result.action_url).toBe('/pay/late-fee/late-fee-uuid-001')
  })

  it('미납 연체료 없음 → is_expired:true 반환 (연체 없는 고객)', async () => {
    const admin = makeAdmin({
      late_fees: [],        // null 반환 (미납 없음)
      rental_reservations: [],
    })

    const result = await enrichActionCard('PAYMENT_REQUEST_CARD', USER_ID, GENERAL_CTX, admin)

    expect(result.type).toBe('PAYMENT_REQUEST_CARD')
    expect(result.is_expired).toBe(true)
    expect(result.late_fee_id).toBeUndefined()
    expect(result.fee_amount).toBeUndefined()
  })

  it('DB 조회 실패(예외) → 기본 페이로드로 폴백 (크래시 없음)', async () => {
    const brokenAdmin = {
      from: vi.fn().mockImplementation(() => {
        throw new Error('DB connection error')
      }),
    } as unknown as SupabaseClient

    const result = await enrichActionCard('PAYMENT_REQUEST_CARD', USER_ID, GENERAL_CTX, brokenAdmin)

    expect(result.type).toBe('PAYMENT_REQUEST_CARD')
    // 폴백 시 is_expired 기본값(false) 유지 — 크래시 없이 계속 발송
    expect(result.is_expired).toBe(false)
    expect(result.late_fee_id).toBeUndefined()
  })
})

// ── validateLateFeeAccess — 소유권 + 중복결제 방지 ──────────────────────────

import { validateLateFeeAccess } from '$lib/server/lateFeeUtils'

describe('validateLateFeeAccess — 소유권 + 중복결제 방지', () => {
  it('정상: 소유자 일치 + 미납 → ok:true + lateFee 반환', async () => {
    const admin = makeAdmin({
      late_fees: [
        {
          id: 'late-fee-uuid-001',
          reservation_id: 42,
          fee_amount: 30000,
          hours_late: 6,
          is_paid: false,
        },
      ],
      rental_reservations: [
        { id: 42, user_id: USER_ID },
      ],
    })

    const result = await validateLateFeeAccess('late-fee-uuid-001', USER_ID, admin)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.lateFee.id).toBe('late-fee-uuid-001')
      expect(result.lateFee.fee_amount).toBe(30000)
      expect(result.lateFee.hours_late).toBe(6)
    }
  })

  it('소유권 불일치 → ok:false + status:403', async () => {
    const admin = makeAdmin({
      late_fees: [
        {
          id: 'late-fee-uuid-001',
          reservation_id: 42,
          fee_amount: 30000,
          hours_late: 6,
          is_paid: false,
        },
      ],
      rental_reservations: [
        // user_id가 다른 사용자
        { id: 42, user_id: 'other-user-uuid' },
      ],
    })

    const result = await validateLateFeeAccess('late-fee-uuid-001', USER_ID, admin)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('이미 결제된 연체료 → ok:false + status:409', async () => {
    const admin = makeAdmin({
      late_fees: [
        {
          id: 'late-fee-uuid-001',
          reservation_id: 42,
          fee_amount: 30000,
          hours_late: 6,
          is_paid: true,   // 이미 결제됨
        },
      ],
      rental_reservations: [
        { id: 42, user_id: USER_ID },
      ],
    })

    const result = await validateLateFeeAccess('late-fee-uuid-001', USER_ID, admin)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
    }
  })

  it('late_fee가 존재하지 않음 → ok:false + status:404', async () => {
    const admin = makeAdmin({
      late_fees: [],   // null 반환
      rental_reservations: [],
    })

    const result = await validateLateFeeAccess('nonexistent-id', USER_ID, admin)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
    }
  })
})
