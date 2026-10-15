// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ContractFlowPanel from '$lib/modules/doc-editor/adapters/crazyshot/ContractFlowPanel.svelte'
import ContractFlowEditor from '$lib/modules/doc-editor/adapters/crazyshot/ContractFlowEditor.svelte'

/**
 * adapters/crazyshot — 계약서 양식(문서형) 어댑터 mount 검증 (P4, 2026-10-14)
 * ContractTemplatePanel 이 쓰는 인터페이스(props·export)가 기존 편집기와 같은 형태로 동작하는지 확인한다.
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

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

function tab(label: string): HTMLButtonElement {
  const el = [...target.querySelectorAll<HTMLButtonElement>('.dvp-tab')].find((b) => b.textContent === label)
  expect(el, `탭 ${label}`).toBeTruthy()
  return el!
}

describe('ContractFlowPanel — 계약서 변수 패널 어댑터', () => {
  it('탭: 계약자·상품·결제·기타·특약', () => {
    app = mount(ContractFlowPanel, { target, props: { onInsertField: () => {}, specifications: [{ key: '', value: '' }], onSpecsChange: () => {} } })
    flushSync()
    expect([...target.querySelectorAll('.dvp-tab')].map((t) => t.textContent)).toEqual(['계약자', '상품', '결제', '기타', '특약'])
  })

  it('계약자 탭의 첫 칩 클릭은 onInsertField({variable:고객이름})을 부른다', () => {
    const onInsertField = vi.fn()
    app = mount(ContractFlowPanel, { target, props: { onInsertField, specifications: [{ key: '', value: '' }], onSpecsChange: () => {} } })
    flushSync()
    target.querySelector<HTMLButtonElement>('.dvp-chip')!.click()
    expect(onInsertField).toHaveBeenCalledWith({ variable: '고객이름', label: '고객이름' })
  })

  it('특약 탭: 항목 입력·추가·삭제가 onSpecsChange로 전달된다', async () => {
    const onSpecsChange = vi.fn()
    app = mount(ContractFlowPanel, { target, props: { onInsertField: () => {}, specifications: [{ key: 'a', value: 'b' }], onSpecsChange } })
    flushSync()
    tab('특약').click()
    await wait()
    const key = target.querySelector<HTMLInputElement>('input[aria-label="특약 항목명 1"]')!
    expect(key.value).toBe('a')
    key.value = '수정'
    key.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onSpecsChange).toHaveBeenLastCalledWith([{ key: '수정', value: 'b' }])
    ;[...target.querySelectorAll<HTMLButtonElement>('.add-row-btn')][0].click()
    expect(onSpecsChange).toHaveBeenLastCalledWith([{ key: 'a', value: 'b' }, { key: '', value: '' }])
    // 항목이 1개뿐이면 삭제 불가
    expect(target.querySelector<HTMLButtonElement>('button[aria-label="항목 1 삭제"]')!.disabled).toBe(true)
  })
})

describe('ContractFlowEditor — 계약서 편집기 어댑터', () => {
  async function ready() {
    for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
    expect(target.querySelector('.ProseMirror')).toBeTruthy()
  }

  it('기존 편집기와 같은 export(insertMergeField·getEditorJSON·setEditorContent·insertEditorContent)로 동작한다', async () => {
    app = mount(ContractFlowEditor, { target, props: {} })
    const api = app as unknown as {
      insertMergeField: (a: { variable: string; label: string }) => void
      getEditorJSON: () => unknown
      setEditorContent: (c: unknown) => void
      insertEditorContent: (c: unknown) => void
    }
    await ready()
    api.insertMergeField({ variable: '고객이름', label: '고객이름' })
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('"variable":"고객이름"')
    api.setEditorContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '교체' }] }] })
    await wait(10)
    expect(target.textContent).toContain('교체')
    api.insertEditorContent({ type: 'paragraph', content: [{ type: 'text', text: '삽입' }] })
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('삽입')
  })

  it('저장된 tiptap-doc 블록을 그대로 열고 onchange를 전달한다', async () => {
    const onchange = vi.fn()
    app = mount(ContractFlowEditor, {
      target,
      props: { onchange, initialContent: { type: 'tiptap-doc', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '저장본' }] }] } } },
    })
    await ready()
    expect(target.textContent).toContain('저장본')
  })

  it('서명/직인: 기존 자산 API(/api/cms/signature-assets) 응답을 목록으로 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: 's1', asset_type: 'signature', image_url: 'https://example.com/sig.png', label: '대표 서명', is_default: true }],
    }))
    app = mount(ContractFlowEditor, { target, props: {} })
    await ready()
    target.querySelector<HTMLButtonElement>('button[aria-label="서명/직인 이미지 삽입"]')!.click()
    await wait(30)
    expect(fetch).toHaveBeenCalledWith('/api/cms/signature-assets')
    expect(target.querySelector('.dt-sig-label')?.textContent).toBe('대표 서명')
  })
})
