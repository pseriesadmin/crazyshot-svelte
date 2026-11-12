import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * sendReservationLifecyclePush 의 productNameOverride — 묶음 안내 표기가 푸시 본문·안내문장 변수·문자까지 전달된다 (2026-11-12, Stephen 지시)
 *  H1 override 가 있으면 문자 상품명·푸시 본문 모두 '대표 상품명 외 N개 상품'
 *  H2 override 가 없으면 예약 상품명 그대로(기존 동작)
 *  H3 공백뿐인 override 는 무시
 *  H4 CMS 편집 안내문장의 {{상품명}} 변수에도 같은 표기가 들어간다
 * 허브가 읽는 예약·프로필은 가짜 클라이언트로 대신하고, 문자 발송 함수는 가로채며, 푸시는 토큰이 없을 때 남기는 발송 기록(log_push_notification)의 본문으로 확인한다(실제 발송·DB 접근 없음).
 */
const smsMock = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ sent: false, reason: 'dev' })))
const pushState = vi.hoisted(() => ({ config: null as unknown, logs: [] as Array<Record<string, unknown>> }))

vi.mock('$lib/server/sms', async (importOriginal) => {
  const orig = await importOriginal<typeof import('$lib/server/sms')>()
  return { ...orig, sendLifecycleSms: (...a: unknown[]) => smsMock(...a) }
})

// push.ts 의 getServiceClient(createClient) — 설정 행·프로필·토큰 조회를 가짜로 답하고 발송 기록 RPC 호출을 모은다
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'returns', 'order', 'limit']) q[m] = () => q
      const row = table === 'push_notification_config' ? pushState.config : table === 'user_profiles' ? { allow_rental_alert: true, full_name: '고객' } : null
      q.maybeSingle = async () => ({ data: row, error: null })
      q.single = async () => ({ data: row, error: null })
      ;(q as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: table === 'notification_tokens' ? [] : row ? [row] : [], error: null })
      return q
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'log_push_notification') pushState.logs.push(args)
      return { data: null, error: null }
    },
  }),
}))

import { sendReservationLifecyclePush } from '$lib/server/push'

function fakeAdmin() {
  const make = (table: string) => {
    const q: Record<string, unknown> = {}
    const self = () => q
    for (const m of ['select', 'eq', 'in', 'returns', 'order', 'limit', 'is', 'neq']) q[m] = self
    const row =
      table === 'rental_reservations'
        ? { user_id: 'u-1', reservation_code: 'CS1', start_date: '2026-11-11', end_date: '2026-11-12', pickup_time: '10:00', return_time: '18:00', tracking_number: null, courier_code: null, dhero_meta: null, products: { name: '카메라', parent_product_id: null } }
        : table === 'user_profiles'
          ? { phone: '01000000000', full_name: '고객' }
          : null
    q.single = async () => ({ data: row, error: null })
    q.maybeSingle = async () => ({ data: row, error: null })
    ;(q as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: table === 'user_profiles' || table === 'rental_reservations' ? [row] : [], error: null })
    return q
  }
  return { from: (t: string) => make(t), rpc: async () => ({ data: null, error: null }) }
}

const pushBody = (): string => String(pushState.logs[0]?.p_body ?? '')

beforeEach(() => {
  smsMock.mockClear()
  pushState.logs.length = 0
  pushState.config = null
})

describe('sendReservationLifecyclePush — productNameOverride', () => {
  it('H1 override 가 있으면 문자와 푸시 본문 모두 같은 표기', async () => {
    await sendReservationLifecyclePush(fakeAdmin() as never, 1, 'return_remind', { productNameOverride: '카메라 외 2개 상품' })
    expect(smsMock).toHaveBeenCalledTimes(1)
    const params = smsMock.mock.calls[0][1] as { productName: string; notifyType: string }
    expect(params.notifyType).toBe('return_remind')
    expect(params.productName).toBe('카메라 외 2개 상품')
    expect(pushBody()).toContain('카메라 외 2개 상품')
  })

  it('H2 override 가 없으면 예약 상품명 그대로', async () => {
    await sendReservationLifecyclePush(fakeAdmin() as never, 1, 'return_remind')
    expect((smsMock.mock.calls[0][1] as { productName: string }).productName).toBe('카메라')
    expect(pushBody()).toContain('카메라')
    expect(pushBody()).not.toContain('외 ')
  })

  it('H3 공백뿐인 override 는 무시한다', async () => {
    await sendReservationLifecyclePush(fakeAdmin() as never, 1, 'return_remind', { productNameOverride: '   ' })
    expect((smsMock.mock.calls[0][1] as { productName: string }).productName).toBe('카메라')
    expect(pushBody()).not.toContain('외 ')
  })

  it('H4 CMS 편집 안내문장의 {{상품명}} 에도 같은 표기가 들어간다', async () => {
    pushState.config = { push_enabled: true, category: 'customer_rental', extra_config: { message: '{{상품명}} 반납일이에요' } }
    await sendReservationLifecyclePush(fakeAdmin() as never, 1, 'return_remind', { productNameOverride: '카메라 외 1개 상품' })
    expect(pushBody()).toBe('카메라 외 1개 상품 반납일이에요')
  })
})
