// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync, createRawSnippet } from 'svelte'
import { VariablePanel, DocWorkspace } from '$lib/modules/doc-editor'
import type { VariableCatalog } from '$lib/modules/doc-editor'

/**
 * doc-editor VariablePanel / DocWorkspace — mount 검증 (P3, 2026-10-14)
 * 카탈로그 주입형 변수 패널의 탭·칩·선택 유지·호스트 탭 삽입과, 편집기와의 결합 동작을 확인한다.
 */

const CATALOG: VariableCatalog = [
  { key: 'customer', label: '계약자', items: [{ variable: '고객이름', label: '고객이름' }, { variable: '연락처', label: '연락처' }] },
  { key: 'pay', label: '결제', items: [{ variable: '최종합계', label: '최종합계' }] },
]

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

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
})

function chips(): HTMLButtonElement[] {
  return [...target.querySelectorAll<HTMLButtonElement>('.dvp-chip')]
}
function tab(label: string): HTMLButtonElement {
  const el = [...target.querySelectorAll<HTMLButtonElement>('.dvp-tab')].find((b) => b.textContent === label)
  expect(el, `탭 ${label}`).toBeTruthy()
  return el!
}

describe('VariablePanel — mount', () => {
  it('첫 그룹의 칩을 보여주고, 칩 라벨과 {{변수}} 표기를 함께 노출한다', () => {
    app = mount(VariablePanel, { target, props: { catalog: CATALOG, onInsert: () => {} } })
    flushSync()
    expect(chips().map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['고객이름 {{고객이름}}', '연락처 {{연락처}}'])
  })

  it('탭을 바꾸면 해당 그룹의 칩이 나온다', async () => {
    app = mount(VariablePanel, { target, props: { catalog: CATALOG, onInsert: () => {} } })
    flushSync()
    tab('결제').click()
    await wait()
    expect(chips().map((c) => c.textContent?.includes('최종합계'))).toEqual([true])
  })

  it('칩 클릭은 onInsert에 {variable,label}을 넘긴다', () => {
    const onInsert = vi.fn()
    app = mount(VariablePanel, { target, props: { catalog: CATALOG, onInsert } })
    flushSync()
    chips()[1].click()
    expect(onInsert).toHaveBeenCalledWith({ variable: '연락처', label: '연락처' })
  })

  it('칩·탭의 mousedown은 기본동작을 막아 편집기 선택이 풀리지 않게 한다', () => {
    app = mount(VariablePanel, { target, props: { catalog: CATALOG, onInsert: () => {} } })
    flushSync()
    for (const el of [chips()[0], tab('결제')]) {
      const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      el.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(true)
    }
  })

  it('호스트 탭(extraTabs)은 extra 스니펫으로 본문을 그린다', async () => {
    const extra = createRawSnippet((key: () => string) => ({ render: () => `<div class="host-tab-body">호스트 ${key()}</div>` }))
    app = mount(VariablePanel, { target, props: { catalog: CATALOG, onInsert: () => {}, extraTabs: [{ key: 'specs', label: '특약' }], extra } })
    flushSync()
    expect(target.querySelector('.host-tab-body')).toBeNull()
    tab('특약').click()
    await wait()
    expect(target.querySelector('.host-tab-body')?.textContent).toBe('호스트 specs')
  })

  it('searchable: 입력으로 칩을 걸러낸다', async () => {
    app = mount(VariablePanel, { target, props: { catalog: CATALOG, onInsert: () => {}, searchable: true } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('.dvp-search')!
    input.value = '연락'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    expect(chips()).toHaveLength(1)
    expect(chips()[0].textContent).toContain('연락처')
  })

  it('catalog가 비어 있어도 오류 없이 렌더링한다', () => {
    app = mount(VariablePanel, { target, props: { catalog: [], onInsert: () => {} } })
    flushSync()
    expect(target.querySelector('.dvp-wrap')).toBeTruthy()
  })
})

describe('DocWorkspace — 편집기 + 패널 결합', () => {
  it('패널의 칩을 클릭하면 편집기에 변수 칩 노드가 들어가 {{변수}}로 직렬화된다', async () => {
    app = mount(DocWorkspace, { target, props: { catalog: CATALOG, iconFontUrl: null } })
    for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
    chips()[0].click()
    await wait(10)
    const api = app as unknown as { getEditorJSON: () => unknown; getEditorHTML: () => string }
    expect(JSON.stringify(api.getEditorJSON())).toContain('"variable":"고객이름"')
    expect(api.getEditorHTML()).toContain('data-variable="고객이름"')
  })
})
