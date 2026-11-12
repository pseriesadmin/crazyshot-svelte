/**
 * returnNoticeProductLabel.test.ts — 묶음 안내 상품명 표기 '대표 상품명 외 N개 상품'이 모든 채널에 같이 나간다 (2026-11-12, Stephen 지시)
 *  - return-notice 크론: 채팅카드 본문(p_content)·푸시/문자 허브(productNameOverride) 모두 같은 표기
 *  - return-remind 크론: 채팅카드 RPC(p_product_label)·푸시/문자 허브(productNameOverride) 모두 같은 표기
 *  - 단일 상품(표기에 '외'가 없음)도 그대로 전달된다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
let noticeQueue: Array<Array<Record<string, unknown>>> = []
let remindQueue: Array<Array<Record<string, unknown>>> = []
const pushMock = vi.fn(async (..._a: unknown[]): Promise<undefined> => undefined)

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 's3cret', SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'http://localhost' }))
vi.mock('$lib/server/push', () => ({
  CUSTOMER_LIFECYCLE_PUSH_COPY: { return_notice_locker: { title: 't', body: (n: string) => `${n} 반납 안내` } },
  sendPushToAdmins: vi.fn(async () => undefined),
  sendReservationLifecyclePush: (...a: unknown[]) => pushMock(...(a as [])),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'claim_return_notice_targets') return { data: noticeQueue.shift() ?? [], error: null }
      if (fn === 'get_return_remind_targets') return { data: remindQueue.shift() ?? [], error: null }
      if (fn === 'send_return_notice_card') return { data: { ok: true }, error: null }
      return { data: null, error: null }
    },
  }),
}))

import { GET as noticeGET } from '../../routes/api/cron/return-notice/+server'
import { GET as remindGET } from '../../routes/api/cron/return-remind/+server'

const req = (): never => ({ request: new Request('http://x', { headers: { authorization: 'Bearer s3cret' } }) }) as never

beforeEach(() => {
  rpcCalls.length = 0
  noticeQueue = []
  remindQueue = []
  pushMock.mockClear()
})

describe('return-notice 크론 — 묶음 표기', () => {
  it('N1 카드 본문과 푸시·문자 허브가 같은 "A 외 2개 상품" 표기를 쓴다', async () => {
    noticeQueue = [[{ reservation_id: 7, user_id: 'u', stage: 'locker_2h', return_method: 'visit', product_name: 'A 외 2개 상품', return_at: '2026-11-12T09:00:00Z' }]]
    await noticeGET(req())
    const card = rpcCalls.find((c) => c.fn === 'send_return_notice_card')
    expect(String(card?.args.p_content)).toContain('A 외 2개 상품')
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock.mock.calls[0][2]).toBe('return_notice_locker')
    expect(pushMock.mock.calls[0][3]).toEqual({ productNameOverride: 'A 외 2개 상품' })
  })

  it('N2 단일 상품은 상품명만 그대로 전달', async () => {
    noticeQueue = [[{ reservation_id: 8, user_id: 'u', stage: 'locker_2h', return_method: 'visit', product_name: 'B', return_at: '2026-11-12T09:00:00Z' }]]
    await noticeGET(req())
    expect(pushMock.mock.calls[0][3]).toEqual({ productNameOverride: 'B' })
  })
})

describe('return-remind 크론 — 묶음 표기', () => {
  it('R1 채팅카드 RPC 와 푸시·문자 허브가 같은 "A 외 1개 상품" 표기를 쓴다', async () => {
    remindQueue = [[{ reservation_id: 9, user_id: 'u', phone: '010', product_name: 'A 외 1개 상품' }]]
    await remindGET(req())
    const card = rpcCalls.find((c) => c.fn === 'send_rental_chat_notification')
    expect(card?.args.p_notify_type).toBe('return_remind')
    expect(card?.args.p_product_label).toBe('A 외 1개 상품')
    expect(pushMock.mock.calls[0][2]).toBe('return_remind')
    expect(pushMock.mock.calls[0][3]).toEqual({ productNameOverride: 'A 외 1개 상품' })
  })
})
