import { describe, it, expect } from 'vitest'
import { loadPaymentReceipts, pickCardPayment } from '$lib/server/account/loadPaymentReceipts'

/** 마이페이지 카드 영수증 로더 — 직접 매칭·같은 주문 형제 매칭·본인 결제만·fail-soft·최소 정보 (2026-10-26) */

const RECEIPT = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=x&ref=PX'
interface Tx { reservation_id: number; user_id: string; status: string; created_at: string; toss_response: unknown; paid_amount?: number }
interface Item { reservation_id: number; order_id: number }

function client(txs: Tx[], items: Item[], opts: { failTx?: boolean } = {}) {
  return {
    from(name: string) {
      const filters: Array<[string, unknown]> = []
      let inCol: [string, unknown[]] | null = null
      const rows = (): unknown[] => {
        if (opts.failTx && name === 'payment_transactions') throw new Error('db down')
        let r: Array<Record<string, unknown>> = name === 'payment_transactions' ? txs.map(t => ({ ...t })) : items.map(i => ({ ...i }))
        for (const [k, v] of filters) r = r.filter(x => x[k] === v)
        if (inCol) { const [k, vals] = inCol; r = r.filter(x => vals.includes(x[k])) }
        return r
      }
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q },
        in: (k: string, vals: unknown[]) => { inCol = [k, vals]; return q },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          try { return Promise.resolve(res({ data: rows(), error: null })) } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e) }
        },
      }
      return q
    },
  } as never
}

const tx = (reservation_id: number, status = 'done', user_id = 'u1'): Tx => ({
  reservation_id, user_id, status, created_at: '2026-10-20T00:00:00Z',
  toss_response: { receipt: { url: RECEIPT }, secret: 'ps_secret' },
})

describe('loadPaymentReceipts', () => {
  it('직접 매칭: 결제 행이 있는 예약만 맵에 들어가고 최소 정보만 담긴다', async () => {
    const map = await loadPaymentReceipts(client([tx(1)], []), 'u1', [1, 2])
    expect([...map.keys()]).toEqual(['1'])
    expect(map.get('1')).toEqual({ receiptUrl: RECEIPT, cancelled: false, partial: false, cancelDetail: false })
    expect(JSON.stringify([...map.values()])).not.toContain('ps_secret')
  })

  it('같은 주문 형제 예약에 결제 행이 붙어 있으면 이 예약도 같은 결제 정보', async () => {
    const items: Item[] = [{ reservation_id: 1, order_id: 9 }, { reservation_id: 2, order_id: 9 }]
    const map = await loadPaymentReceipts(client([tx(1)], items), 'u1', [2])
    expect(map.get('2')?.receiptUrl).toBe(RECEIPT)
  })

  it('다른 주문의 결제는 가져오지 않는다', async () => {
    const items: Item[] = [{ reservation_id: 1, order_id: 9 }, { reservation_id: 2, order_id: 10 }]
    const map = await loadPaymentReceipts(client([tx(1)], items), 'u1', [2])
    expect(map.size).toBe(0)
  })

  it('타인 결제는 가져오지 않는다(user_id 조건)', async () => {
    const map = await loadPaymentReceipts(client([tx(1, 'done', 'other')], []), 'u1', [1])
    expect(map.size).toBe(0)
  })

  it('취소·부분취소 상태는 취소내역 버튼 대상', async () => {
    const map = await loadPaymentReceipts(client([tx(1, 'cancelled'), tx(2, 'partial_cancelled')], []), 'u1', [1, 2])
    expect(map.get('1')).toMatchObject({ cancelled: true, cancelDetail: true })
    expect(map.get('2')).toMatchObject({ partial: true, cancelDetail: true })
  })

  it('더 최신인 결제 실패·대기 행이 있어도 완료된 결제의 영수증을 쓴다', async () => {
    const done = tx(1, 'done'); done.created_at = '2026-10-20T00:00:00Z'
    const failed = { ...tx(1, 'failed'), created_at: '2026-10-21T00:00:00Z', toss_response: null }
    const map = await loadPaymentReceipts(client([done, failed], []), 'u1', [1])
    expect(map.get('1')?.receiptUrl).toBe(RECEIPT)
    const onlyPending = await loadPaymentReceipts(client([{ ...tx(2, 'pending'), toss_response: null }], []), 'u1', [2])
    expect(onlyPending.get('2')?.receiptUrl).toBeNull()
  })

  it('조회 오류는 빈 맵(목록 표시를 막지 않음)', async () => {
    expect((await loadPaymentReceipts(client([tx(1)], [], { failTx: true }), 'u1', [1])).size).toBe(0)
  })

  it('예약 id 가 없으면 조회하지 않고 빈 맵', async () => {
    expect((await loadPaymentReceipts(client([tx(1)], []), 'u1', [])).size).toBe(0)
  })
})

describe('pickCardPayment — 카드(그룹)당 결제 정보 1개', () => {
  it('묶인 예약 중 결제 정보가 있는 첫 번째를 고른다', async () => {
    const map = await loadPaymentReceipts(client([tx(2)], []), 'u1', [1, 2])
    expect(pickCardPayment(['1', '2'], map)?.receiptUrl).toBe(RECEIPT)
    expect(pickCardPayment(['1'], map)).toBeNull()
  })
})
