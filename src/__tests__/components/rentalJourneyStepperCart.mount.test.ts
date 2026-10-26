// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'

/** 장바구니에 담긴 임시예약(draft)은 맨 앞 '장바구니' 원형 배지가 현재 단계 — 실행: npm run test:component (2026-10-26) */
let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
})
function render(status: string) {
  cmp = mount(RentalJourneyStepper, { target: document.body, props: { status, slim: true, fluid: true } })
  flushSync()
  return document.body
}
const labels = (body: HTMLElement) => Array.from(body.querySelectorAll('.step-circle')).map((c) => c.getAttribute('aria-label'))

describe('RentalJourneyStepper — 장바구니 배지', () => {
  it('draft: 맨 앞에 장바구니 배지가 있고 그 배지만 현재 단계(활성)이며 예약대기는 아직 지나지 않은 단계다', () => {
    const body = render('draft')
    expect(labels(body)).toEqual(['장바구니', '예약대기', '계약완료', '반출중', '대여중', '반납중', '반납완료'])
    const items = Array.from(body.querySelectorAll('.step-item'))
    expect(items[0].classList.contains('active')).toBe(true)
    expect(items.filter((i) => i.classList.contains('active')).length).toBe(1)
    expect(items.filter((i) => i.classList.contains('done')).length).toBe(0)
    // 현재 단계 오른쪽 화살표는 물결 모션
    expect(body.querySelectorAll('.wave-arrow').length).toBe(1)
    expect(body.querySelector('.step-connector .wave-arrow')).not.toBeNull()
  })
  it('hold(예약신청 이후)에는 장바구니 배지가 없고 기존 단계 흐름 그대로', () => {
    const body = render('hold')
    expect(labels(body)).toEqual(['예약신청', '계약완료', '반출중', '대여중', '반납중', '반납완료'])
    expect(body.querySelector('.step-item.active .step-circle')?.getAttribute('aria-label')).toBe('예약신청')
  })
})
