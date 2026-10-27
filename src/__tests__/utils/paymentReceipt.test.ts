import { describe, it, expect } from 'vitest'
import { safeReceiptUrl, extractReceiptInfo, buildCancelDetail, isCancelDetailAvailable } from '$lib/utils/paymentReceipt'
import { summarizeTossPayment } from '$lib/utils/pgCancelStatus'

const RECEIPT = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=abc&ref=PX'
const tx = (over: Record<string, unknown> = {}) => ({
  status: 'done',
  total_amount: 50000,
  paid_amount: 45000,
  toss_response: { receipt: { url: RECEIPT }, secret: 'ps_secret_xx', card: { number: '4330********123*' }, paymentKey: 'pk_live_1' },
  ...over,
})

describe('safeReceiptUrl — 토스 도메인만 허용', () => {
  it('토스 영수증 주소는 통과', () => {
    expect(safeReceiptUrl(RECEIPT)).toBe(RECEIPT)
  })
  it('다른 도메인·유사 도메인·http·javascript·빈 값·비문자열은 거절', () => {
    for (const bad of [
      'https://evil.com/receipt', 'https://tosspayments.com.evil.com/x', 'https://eviltosspayments.com/x',
      'http://dashboard.tosspayments.com/x', 'https://user:pw@dashboard.tosspayments.com/x', 'https://dashboard.tosspayments.com:8443/x', 'https://tosspayments.com@evil.com/x', 'javascript:alert(1)', 'data:text/html,hi', '', null, undefined, 123, {},
    ]) expect(safeReceiptUrl(bad)).toBeNull()
  })
})

describe('extractReceiptInfo — 최소 정보만 반환', () => {
  it('결제 행이 없으면 null(버튼 숨김)', () => {
    expect(extractReceiptInfo(null)).toBeNull()
    expect(extractReceiptInfo(undefined)).toBeNull()
  })
  it('결제완료 건: 영수증 주소만, 취소·부분취소 아님', () => {
    expect(extractReceiptInfo(tx())).toEqual({ receiptUrl: RECEIPT, cancelled: false, partial: false })
  })
  it('취소·부분취소 상태 반영', () => {
    expect(extractReceiptInfo(tx({ status: 'cancelled' }))).toMatchObject({ cancelled: true, partial: false })
    expect(extractReceiptInfo(tx({ status: 'partial_cancelled' }))).toMatchObject({ cancelled: false, partial: true })
  })
  it('영수증 주소가 없거나 허용 도메인이 아니면 receiptUrl null', () => {
    expect(extractReceiptInfo(tx({ toss_response: {} }))?.receiptUrl).toBeNull()
    expect(extractReceiptInfo(tx({ toss_response: { receipt: { url: 'https://evil.com/r' } } }))?.receiptUrl).toBeNull()
    expect(extractReceiptInfo(tx({ toss_response: null }))?.receiptUrl).toBeNull()
  })
  it('반환값에 secret·결제키·카드정보가 없다', () => {
    const json = JSON.stringify(extractReceiptInfo(tx()))
    for (const leak of ['ps_secret_xx', 'pk_live_1', '4330', 'secret', 'paymentKey', 'card']) expect(json).not.toContain(leak)
  })
})

describe('buildCancelDetail', () => {
  it('토스 전액취소 요약 → 승인취소·시각·금액·사유', () => {
    const toss = summarizeTossPayment({
      status: 'CANCELED', totalAmount: 45000,
      cancels: [{ cancelAmount: 45000, canceledAt: '2026-10-20T01:02:03+09:00', cancelReason: '고객 요청', cancelStatus: 'DONE' }],
    })
    const d = buildCancelDetail(tx({ status: 'cancelled' }), toss)
    expect(d).toMatchObject({ status: '승인취소', cancelAmount: 45000, balanceAmount: 0, source: 'toss', receiptUrl: RECEIPT })
    expect(d.cancelledAt).toBe('2026-10-20T01:02:03+09:00')
  })
  it('토스 부분취소 요약 → 부분취소·잔액', () => {
    const toss = summarizeTossPayment({
      status: 'PARTIAL_CANCELED', totalAmount: 45000,
      cancels: [{ cancelAmount: 10000, canceledAt: '2026-10-20T01:02:03+09:00', cancelStatus: 'DONE' }],
    })
    expect(buildCancelDetail(tx({ status: 'partial_cancelled' }), toss)).toMatchObject({ status: '부분취소', cancelAmount: 10000, balanceAmount: 35000 })
  })
  it('토스 조회 실패(요약 없음) → DB 값으로 대체', () => {
    const d = buildCancelDetail(tx({ status: 'cancelled', pg_cancelled_at: '2026-10-20T00:00:00Z', cancel_reason: '단순 변심' }), null)
    expect(d).toMatchObject({ status: '승인취소', cancelAmount: 45000, balanceAmount: 0, source: 'db', cancelledAt: '2026-10-20T00:00:00Z' })
  })
  it('DB 대체 시 결제 금액(paid_amount)이 비어 있으면 총액으로 대신하지 않고 금액 없음(null)', () => {
    const d = buildCancelDetail(tx({ status: 'cancelled', paid_amount: null, total_amount: 50000 }), null)
    expect(d.cancelAmount).toBeNull()
  })
  it('토스가 아직 취소 상태가 아니라고 답해도 DB 값으로 대체(source=db)', () => {
    const toss = summarizeTossPayment({ status: 'DONE', totalAmount: 45000 })
    expect(buildCancelDetail(tx({ status: 'cancelled' }), toss).source).toBe('db')
  })
  it('취소 사유는 고객 응답에 싣지 않는다(토스 사유·DB 사유 모두)', () => {
    const toss = summarizeTossPayment({ status: 'CANCELED', totalAmount: 45000, cancels: [{ cancelAmount: 45000, canceledAt: '2026-10-20T01:02:03+09:00', cancelReason: '내부 메모 문구', cancelStatus: 'DONE' }] })
    for (const d of [buildCancelDetail(tx({ status: 'cancelled', cancel_reason: '내부 메모 문구' }), toss), buildCancelDetail(tx({ status: 'cancelled', cancel_reason: '내부 메모 문구' }), null)]) {
      expect(JSON.stringify(d)).not.toContain('내부 메모 문구')
      expect(Object.keys(d)).not.toContain('reason')
    }
  })
  it('결과에 secret·결제키·카드정보가 없다', () => {
    const json = JSON.stringify(buildCancelDetail(tx({ status: 'cancelled' }), null))
    for (const leak of ['ps_secret_xx', 'pk_live_1', '4330', 'paymentKey']) expect(json).not.toContain(leak)
  })
})

describe('isCancelDetailAvailable', () => {
  it('취소·부분취소 결제만 true', () => {
    expect(isCancelDetailAvailable(tx({ status: 'cancelled' }))).toBe(true)
    expect(isCancelDetailAvailable(tx({ status: 'partial_cancelled' }))).toBe(true)
    expect(isCancelDetailAvailable(tx())).toBe(false)
    expect(isCancelDetailAvailable(null)).toBe(false)
  })
})
