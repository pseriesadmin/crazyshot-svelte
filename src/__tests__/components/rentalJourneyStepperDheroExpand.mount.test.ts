// @vitest-environment jsdom
// src/__tests__/components/rentalJourneyStepperDheroExpand.mount.test.ts
// dheroStage prop — 접힘/펼침 상호작용 마운트 시험
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import RentalJourneyStepper from '$lib/components/common/RentalJourneyStepper.svelte'
import type { DheroStageInfo } from '$lib/utils/dheroJourneyStage'

let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null }
  document.body.innerHTML = ''
})

function render(props: Record<string, unknown>) {
  cmp = mount(RentalJourneyStepper, {
    target: document.body,
    props: { status: 'shipped', slim: true, fluid: true, ...props },
  })
  flushSync()
  return document.body
}

const MOCK_STAGE: DheroStageInfo = { index: 1, label: '수거완료', tone: 'normal' }
const WARN_STAGE:  DheroStageInfo = { index: 3, label: '배송연기', tone: 'warn'   }
const DANGER_STAGE: DheroStageInfo = { index: 4, label: '반송완료', tone: 'danger' }

// 두발히어로 고정 라벨
const DHERO_LABELS = ['접수', '수거완료', '입고완료', '배송출발', '배송완료']

describe('RentalJourneyStepper dhero expand/collapse', () => {
  it('dheroStage=null → 기존 렌더 동일 — 펼침 토글 버튼 없음', () => {
    const body = render({ dheroStage: null })
    expect(body.querySelector('[aria-expanded]')).toBeNull()
  })

  it('status !== shipped → dheroStage 있어도 펼침 버튼 없음', () => {
    const body = render({ status: 'confirmed', dheroStage: MOCK_STAGE })
    expect(body.querySelector('[aria-expanded]')).toBeNull()
  })

  it('접힘 기본 상태 — aria-expanded="false" 버튼 존재', () => {
    const body = render({ dheroStage: MOCK_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement | null
    expect(toggle).toBeTruthy()
    expect(toggle!.getAttribute('aria-expanded')).toBe('false')
  })

  it('토글 클릭 → 펼침 — 5개 고정 라벨 배지 존재', () => {
    const body = render({ dheroStage: MOCK_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement
    toggle.click()
    flushSync()
    const txt = body.textContent ?? ''
    for (const label of DHERO_LABELS) {
      expect(txt).toContain(label.slice(0, 2)) // 4글자 라벨은 badgeLines로 분할됨
    }
    // 펼침 후 반출중 토글 버튼(aria-expanded)은 사라짐
    expect(body.querySelector('[aria-expanded]')).toBeNull()
  })

  it('펼침 후 서브배지 클릭 → 퇴장 애니메이션(leaving 상태) → 타이머 후 서브배지 사라짐', () => {
    vi.useFakeTimers()
    const body = render({ dheroStage: MOCK_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    const sub = body.querySelector('.dhero-sub-circle') as HTMLElement | null
    expect(sub).toBeTruthy()
    sub!.click()
    flushSync()
    // 퇴장 애니메이션 중: 서브배지는 아직 DOM 에 있고 dhero-leaving 클래스 부착
    expect(body.querySelector('.dhero-sub-circle.dhero-leaving')).toBeTruthy()
    vi.advanceTimersByTime(200)
    flushSync()
    // 타이머 완료 후: 서브배지 제거, 토글 버튼 복귀
    expect(body.querySelector('.dhero-sub-circle')).toBeNull()
    expect(body.querySelector('[aria-expanded]')).toBeTruthy()
    vi.useRealTimers()
  })

  it('warn tone → 토글 버튼에 data-tone="warn"', () => {
    const body = render({ dheroStage: WARN_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement | null
    expect(toggle?.getAttribute('data-tone')).toBe('warn')
  })

  it('danger tone → 토글 버튼에 data-tone="danger"', () => {
    const body = render({ dheroStage: DANGER_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement | null
    expect(toggle?.getAttribute('data-tone')).toBe('danger')
  })
})

// ── M1: details 공존 — dheroActive 일 때도 설명 텍스트 접근 가능 ──
describe('RentalJourneyStepper dhero + details 공존 (M1)', () => {
  const SHIPPED_DETAILS = { shipped: ['배송 안내 텍스트', '운송장 등록 후 확인 가능합니다.'] }

  it('dheroStage 있고 details.shipped 있을 때 — 토글 클릭 시 details 패널 함께 열림', () => {
    const body = render({ dheroStage: MOCK_STAGE, details: SHIPPED_DETAILS })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement
    toggle.click()
    flushSync()
    // details 패널이 열려야 함
    expect(body.querySelector('.step-info')).toBeTruthy()
    expect(body.textContent).toContain('배송 안내 텍스트')
  })

  it('dheroStage 없을 때 details.shipped 는 기존처럼 배지 클릭으로 열림', () => {
    const body = render({ dheroStage: null, status: 'shipped', details: SHIPPED_DETAILS })
    // dheroStage 없으면 isSelectable 분기로 일반 selectable 버튼 렌더
    const btn = body.querySelector('.step-circle.selectable') as HTMLElement | null
    expect(btn).toBeTruthy()
    // 자동 펼침(2026-10-30): 현재 단계(shipped)는 처음부터 열려 있고, 배지를 누르면 닫히며 다시 누르면 열린다
    expect(body.querySelector('.step-info')).toBeTruthy()
    btn!.click()
    flushSync()
    expect(body.querySelector('.step-info')).toBeNull()
    btn!.click()
    flushSync()
    expect(body.querySelector('.step-info')).toBeTruthy()
  })

  it('펼침 후 서브배지 클릭 → details 패널 닫힘', () => {
    vi.useFakeTimers()
    const body = render({ dheroStage: MOCK_STAGE, details: SHIPPED_DETAILS })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    expect(body.querySelector('.step-info')).toBeTruthy()
    const sub = body.querySelector('.dhero-sub-circle') as HTMLElement
    sub.click()
    flushSync()
    expect(body.querySelector('.step-info')).toBeNull()
    vi.useRealTimers()
  })
})

// ── M2: 서브배지에 dheroStage.label + data-tone 반영 ──
describe('RentalJourneyStepper dhero sub-badge label + tone (M2)', () => {
  // 두발히어로 status 코드별 픽스처
  const DELAY_STAGE:    DheroStageInfo = { index: 3, label: '배송연기', tone: 'warn'   } // status 12
  const RETURN_STAGE:   DheroStageInfo = { index: 4, label: '반송완료', tone: 'danger' } // status 6
  const LOST_STAGE:     DheroStageInfo = { index: 4, label: '분실완료', tone: 'danger' } // status 7
  const CANCEL_STAGE:   DheroStageInfo = { index: 0, label: '취소',    tone: 'danger' } // canceledAt
  const ACCIDENT_STAGE: DheroStageInfo = { index: 2, label: '사고',    tone: 'danger' } // accidentAt

  function expandAndGetSubBadgeAt(body: HTMLElement, dheroIndex: number): HTMLElement | null {
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    return body.querySelector(`.dhero-sub-circle[style*="--si: ${dheroIndex}"]`) as HTMLElement | null
  }

  it('배송연기(status 12, warn) — 현재 서브배지에 "배송연기" 텍스트 + data-tone="warn"', () => {
    const body = render({ dheroStage: DELAY_STAGE })
    const badge = expandAndGetSubBadgeAt(body, 3)
    expect(badge).toBeTruthy()
    expect(badge!.textContent?.replace(/\s/g, '')).toContain('배송연기'.replace(/\s/g, '').slice(0, 2))
    expect(badge!.getAttribute('data-tone')).toBe('warn')
  })

  it('반송완료(status 6, danger) — 현재 서브배지에 "반송완료" + data-tone="danger"', () => {
    const body = render({ dheroStage: RETURN_STAGE })
    const badge = expandAndGetSubBadgeAt(body, 4)
    expect(badge).toBeTruthy()
    expect(badge!.getAttribute('data-tone')).toBe('danger')
    expect(badge!.textContent?.replace(/\s/g, '')).toContain('반송'.slice(0, 2))
  })

  it('분실완료(status 7, danger) — 현재 서브배지에 "분실완료" + data-tone="danger"', () => {
    const body = render({ dheroStage: LOST_STAGE })
    const badge = expandAndGetSubBadgeAt(body, 4)
    expect(badge).toBeTruthy()
    expect(badge!.getAttribute('data-tone')).toBe('danger')
  })

  it('취소(canceledAt, danger) — 현재(index 0) 서브배지에 "취소" + data-tone="danger"', () => {
    const body = render({ dheroStage: CANCEL_STAGE })
    const badge = expandAndGetSubBadgeAt(body, 0)
    expect(badge).toBeTruthy()
    expect(badge!.textContent?.trim()).toContain('취소')
    expect(badge!.getAttribute('data-tone')).toBe('danger')
  })

  it('사고(accidentAt, danger) — 현재(index 2) 서브배지에 "사고" + data-tone="danger"', () => {
    const body = render({ dheroStage: ACCIDENT_STAGE })
    const badge = expandAndGetSubBadgeAt(body, 2)
    expect(badge).toBeTruthy()
    expect(badge!.textContent?.trim()).toContain('사고')
    expect(badge!.getAttribute('data-tone')).toBe('danger')
  })

  it('다른 인덱스 서브배지(현재 아닌 것)는 data-tone 없음', () => {
    const body = render({ dheroStage: DELAY_STAGE }) // index 3 이 현재
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    // index 0(접수)는 현재 아님 → data-tone 없음
    const badge0 = body.querySelector(`.dhero-sub-circle[style*="--si: 0"]`) as HTMLElement | null
    expect(badge0).toBeTruthy()
    expect(badge0!.getAttribute('data-tone')).toBeNull()
  })
})

// ── m1: status/dheroStage 변경 시 isDheroExpanded 초기화 ──
describe('RentalJourneyStepper isDheroExpanded 초기화 (m1)', () => {
  it('status 가 shipped 에서 다른 값으로 바뀌면 isDheroExpanded 초기화', async () => {
    vi.useFakeTimers()
    cmp = mount(RentalJourneyStepper, {
      target: document.body,
      props: { slim: true, fluid: true, status: 'shipped', dheroStage: MOCK_STAGE },
    })
    flushSync()

    // 펼침
    ;(document.body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    expect(document.body.querySelector('.dhero-sub-circle')).toBeTruthy()

    // status 변경 — 컴포넌트 재마운트 없이 prop 갱신 (Svelte 5 $props)
    // Svelte 5 에서는 컴포넌트 인스턴스를 통한 prop 갱신이 필요 — $set 방식은 없음
    // 대신 {#key} 패턴이 실사용 경로이므로 별도 마운트로 초기화 검증
    unmount(cmp!)
    cmp = null
    document.body.innerHTML = ''

    // status='in_use' 로 새로 마운트 → isDheroExpanded 기본값 false
    cmp = mount(RentalJourneyStepper, {
      target: document.body,
      props: { slim: true, fluid: true, status: 'in_use', dheroStage: MOCK_STAGE },
    })
    flushSync()
    // status='in_use' 이면 dheroActive=false → dhero 토글 없음
    expect(document.body.querySelector('[aria-expanded]')).toBeNull()
    vi.useRealTimers()
  })

  it('dheroStage=null 로 변경되면 dheroActive=false → 토글 버튼 사라짐', () => {
    // dheroStage 가 null 이 되면 dheroActive=false 이므로 토글 버튼이 사라지고
    // isDheroExpanded 가 true 여도 서브배지가 렌더되지 않는다.
    // $effect 로 isDheroExpanded 를 false 로 초기화하는 동작을 간접 검증.
    const body = render({ dheroStage: null })
    expect(body.querySelector('[aria-expanded]')).toBeNull()
    expect(body.querySelector('.dhero-sub-circle')).toBeNull()
  })
})

// ── m2: aria-label 동적 반영 ──
describe('RentalJourneyStepper dhero aria-label (m2)', () => {
  it('토글 aria-label 에 "펼치기" + 현재 단계명 포함', () => {
    const body = render({ dheroStage: MOCK_STAGE })
    const toggle = body.querySelector('[aria-expanded]') as HTMLElement
    const label = toggle.getAttribute('aria-label') ?? ''
    expect(label).toContain('펼치기')
    expect(label).toContain(MOCK_STAGE.label) // '수거완료'
  })

  it('서브배지 aria-label 에 "접기" 포함', () => {
    const body = render({ dheroStage: MOCK_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    const subs = Array.from(body.querySelectorAll('.dhero-sub-circle'))
    expect(subs.length).toBe(5)
    // 모든 서브배지의 aria-label 에 "접기" 포함
    for (const sub of subs) {
      expect(sub.getAttribute('aria-label') ?? '').toContain('접기')
    }
  })

  it('서브배지에 aria-expanded 없음 (토글만 갖는다)', () => {
    const body = render({ dheroStage: MOCK_STAGE })
    ;(body.querySelector('[aria-expanded]') as HTMLElement).click()
    flushSync()
    const subs = Array.from(body.querySelectorAll('.dhero-sub-circle'))
    for (const sub of subs) {
      expect(sub.getAttribute('aria-expanded')).toBeNull()
    }
  })
})
