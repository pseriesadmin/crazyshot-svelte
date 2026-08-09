import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * AC-3: enrichActionCard 유닛테스트
 *
 * Claude API 호출 없이 mock admin client 주입으로 검증한다.
 * PRODUCT_CARD / RESERVATION_STATUS_CARD 최소 2종 타입에 대해:
 *   - 실데이터가 채워지는지 (product_name·daily_rate·reservation_no·action_url 등)
 *   - DB 조회 실패 시 기본 페이로드(type + is_expired)로 폴백되는지
 *
 * 참조: TASK.md AC-1~AC-3 완료기준, chatActionEnrich.ts 구현
 */

// ── 모듈 모킹 (vi.mock은 자동 호이스팅) ─────────────────────────────────────
// enrichActionCard는 $lib/server/chatActionEnrich에서 직접 import → 모킹 불필요
// (admin: SupabaseClient 파라미터를 테스트에서 직접 주입하므로 모듈 모킹 없이 단위 테스트 가능)

import { enrichActionCard } from '$lib/server/chatActionEnrich'
import type { EnrichContext } from '$lib/server/chatActionEnrich'

// ---------------------------------------------------------------------------
// 테스트 유틸 — mock Supabase 체인 빌더

type QueryResult<T> = Promise<{ data: T | null; error: null }>

/** 단일 테이블 → 단일 응답값을 반환하는 chainable mock */
function makeChain<T>(data: T | null): Record<string, unknown> {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null } as Awaited<QueryResult<T>>)
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    is:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    limit:  vi.fn().mockReturnThis(),
    maybeSingle,
  }
  return chain
}

/**
 * from(tableName) 호출마다 tableMap에서 응답 데이터를 꺼내는 mock admin 생성.
 * 같은 테이블이 여러 번 호출되면 호출 순서대로 응답값을 소비(Once 큐).
 * 큐가 비면 null 반환.
 */
