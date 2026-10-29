// @vitest-environment jsdom
// src/__tests__/components/rentalJourneyStepperReturnRequested.mount.test.ts
// return_requested 상태에서 두발히어로 5단계 펼침 동작 검증
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
import type { DheroStageInfo } from '$lib/utils/dheroJourneyStage'

let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null }
  document.body.innerHTML = ''
})

function renderReturn(overrides: Record<string, unknown> = {}) {
  cmp = mount(RentalJourneyStepper, {
    target: document.body,
    props: { status: 'return_requested', slim: true, fluid: true, ...overrides },
  })
  flushSync()
  return document.body
}

function renderShipped(overrides: Record<string, unknown> = {}) {
  cmp = mount(RentalJourneyStepper, {
    target: document.body,
    props: { status: 'shipped', slim: true, fluid: true, ...overrides },
  })
  flushSync()
  return document.body
}

const RETURN_STAGE: DheroStageInfo = { index: 1, label: '수거완료', tone: 'normal' }
const RETURN_DANGER: DheroStageInfo = { index: 4, label: '반송완료', tone: 'danger' }

describe('RentalJourneyStepper return_requested — dhero 토글 표시', () => {
  it('status=return_requested + dheroStage → 펼침 토글(aria-expanded) 표시', () => {
    const body = renderReturn({ dheroStage: RETURN_STAGE })
    expect(body.querySelector('[aria-expanded]')).toBeTruthy()
  })

  it('status=return_requested + dheroStage=null → 토글 없음', () => {
    const body = renderReturn({ dheroStage: null })
    expect(body.querySelector('[aria-expanded]')).toBeNull()
  })

  it('status=return_requested → shipped 단계에 토글 없음 (반납중 단계에만 붙어야 함)', () => {
    // shipped 스텝은 return_requested 보다 앞 단계 — 거기에 토글이 생기면 안 됨
    const body = renderReturn({ dheroStage: RETURN_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement | null
    expect(toggle).toBeTruthy()
    // 토글 버튼의 텍스트가 '반납중'이어야 함 (shipped '반출중' 아님)
    expect(toggle!.textContent?.replace(/\s/g, '')).toContain('반납')
  })

  it('status=shipped + dheroStage → 기존 동작 그대로 (회귀 방지)', () => {
    const body = renderShipped({ dheroStage: RETURN_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement | null
    expect(toggle).toBeTruthy()
    // shipped 토글은 '반출중' 텍스트
    expect(toggle!.textContent?.replace(/\s/g, '')).toContain('반출')
  })
})

describe('RentalJourneyStepper return_requested — aria-label 구분', () => {
  it('return_requested 토글 aria-label에 "반납" 포함', () => {
    const body = renderReturn({ dheroStage: RETURN_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement
    expect(toggle.getAttribute('aria-label') ?? '').toContain('반납')
  })

  it('shipped 토글 aria-label에 "배송" 포함 (회귀 방지)', () => {
    const body = renderShipped({ dheroStage: RETURN_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement
    expect(toggle.getAttribute('aria-label') ?? '').toContain('배송')
  })

  it('return_requested 서브배지 aria-label에 "반납" 포함', () => {
    const body = renderReturn({ dheroStage: RETURN_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    const subs = Array.from(body.querySelectorAll('.dhero-sub-circle'))
    expect(subs.length).toBe(5)
    for (const sub of subs) {
      expect(sub.getAttribute('aria-label') ?? '').toContain('반납')
    }
  })

  it('shipped 서브배지 aria-label에 "배송" 포함 (회귀 방지)', () => {
    const body = renderShipped({ dheroStage: RETURN_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    const subs = Array.from(body.querySelectorAll('.dhero-sub-circle'))
    for (const sub of subs) {
      expect(sub.getAttribute('aria-label') ?? '').toContain('배송')
    }
  })
})

describe('RentalJourneyStepper return_requested — 펼침/접힘', () => {
  it('토글 클릭 → 5개 서브배지 표시', () => {
    const body = renderReturn({ dheroStage: RETURN_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    expect(body.querySelectorAll('.dhero-sub-circle').length).toBe(5)
  })

  it('danger tone → 서브배지에 data-tone="danger" (index 4 기준)', () => {
    const body = renderReturn({ dheroStage: RETURN_DANGER })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    const badge = body.querySelector(`.dhero-sub-circle[style*="--si: 4"]`) as HTMLElement | null
    expect(badge?.getAttribute('data-tone')).toBe('danger')
  })

  it('서브배지 클릭 → 접힘 (퇴장 애니 후)', () => {
    vi.useFakeTimers()
    const body = renderReturn({ dheroStage: RETURN_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    ;(body.querySelector('.dhero-sub-circle') as HTMLElement).click()
    flushSync()
    vi.advanceTimersByTime(200)
    flushSync()
    expect(body.querySelector('.dhero-sub-circle')).toBeNull()
    expect(body.querySelector('[aria-expanded]')).toBeTruthy()
    vi.useRealTimers()
  })
})
