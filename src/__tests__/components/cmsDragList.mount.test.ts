// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync, createRawSnippet } from 'svelte'

/**
 * CmsDragList — 손잡이에서 시작한 드래그만 정렬을 시작하고, 실제로 순서가 바뀐다 (2026-10-08)
 * 회귀 배경: dragstart의 e.target이 draggable 항목 자체라 target.closest('.drag-handle')가 항상 null → 모든 목록이 끌리지 않았다.
 * 실행: npm run test:component (CS_COMPONENT_TEST=1)
 */
const { default: CmsDragList } = await import('$lib/components/cms/CmsDragList.svelte')

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
const onreorder = vi.fn()

beforeEach(() => {
  onreorder.mockReset()
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => { if (app) unmount(app); app = null; target.remove() })

const renderItem = createRawSnippet((item: () => string) => ({ render: () => `<div class="content"><span class="label">${item()}</span><input class="field" /></div>` }))

function setup(items: string[]) {
  app = mount(CmsDragList<string>, { target, props: { items, renderItem, onreorder, itemKey: (x: string) => x } })
  flushSync()
}
const rows = () => [...target.querySelectorAll<HTMLElement>('.drag-list-item')]
const labels = () => rows().map((r) => r.querySelector('.label')?.textContent)
const fire = (el: Element, type: string) => {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  return ev
}

describe.skipIf(!process.env.CS_COMPONENT_TEST)('CmsDragList', () => {
  it('손잡이를 누르고 시작한 드래그는 허용된다(dragstart가 취소되지 않는다)', () => {
    setup(['a', 'b', 'c'])
    const row = rows()[0]
    fire(row.querySelector('.drag-handle')!, 'pointerdown')
    const ev = fire(row, 'dragstart') // 실제 브라우저처럼 dragstart의 target은 항목 자체
    expect(ev.defaultPrevented).toBe(false)
  })
  it('입력창을 누르고 시작한 드래그는 막는다(텍스트 선택 드래그가 항목을 끌지 않음)', () => {
    setup(['a', 'b', 'c'])
    const row = rows()[0]
    fire(row.querySelector('.field')!, 'pointerdown')
    expect(fire(row, 'dragstart').defaultPrevented).toBe(true)
  })
  it('끌어서 다른 항목 위에 놓으면 순서가 바뀌고 onreorder가 불린다', () => {
    setup(['a', 'b', 'c'])
    const r = rows()
    fire(r[0].querySelector('.drag-handle')!, 'pointerdown')
    fire(r[0], 'dragstart')
    fire(r[2], 'dragover')
    fire(r[0], 'dragend')
    flushSync()
    expect(onreorder).toHaveBeenCalledTimes(1)
    expect(labels()).toEqual(['b', 'c', 'a'])
  })
  it('이전 제스처의 손잡이 기록이 다음 제스처로 이월되지 않는다', () => {
    setup(['a', 'b'])
    const row = rows()[0]
    fire(row.querySelector('.drag-handle')!, 'pointerdown')
    fire(row, 'pointerup')
    expect(fire(row, 'dragstart').defaultPrevented).toBe(true)
  })
})
