// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ContractTemplatePanel from '$lib/components/cms/ContractTemplatePanel.svelte'

/**
 * 계약서 양식 패널 — 편집 영역 높이 조절 손잡이(.ct-grow) 안전장치 (2026-10-17)
 * 핵심: 손잡이를 넣어도 ① 폼 중첩 금지 규칙(액션 줄은 폼 밖 형제) ② 저장 폼 제출 ③ 기본 상태 레이아웃이 그대로여야 한다.
 */
let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}
const EMPTY_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
const EMPTY_RECTS = Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects = () => EMPTY_RECTS
Range.prototype.getBoundingClientRect = () => EMPTY_RECT
Element.prototype.getClientRects = () => EMPTY_RECTS

// jsdom은 레이아웃이 없어 모든 크기가 0이다 → 편집 영역(.editor-layout)만 "화면 높이에 맞춘 500px, 고정 높이를 주면 그 값"으로 흉내 낸다
const FIT_H = 500
const realRect = Element.prototype.getBoundingClientRect
Element.prototype.getBoundingClientRect = function (this: Element) {
  if (this.classList?.contains('editor-layout')) {
    const h = parseFloat((this as HTMLElement).style.height) || FIT_H
    return { ...EMPTY_RECT, height: h, bottom: h } as DOMRect
  }
  return realRect.call(this)
}
// 크기 변화 감지기 흉내 — 테스트가 직접 알림을 보낸다(실제 브라우저에서는 편집 영역 크기가 바뀔 때 자동 호출)
const roCallbacks = new Set<() => void>()
class FakeResizeObserver {
  private cb: () => void
  constructor(cb: () => void) { this.cb = cb }
  observe() { roCallbacks.add(this.cb) }
  disconnect() { roCallbacks.delete(this.cb) }
  unobserve() {}
}
const notifyResize = () => { flushSync(); roCallbacks.forEach((cb) => cb()); flushSync() } // 먼저 화면 반영 → 그 크기를 읽어 알림

beforeEach(() => {
  roCallbacks.clear()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  target = document.createElement('div')
  document.body.appendChild(target)
  // 패널이 마운트 때 부르는 보조 요청(서명·직인 자산 목록 등)은 빈 응답으로
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ assets: [], items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

async function openFlowMode() {
  app = mount(ContractTemplatePanel, { target, props: { template: null, onclose: () => {}, onsaved: () => {} } })
  flushSync()
  // 신규 작성: 모드 선택 화면에서는 손잡이가 없다
  expect(target.querySelector('.ct-grow')).toBeNull()
  // 순서가 아니라 글자로 '문서형'(흐름형) 버튼을 찾는다
  const flowBtn = [...target.querySelectorAll<HTMLButtonElement>('.mode-buttons button')].find((b) => b.textContent?.includes('문서형'))
  expect(flowBtn, "'문서형' 모드 버튼").toBeTruthy()
  flowBtn!.click()
  const deadline = Date.now() + 5000
  while (!target.querySelector('.ct-grow') && Date.now() < deadline) await wait(20)
  expect(target.querySelector('.ct-grow'), '문서형 선택 후 높이 손잡이(.ct-grow)가 나타나야 한다').toBeTruthy()
}
const grip = () => target.querySelector<HTMLElement>('.ct-grow')!
const press = (key: string) => grip().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

describe('계약서 양식 패널 — 편집 영역 높이 손잡이', () => {
  it('구조: 손잡이는 저장 폼 안, 저장·삭제 버튼 줄(.panel-actions)은 폼 밖 형제(폼 중첩 금지 규칙 유지)', async () => {
    await openFlowMode()
    const form = target.querySelector('form#tpl-form')!
    expect(form).toBeTruthy()
    expect(form.contains(grip())).toBe(true)
    const actions = target.querySelector('.panel-actions')!
    expect(actions).toBeTruthy()
    expect(form.contains(actions)).toBe(false)
    expect(actions.parentElement).toBe(form.parentElement) // 폼의 형제
    expect(form.querySelectorAll('form').length).toBe(0) // 중첩 폼 없음
  })

  it('기본 상태는 기존 레이아웃 그대로(ct-grown·고정 높이 없음), 접근성 값은 현재 편집 영역 높이를 따라간다', async () => {
    await openFlowMode()
    expect(target.querySelector('.template-panel')!.classList.contains('ct-grown')).toBe(false)
    expect(target.querySelector<HTMLElement>('.editor-layout')!.getAttribute('style') ?? '').not.toContain('height')
    expect(grip().getAttribute('role')).toBe('separator')
    expect(grip().getAttribute('aria-valuenow')).toBe(String(FIT_H)) // 키우기 전에도 값이 있다(화면 높이 맞춤 상태의 실측 높이)
    expect(grip().getAttribute('aria-valuemin')).toBe('240')
    expect(grip().getAttribute('aria-valuemax')).toBe('4000')
  })

  it('방향키: ↓ +40씩 · ↑ -40씩 · 최소 240/최대 4000에서 멈춤 · Home·더블클릭으로 원래대로, 접근성 값이 따라간다', async () => {
    await openFlowMode()
    const panel = target.querySelector('.template-panel')!
    const layout = target.querySelector<HTMLElement>('.editor-layout')!
    press('ArrowDown') // 500 → 540
    notifyResize()
    expect(panel.classList.contains('ct-grown')).toBe(true)
    expect(layout.style.height).toBe('540px')
    expect(['none', '0 0 auto']).toContain(layout.style.flex) // jsdom은 flex:none을 '0 0 auto'로 풀어 쓴다
    expect(grip().getAttribute('aria-valuenow')).toBe('540')
    press('ArrowDown') // 540 → 580
    notifyResize()
    expect(layout.style.height).toBe('580px')
    press('ArrowUp') // 580 → 540
    notifyResize()
    expect(layout.style.height).toBe('540px')
    for (let i = 0; i < 20; i++) { press('ArrowUp'); notifyResize() } // 최소 240에서 멈춤
    expect(layout.style.height).toBe('240px')
    expect(grip().getAttribute('aria-valuemin')).toBe('240')
    for (let i = 0; i < 120; i++) { press('ArrowDown'); notifyResize() } // 최대 4000에서 멈춤
    expect(layout.style.height).toBe('4000px')
    press('Home')
    notifyResize()
    expect(panel.classList.contains('ct-grown')).toBe(false)
    expect(layout.style.height).toBe('')
    expect(grip().getAttribute('aria-valuenow')).toBe(String(FIT_H))
    press('ArrowDown')
    notifyResize()
    expect(panel.classList.contains('ct-grown')).toBe(true)
    grip().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    notifyResize()
    expect(panel.classList.contains('ct-grown')).toBe(false)
  })

  it('손잡이에서 누른 Enter·Space 같은 키는 처리하지 않고 폼도 제출하지 않는다', async () => {
    await openFlowMode()
    const form = target.querySelector<HTMLFormElement>('form#tpl-form')!
    const submit = vi.fn((e: Event) => e.preventDefault())
    form.addEventListener('submit', submit)
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    grip().dispatchEvent(enter)
    flushSync()
    expect(enter.defaultPrevented).toBe(false) // 손잡이가 Enter를 가로채지 않는다
    expect(submit).not.toHaveBeenCalled()
    expect(target.querySelector('.template-panel')!.classList.contains('ct-grown')).toBe(false)
  })
})