function makeAdmin(tableResponses: Record<string, unknown[]>): SupabaseClient {
  const callCounts: Record<string, number> = {}
  return {
    from: vi.fn().mockImplementation((table: string) => {
      callCounts[table] = (callCounts[table] ?? 0)
      const queue = tableResponses[table] ?? []
      const idx   = callCounts[table]
      callCounts[table]++
      return makeChain(queue[idx] ?? null)
    }),
  } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// 공통 컨텍스트

const GENERAL_CTX: EnrichContext = { context_type: 'general', context_id: null }
const PRODUCT_CTX: EnrichContext = {
  context_type: 'product_inquiry',
  context_id: 'prod-uuid-1234',
}
const USER_ID = 'user-uuid-5678'

// ---------------------------------------------------------------------------
// PRODUCT_CARD 테스트

describe('enrichActionCard — PRODUCT_CARD', () => {
  it('context_type=product_inquiry + context_id → product_name·daily_rate·action_url 채움', async () => {
    const admin = makeAdmin({
      products: [
        // 1차 호출: 상품 조회 (부모 상품 — parent_product_id null)
        {
          id: 'prod-uuid-1234',
          name: '소니 FX6 풀프레임 카메라',
          slug: 'sony-fx6',
          image_urls: ['https://storage.supabase.co/.../large_abc.webp'],
          parent_product_id: null,
        },
      ],
      price_rules: [
        // 24h 가격
        { price: 150000 },
      ],
    })

    const result = await enrichActionCard('PRODUCT_CARD', USER_ID, PRODUCT_CTX, admin)

    expect(result.type).toBe('PRODUCT_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.product_id).toBe('prod-uuid-1234')
    expect(result.product_name).toBe('소니 FX6 풀프레임 카메라')
    expect(result.daily_rate).toBe(150000)
    expect(result.action_url).toBe('/products/sony-fx6')
  })

  it('context_id 없으면(general 세션) 기본 페이로드 반환', async () => {
    const admin = makeAdmin({ products: [], price_rules: [] })

    const result = await enrichActionCard('PRODUCT_CARD', USER_ID, GENERAL_CTX, admin)

    expect(result.type).toBe('PRODUCT_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.product_name).toBeUndefined()
    expect(result.daily_rate).toBeUndefined()
  })

  it('자식 상품(parent_product_id 있음) → 부모 slug로 action_url 구성', async () => {
    const admin = makeAdmin({
      products: [
        // 1차: 자식 상품 조회
        {
          id: 'child-uuid',
          name: '소니 FX6 #1호기',
          slug: 'sony-fx6-unit-1',        // 자식의 slug (사용 안 됨)
          image_urls: [],
          parent_product_id: 'parent-uuid',
        },
        // 2차: 부모 상품 조회 (slug만 필요)
        { slug: 'sony-fx6' },
      ],
      price_rules: [{ price: 150000 }],
    })

    const childCtx: EnrichContext = {
      context_type: 'product_inquiry',
      context_id: 'child-uuid',
    }

    const result = await enrichActionCard('PRODUCT_CARD', USER_ID, childCtx, admin)

    expect(result.product_id).toBe('child-uuid')
    expect(result.action_url).toBe('/products/sony-fx6')  // 부모 slug 사용
  })

  it('DB 조회 실패(예외) → 기본 페이로드로 폴백', async () => {
    const brokenAdmin = {
      from: vi.fn().mockImplementation(() => {
        throw new Error('DB connection error')
      }),
    } as unknown as SupabaseClient

    const result = await enrichActionCard('PRODUCT_CARD', USER_ID, PRODUCT_CTX, brokenAdmin)

    expect(result.type).toBe('PRODUCT_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.product_name).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// RESERVATION_STATUS_CARD 테스트

describe('enrichActionCard — RESERVATION_STATUS_CARD', () => {
  it('활성 예약 있음 → reservation_no·product_name·action_url 채움', async () => {
    const admin = makeAdmin({
      rental_reservations: [
        {
          id: 42,
          reservation_code: 'RES-2026-00042',
          status: 'confirmed',
          product_id: 'prod-child-uuid',
        },
      ],
      products: [
        // 자식 상품 조회 (parent_product_id 없음 — 직접 부모 상품인 경우로 테스트)
        {
          name: '캐논 R5 미러리스',
          parent_product_id: null,
        },
      ],
    })

    const result = await enrichActionCard(
      'RESERVATION_STATUS_CARD',
      USER_ID,
      GENERAL_CTX,
      admin,
    )

    expect(result.type).toBe('RESERVATION_STATUS_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.reservation_id).toBe('42')
    expect(result.reservation_no).toBe('RES-2026-00042')
    expect(result.product_name).toBe('캐논 R5 미러리스')
    expect(result.action_url).toBe('/account/reservations')
  })

  it('활성 예약 없음 → 기본 페이로드 반환', async () => {
    const admin = makeAdmin({
      rental_reservations: [],  // null 반환
      products: [],
    })

    const result = await enrichActionCard(
      'RESERVATION_STATUS_CARD',
      USER_ID,
      GENERAL_CTX,
      admin,
    )

    expect(result.type).toBe('RESERVATION_STATUS_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.reservation_no).toBeUndefined()
    expect(result.product_name).toBeUndefined()
  })

  it('자식 상품(parent_product_id 있음) → 부모 product_name 사용', async () => {
    const admin = makeAdmin({
      rental_reservations: [
        {
          id: 7,
          reservation_code: 'RES-2026-00007',
          status: 'in_use',
          product_id: 'child-prod-uuid',
        },
      ],
      products: [
        // 1차: 자식 상품
        { name: '캐논 R5 #2호기', parent_product_id: 'parent-prod-uuid' },
        // 2차: 부모 상품
        { name: '캐논 R5 미러리스' },
      ],
    })

    const result = await enrichActionCard(
      'RESERVATION_STATUS_CARD',
      USER_ID,
      GENERAL_CTX,
      admin,
    )

    expect(result.product_name).toBe('캐논 R5 미러리스')  // 부모 이름
  })

  it('DB 조회 실패(예외) → 기본 페이로드로 폴백', async () => {
    const brokenAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        in:     vi.fn().mockReturnThis(),
        order:  vi.fn().mockReturnThis(),
        limit:  vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockRejectedValue(new Error('Network timeout')),
      }),
    } as unknown as SupabaseClient

    const result = await enrichActionCard(
      'RESERVATION_STATUS_CARD',
      USER_ID,
      GENERAL_CTX,
      brokenAdmin,
    )

    expect(result.type).toBe('RESERVATION_STATUS_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.reservation_no).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 미지원 타입 — 기본 페이로드 반환

describe('enrichActionCard — 미지원 타입', () => {
  it('PAYMENT_REQUEST_CARD → type + is_expired:false만 반환', async () => {
    const admin = makeAdmin({})

    const result = await enrichActionCard('PAYMENT_REQUEST_CARD', USER_ID, GENERAL_CTX, admin)

    expect(result.type).toBe('PAYMENT_REQUEST_CARD')
    expect(result.is_expired).toBe(false)
    expect(result.product_name).toBeUndefined()
  })
})
