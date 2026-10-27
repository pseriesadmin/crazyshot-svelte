// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'

/** 단계 배지를 누르면 배지 줄 아래에 설명 텍스트가 나온다(고객 화면, details 가 있을 때만) — 실행: npm run test:component (2026-10-26) */
let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
})

const details = {
  hold: ['예약신청이 접수되었어요.', '신청일: 2026-10-26'],
  confirmed: ['전자계약 서명과 결제가 완료되어 예약이 확정되었어요.'],
  shipped: ['배송이 시작되었어요.', '택배사: 두발히어로', '운송장 번호: TEST-QA-1026'],
}

function render(props: Record<string, unknown>) {
  cmp = mount(RentalJourneyStepper, { target: document.body, props: { status: 'confirmed', slim: true, fluid: true, ...props } })
  flushSync()
  return document.body
}
const badge = (body: HTMLElement, label: string) => body.querySelector(`[aria-label="${label}"]`) as HTMLElement

describe('RentalJourneyStepper — 단계 배지 설명(details)', () => {
  it('SD-1 details 가 없으면 배지는 버튼이 아니고 설명 영역도 없다(기존 동작)', () => {
    const body = render({})
    expect(body.querySelectorAll('button.step-circle')).toHaveLength(0)
    expect(body.querySelector('.step-info')).toBeNull()
  })

  it('SD-2 details 가 있는 단계만 버튼이 되고 처음에는 아무것도 선택되지 않는다', () => {
    const body = render({ details })
    expect(badge(body, '반출중').tagName).toBe('BUTTON')
    expect(badge(body, '반출중').getAttribute('aria-pressed')).toBe('false')
    expect(badge(body, '대여중').tagName).toBe('DIV') // details 없는 단계
    expect(body.querySelector('.step-info')).toBeNull()
  })

  it('SD-3 반출중 배지를 누르면 배지 줄 아래에 택배사·운송장 번호가 나오고, 다시 누르면 닫힌다', () => {
    const body = render({ details })
    badge(body, '반출중').click()
    flushSync()
    const info = body.querySelector('.step-info') as HTMLElement
    expect(info).not.toBeNull()
    expect(info.textContent).toContain('택배사: 두발히어로')
    expect(info.textContent).toContain('운송장 번호: TEST-QA-1026')
    expect(badge(body, '반출중').getAttribute('aria-pressed')).toBe('true')
    // 설명은 배지 줄(.stepper-scroll) 뒤에 위치한다
    const scroll = body.querySelector('.stepper-scroll') as HTMLElement
    expect(scroll.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    badge(body, '반출중').click()
    flushSync()
    expect(body.querySelector('.step-info')).toBeNull()
  })

  it('SD-4 다른 배지를 누르면 선택이 바뀐다', () => {
    const body = render({ details })
    badge(body, '반출중').click(); flushSync()
    badge(body, '계약완료').click(); flushSync()
    const info = body.querySelector('.step-info') as HTMLElement
    expect(info.textContent).toContain('예약이 확정되었어요')
    expect(info.textContent).not.toContain('운송장 번호')
    expect(badge(body, '반출중').getAttribute('aria-pressed')).toBe('false')
    expect(badge(body, '계약완료').getAttribute('aria-pressed')).toBe('true')
  })

  it('SD-5 장바구니(draft) 배지는 선택 대상이 아니다', () => {
    const body = render({ status: 'draft', details: { hold: ['x'] } })
    expect(badge(body, '장바구니').tagName).toBe('DIV')
  })
})
