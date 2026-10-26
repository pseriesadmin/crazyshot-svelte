// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import CardPaymentButtons from '$lib/components/account/CardPaymentButtons.svelte'

/** 카드영수증 보기 / 카드 취소내역 보기 — 버튼 노출 조건과 상세창 동작. 실행: npm run test:component (2026-10-26) */
let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

type Pay = { receiptUrl: string | null; cancelled: boolean; partial: boolean; cancelDetail: boolean }
const RECEIPT = 'https://dashboard.tosspayments.com/receipt/redirection?transactionId=x&ref=PX'
const paid: Pay = { receiptUrl: RECEIPT, cancelled: false, partial: false, cancelDetail: false }
const cancelled: Pay = { receiptUrl: RECEIPT, cancelled: true, partial: false, cancelDetail: true }
const partial: Pay = { receiptUrl: RECEIPT, cancelled: false, partial: true, cancelDetail: true }

function render(mode: 'rental' | 'cancel', payment: Pay | null, cancelling = false) {
  cmp = mount(CardPaymentButtons, { target: document.body, props: { reservationId: 10, payment, mode, cancelling } })
  flushSync()
  return Array.from(document.body.querySelectorAll('button')).map(b => b.textContent?.trim())
}

describe('CardPaymentButtons — 노출 조건', () => {
  it('대여 탭: 결제완료 카드는 [카드영수증 보기]만', () => {
    expect(render('rental', paid)).toEqual(['카드영수증 보기'])
  })
  it('결제 정보가 없으면(신청대기 등) 아무 버튼도 없다', () => {
    expect(render('rental', null)).toEqual([])
  })
  it('영수증 주소가 없으면 영수증 버튼은 숨김', () => {
    expect(render('rental', { ...paid, receiptUrl: null })).toEqual([])
  })
  it('대여 탭 부분취소: 영수증 + 부분취소 칩 + [카드 취소내역 보기]', () => {
    const buttons = render('rental', partial)
    expect(buttons).toEqual(['카드영수증 보기', '카드 취소내역 보기'])
    expect(document.body.querySelector('.pay-chip')?.textContent?.trim()).toBe('부분취소')
  })
  it('취소중(환불 완료 전) 카드: 영수증 + 비활성 [카드 취소내역 보기]', () => {
    expect(render('rental', paid, true)).toEqual(['카드영수증 보기', '카드 취소내역 보기'])
    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes('취소내역')) as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(true)
    expect(cancelBtn.getAttribute('aria-disabled')).toBe('true')
  })
  it('취소중이어도 결제가 없으면 취소내역 버튼은 없고, 환불 완료(취소내역 가능) 후에는 활성', () => {
    expect(render('rental', null, true)).toEqual([])
    unmount(cmp as Record<string, unknown>); cmp = null; document.body.innerHTML = ''
    render('rental', cancelled, true)
    const cancelBtn = Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes('취소내역')) as HTMLButtonElement
    expect(cancelBtn.disabled).toBe(false)
  })
  it('취소 탭: 취소 결제는 [카드 취소내역 보기]만(영수증 버튼 없음), 취소 아닌 결제는 버튼 없음', () => {
    expect(render('cancel', cancelled)).toEqual(['카드 취소내역 보기'])
    unmount(cmp as Record<string, unknown>); cmp = null; document.body.innerHTML = ''
    expect(render('cancel', paid)).toEqual([])
  })
})

describe('CardPaymentButtons — 동작', () => {
  it('영수증 버튼은 새 창(noopener)으로 매출전표 주소를 연다', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render('rental', paid)
    ;(document.body.querySelector('.pay-btn') as HTMLButtonElement).click()
    expect(open).toHaveBeenCalledWith(RECEIPT, '_blank', 'noopener,noreferrer')
  })

  it('취소내역 버튼 → 조회 후 상세창에 상태·환불 금액 표시, ✕로 닫힘', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, detail: { status: '승인취소', cancelledAt: '2026-10-20T01:02:00+09:00', cancelAmount: 45000, balanceAmount: 0, receiptUrl: RECEIPT, source: 'toss' } }),
    }))
    render('cancel', cancelled)
    ;(document.body.querySelector('.pay-btn') as HTMLButtonElement).click()
    flushSync()
    await new Promise(r => setTimeout(r, 0))
    flushSync()
    const text = document.body.textContent ?? ''
    expect(text).toContain('승인취소')
    expect(text).toContain('45,000원')
    expect(text).not.toContain('취소 사유')
    expect(text).toContain('카드 매출전표 보기')
    ;(document.body.querySelector('.cd-close') as HTMLButtonElement).click()
    flushSync()
    expect(document.body.querySelector('.cd-modal')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('조회 실패 시 오류 문구를 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: '카드 취소 내역이 없습니다.' }) }))
    render('cancel', cancelled)
    ;(document.body.querySelector('.pay-btn') as HTMLButtonElement).click()
    flushSync()
    await new Promise(r => setTimeout(r, 0))
    flushSync()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('카드 취소 내역이 없습니다.')
    vi.unstubAllGlobals()
  })
})
