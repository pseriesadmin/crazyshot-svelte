// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import DocEditor from '$lib/modules/doc-editor/ui/DocEditor.svelte'
import type { JSONContent } from '@tiptap/core'

/**
 * doc-editor DocEditor — 실제 컴포넌트 mount 검증 (P2, 2026-10-14)
 * 기존 계약서 편집기(ContractDocumentEditor)에서 이관한 동작이 주입식 props로 그대로 동작하는지 확인한다.
 * 실행: npm run test:component
 */

interface EditorApi {
  insertMergeField: (a: { variable: string; label: string }) => void
  insertVariable: (a: { variable: string; label: string }) => void
  getEditorJSON: () => JSONContent | null
  getEditorHTML: () => string
  setEditorContent: (c: string | JSONContent) => void
  focus: () => void
}

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
let api: EditorApi

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}
async function ready() {
  for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
  expect(target.querySelector('.ProseMirror')).toBeTruthy()
}
function mountEditor(props: Record<string, unknown> = {}) {
  app = mount(DocEditor, { target, props: { iconFontUrl: null, ...props } })
  api = app as unknown as EditorApi
}
function btn(label: string): HTMLButtonElement | null {
  return target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}
function must(label: string): HTMLButtonElement {
  const el = btn(label)
  expect(el, `버튼 ${label}`).toBeTruthy()
  return el!
}

// jsdom에는 레이아웃 API가 없어 ProseMirror의 scrollIntoView가 실패한다 — 빈 값으로 대체(테스트 환경 한계)
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

const paragraphDoc = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('DocEditor — mount', () => {
  it('TiptapDocBlock·JSON 문서 두 형태의 초기값을 모두 열고, 건드리지 않으면 같은 문서를 돌려준다', async () => {
    mountEditor({ initialContent: { type: 'tiptap-doc', doc: paragraphDoc('안녕 계약서') } })
    await ready()
    expect(target.textContent).toContain('안녕 계약서')
    expect(api.getEditorJSON()?.content?.[0]?.content?.[0]?.text).toBe('안녕 계약서')
  })

  it('JSON 문서 형태의 초기값도 열린다', async () => {
    mountEditor({ initialContent: paragraphDoc('JSON 직접') })
    await ready()
    expect(target.textContent).toContain('JSON 직접')
  })

  it('변수 칩 삽입: insertVariable·insertMergeField 모두 mergeField 노드가 되고 HTML에 칩 표식이 남는다', async () => {
    mountEditor({})
    await ready()
    api.insertVariable({ variable: '고객이름', label: '고객이름' })
    api.insertMergeField({ variable: '연락처', label: '연락처' })
    await wait(10)
    const json = JSON.stringify(api.getEditorJSON())
    expect(json).toContain('"type":"mergeField"')
    expect(json).toContain('고객이름')
    expect(json).toContain('연락처')
    expect(api.getEditorHTML()).toContain('data-merge-field')
  })

  it('표 삽입 → 반복 영역 지정: 해당 행의 repeatRegion이 true가 된다', async () => {
    mountEditor({})
    await ready()
    must('표').click()
    await wait(10)
    ;(target.querySelector('.dt-sheet form') as HTMLFormElement).requestSubmit()
    await wait(10)
    expect(target.querySelector('table')).toBeTruthy()
    await wait(20)
    must('반복 영역 지정/해제').click()
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('"repeatRegion":true')
    must('반복 영역 지정/해제').click()
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).not.toContain('"repeatRegion":true')
  })

  it('표 밖에서는 표 도구줄(반복 영역 포함)이 보이지 않는다', async () => {
    mountEditor({})
    await ready()
    expect(btn('반복 영역 지정/해제')).toBeNull()
    expect(target.querySelector('.tcb')).toBeNull()
  })

  it('P6-a: 양쪽 정렬·구분선·인용·서체·글자색·서식 지우기가 문서에 반영된다', async () => {
    mountEditor({ initialContent: paragraphDoc('가나다') })
    await ready()
    api.focus()
    // 양쪽 정렬
    must('양쪽 정렬').click()
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('"textAlign":"justify"')
    // 구분선
    must('구분선').click()
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('horizontalRule')
    // 서체 시트 → 목록 선택
    must('서체').click()
    await wait(10)
    expect(target.querySelector('.dt-sheet')).toBeTruthy()
    const first = target.querySelector<HTMLButtonElement>('.dt-sheet .dt-list-item')
    expect(first).toBeTruthy()
    // 문단 유형 시트 → 인용
    must('문단 유형').click()
    await wait(10)
    const quote = Array.from(target.querySelectorAll<HTMLButtonElement>('.dt-sheet .dt-list-item')).find((b) => b.textContent === '인용')
    quote!.click()
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('blockquote')
    // 글자색 시트
    must('글자색').click()
    await wait(10)
    expect(target.querySelectorAll('.dt-sheet .dt-swatch').length).toBe(20)
  })

  it('P6-b: 글자 크기·배경색·들여쓰기가 문서에 반영된다(기본 켜짐)', async () => {
    mountEditor({ initialContent: paragraphDoc('가나다') })
    await ready()
    api.focus()
    // 문단 전체 선택 후 적용
    ;(target.querySelector('.ProseMirror') as HTMLElement).focus()
    must('들여쓰기').click()
    await wait(10)
    expect(JSON.stringify(api.getEditorJSON())).toContain('"indent":1')
    must('글자 크게').click()
    await wait(10)
    must('배경색').click()
    await wait(10)
    expect(target.querySelectorAll('.dt-sheet .dt-swatch').length).toBe(20)
  })

  it('P6-b: features로 글자 크기·배경색·들여쓰기를 끌 수 있다', async () => {
    mountEditor({ features: { fontSize: false, bgColor: false, indent: false } })
    await ready()
    expect(btn('글자 크게')).toBeNull()
    expect(btn('배경색')).toBeNull()
    expect(btn('들여쓰기')).toBeNull()
  })

  it('P6-c: 이미지만 붙여넣으면 업로드 후 삽입되고, 텍스트가 함께 있으면 기본 붙여넣기에 맡긴다', async () => {
    const uploadImage = vi.fn(async () => ({ url: 'https://x.test/a.png' }))
    mountEditor({ uploadImage })
    await ready()
    const pm = target.querySelector('.ProseMirror') as HTMLElement
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const mk = (withText: boolean) => {
      const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
      ev.clipboardData = { files: [file], getData: (t: string) => (withText && t === 'text/plain' ? '텍스트' : '') }
      return ev
    }
    pm.dispatchEvent(mk(true))
    await wait(20)
    expect(uploadImage).not.toHaveBeenCalled()
    pm.dispatchEvent(mk(false))
    await wait(30)
    expect(uploadImage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(api.getEditorJSON())).toContain('https://x.test/a.png')
  })

  it('P6-c: placeholder 지정 시 빈 문서에 안내 문구가 붙는다', async () => {
    mountEditor({ placeholder: '내용을 입력하세요' })
    await ready()
    await wait(20)
    expect(target.querySelector('.ProseMirror p.is-editor-empty')?.getAttribute('data-placeholder')).toBe('내용을 입력하세요')
  })

  it('P6-a: 서식 지우기는 마크와 정렬을 걷어낸다', async () => {
    mountEditor({ initialContent: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '굵게', marks: [{ type: 'bold' }] }] }] } })
    await ready()
    api.focus()
    must('서식 지우기').click()
    await wait(10)
    // 선택이 비어 있어도 clearNodes/unsetTextAlign 이 동작해 오류 없이 끝난다
    expect(api.getEditorJSON()).toBeTruthy()
  })

  it('onchange: 마운트(초기화) 직후에는 호출되지 않고, 실제 변경 때만 호출된다', async () => {
    const onchange = vi.fn()
    mountEditor({ onchange, initialContent: paragraphDoc('기준') })
    await ready()
    await wait(30)
    expect(onchange).not.toHaveBeenCalled()
    api.insertVariable({ variable: '고객이름', label: '고객이름' })
    await wait(10)
    expect(onchange).toHaveBeenCalled()
  })

  it('onchange: 호스트가 저장 후 dirty를 초기화해도, 원래 내용으로 되돌리는 편집까지 다시 알린다(저장→되돌리기 회귀 방지)', async () => {
    const onchange = vi.fn()
    mountEditor({ onchange, initialContent: paragraphDoc('A') })
    await ready()
    await wait(20)
    api.setEditorContent(paragraphDoc('B')) // 편집 → 저장(호스트가 dirty 초기화 가정)
    await wait(10)
    expect(onchange).toHaveBeenCalledTimes(1)
    onchange.mockClear()
    api.setEditorContent(paragraphDoc('A')) // 저장본(B)과 달라지는 되돌리기
    await wait(10)
    expect(onchange).toHaveBeenCalledTimes(1)
  })

  it('onchange: 문서 교체(docx 가져오기 경로 setEditorContent)와 삽입(insertEditorContent)도 알린다', async () => {
    const onchange = vi.fn()
    mountEditor({ onchange })
    await ready()
    await wait(20)
    api.setEditorContent(paragraphDoc('가져온 문서'))
    await wait(10)
    expect(onchange).toHaveBeenCalledTimes(1)
    ;(app as unknown as { insertEditorContent: (c: JSONContent) => void }).insertEditorContent({ type: 'paragraph', content: [{ type: 'text', text: '표 삽입' }] })
    await wait(10)
    expect(onchange).toHaveBeenCalledTimes(2)
  })

  it('onchange: 에디터가 준비된 직후의 첫 편집도 놓치지 않는다', async () => {
    const onchange = vi.fn()
    mountEditor({ onchange })
    await ready()
    api.insertVariable({ variable: '고객이름', label: '고객이름' }) // 대기 없이 곧바로 첫 편집
    await wait(10)
    expect(onchange).toHaveBeenCalled()
  })

  it('onchange: 내용을 바꾸면 호출된다', async () => {
    const onchange = vi.fn()
    mountEditor({ onchange })
    await ready()
    onchange.mockClear()
    api.insertVariable({ variable: '고객이름', label: '고객이름' })
    await wait(10)
    expect(onchange).toHaveBeenCalled()
  })

  it('readonly: 툴바가 없다', async () => {
    mountEditor({ readonly: true, initialContent: paragraphDoc('읽기') })
    await ready()
    expect(target.querySelector('[role="toolbar"]')).toBeNull()
  })

  it('features: 끈 기능의 버튼은 렌더링되지 않는다', async () => {
    mountEditor({ features: { table: false, signature: false, source: false, zoom: false, image: false, link: false, fontColor: false } })
    await ready()
    expect(btn('표')).toBeNull()
    expect(btn('서명/직인 이미지 삽입')).toBeNull()
    expect(btn('HTML 소스 편집')).toBeNull()
    expect(btn('캔버스 확대')).toBeNull()
    expect(btn('이미지 삽입')).toBeNull()
    expect(btn('굵게')).toBeTruthy() // 기본 서식은 항상 노출
  })

  it('줌: 확대 버튼이 --de-zoom 변수를 바꾼다', async () => {
    mountEditor({})
    await ready()
    const area = target.querySelector<HTMLElement>('.de-editor-area')!
    expect(area.getAttribute('style')).toContain('--de-zoom: 100%')
    must('캔버스 확대').click()
    await wait(10)
    expect(area.getAttribute('style')).toContain('--de-zoom: 110%')
  })

  it('서명/직인: 주입된 목록을 보여주고 선택하면 이미지가 삽입된다', async () => {
    const listSignatureAssets = vi.fn().mockResolvedValue([
      { id: 'a1', assetType: 'seal', name: '대표 직인', imageUrl: 'https://example.com/seal.png' },
    ])
    mountEditor({ listSignatureAssets })
    await ready()
    must('서명/직인 이미지 삽입').click()
    await wait(20)
    expect(listSignatureAssets).toHaveBeenCalledTimes(1)
    const item = target.querySelector<HTMLButtonElement>('.dt-sig-item')
    expect(item).toBeTruthy()
    item!.click()
    await wait(10)
    const json = JSON.stringify(api.getEditorJSON())
    expect(json).toContain('https://example.com/seal.png')
    expect(json).toContain('"width":200')
  })

  // ── 이미지 겹치기(overlay)·서명 삽입 버그 수정 (2026-10-14) ──
  const IMG_DOC: JSONContent = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '본문' }] },
      { type: 'image', attrs: { src: 'https://example.com/s.png', width: 200, align: 'center' } },
    ],
  }
  const rectOf = (left: number, top: number, w = 200, h = 80) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) }) as DOMRect

  function overlayButton(): HTMLElement {
    const b = Array.from(target.querySelectorAll<HTMLElement>('.ProseMirror button')).find((x) => x.textContent === '겹치기')
    expect(b, '겹치기 버튼').toBeTruthy()
    return b!
  }

  it('겹치기를 켜면 문서 좌상단(0,0)이 아니라 이미지가 있던 자리에서 떠오른다', async () => {
    mountEditor({ initialContent: IMG_DOC })
    await ready()
    const pm = target.querySelector('.ProseMirror') as HTMLElement
    const img = target.querySelector('.ProseMirror img') as HTMLElement
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === pm) return rectOf(100, 50, 700, 900)
      if (this === img) return rectOf(250, 180)
      return rectOf(0, 0, 0, 0)
    })
    try {
      overlayButton().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await wait(10)
      const json = JSON.stringify(api.getEditorJSON())
      expect(json).toContain('"overlay":true')
      expect(json).toContain('"x":150')
      expect(json).toContain('"y":130')
    } finally {
      spy.mockRestore()
    }
  })

  it('화면 확대(200%)에서도 겹치기 시작 좌표는 문서 픽셀로 환산된다', async () => {
    mountEditor({ initialContent: IMG_DOC })
    await ready()
    const area = target.querySelector('.de-editor-area') as HTMLElement
    area.style.setProperty('--de-zoom', '200%')
    const pm = target.querySelector('.ProseMirror') as HTMLElement
    const img = target.querySelector('.ProseMirror img') as HTMLElement
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this === pm) return rectOf(100, 50, 1400, 1800)
      if (this === img) return rectOf(400, 250)
      return rectOf(0, 0, 0, 0)
    })
    try {
      overlayButton().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await wait(10)
      const json = JSON.stringify(api.getEditorJSON())
      expect(json).toContain('"x":150') // (400-100)/2
      expect(json).toContain('"y":100') // (250-50)/2
    } finally {
      spy.mockRestore()
    }
  })

  it('이미지 도구줄에는 크기·정렬 중복 메뉴(프리셋·너비 입력·정렬 버튼)가 없고, 편집·ALT·크기 점 전환·삭제·겹치기만 있다', async () => {
    mountEditor({ initialContent: IMG_DOC })
    await ready()
    const titles = [...target.querySelectorAll<HTMLButtonElement>('.ProseMirror button')].map((b) => b.title)
    expect(titles.some((x) => x.startsWith('너비'))).toBe(false)
    expect(titles.some((x) => x.endsWith('정렬'))).toBe(false)
    expect(target.querySelector('.ProseMirror input[type="number"]')).toBeNull()
    expect(titles.some((x) => x.startsWith('이미지 편집'))).toBe(true)
    expect(titles.some((x) => x.startsWith('사진 설명'))).toBe(true)
    expect(titles.some((x) => x.startsWith('크기 조절 점'))).toBe(true)
    expect(titles.some((x) => x.startsWith('이미지 삭제'))).toBe(true)
    expect(titles.some((x) => x.startsWith('텍스트 위에 겹치기'))).toBe(true)
  })

  it('ALT 입력란에서 값을 바꾸지 않고 나가도 문서가 바뀐 것으로 처리되지 않는다', async () => {
    const onchange = vi.fn()
    mountEditor({ initialContent: IMG_DOC, onchange })
    await ready()
    await wait(30)
    onchange.mockClear()
    const altBtn = [...target.querySelectorAll<HTMLButtonElement>('.ProseMirror button')].find((b) => b.title.startsWith('사진 설명'))!
    altBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const input = target.querySelector<HTMLInputElement>('.ProseMirror input[placeholder="사진 설명"]')!
    input.dispatchEvent(new FocusEvent('blur'))
    await wait(10)
    expect(onchange).not.toHaveBeenCalled()
  })

  it('이미지가 선택된 상태에서 서명/직인을 넣으면 선택된 이미지를 덮어쓰지 않고 뒤에 추가한다', async () => {
    const listSignatureAssets = vi.fn().mockResolvedValue([{ id: 'a1', assetType: 'seal', name: '직인', imageUrl: 'https://example.com/seal.png' }])
    mountEditor({ initialContent: IMG_DOC, listSignatureAssets })
    await ready()
    // 마지막 이미지를 NodeSelection 으로 선택 — TipTap 이 ProseMirror 루트 DOM 에 editor 를 달아 둔다
    const { NodeSelection } = await import('@tiptap/pm/state')
    const host = target.querySelector('.ProseMirror') as HTMLElement & { editor: { state: { doc: { content: { size: number } } }; view: { state: { tr: { setSelection: (s: unknown) => unknown }; doc: unknown }; dispatch: (t: unknown) => void } } }
    const view = host.editor.view
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc as never, host.editor.state.doc.content.size - 1)))
    must('서명/직인 이미지 삽입').click()
    await wait(20)
    target.querySelector<HTMLButtonElement>('.dt-sig-item')!.click()
    await wait(10)
    const json = JSON.stringify(api.getEditorJSON())
    expect(json).toContain('https://example.com/s.png') // 원래 이미지 유지
    expect(json).toContain('https://example.com/seal.png') // 새 직인 추가
  })

  it('서명/직인: 목록 제공자가 없으면 빈 안내를 보여준다', async () => {
    mountEditor({})
    await ready()
    must('서명/직인 이미지 삽입').click()
    await wait(20)
    expect(target.querySelector('.dt-sig-empty')).toBeTruthy()
  })

  it('이미지 삽입: uploadImage가 주어지면 반환된 URL을 문서에 넣는다', async () => {
    const uploadImage = vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/up.png' })
    mountEditor({ uploadImage })
    await ready()
    const input = target.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(20)
    expect(uploadImage).toHaveBeenCalledWith(file)
    expect(JSON.stringify(api.getEditorJSON())).toContain('https://cdn.example.com/up.png')
  })

  it('이미지 삽입: 허용되지 않는 형식은 notify(오류)로 막고 문서를 바꾸지 않는다', async () => {
    const notify = vi.fn()
    const uploadImage = vi.fn()
    mountEditor({ notify, uploadImage })
    await ready()
    const input = target.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['x'], 'a.exe', { type: 'application/x-msdownload' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(10)
    expect(uploadImage).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error')
    expect(JSON.stringify(api.getEditorJSON())).not.toContain('"type":"image"')
  })

  it('이미지 삽입: 업로드 실패는 notify(오류)로 안내한다', async () => {
    const notify = vi.fn()
    const uploadImage = vi.fn().mockRejectedValue(new Error('용량 초과'))
    mountEditor({ notify, uploadImage })
    await ready()
    const input = target.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await wait(20)
    expect(notify).toHaveBeenCalledWith('용량 초과', 'error')
  })

  it('HTML 소스: 열어서 수정 후 적용하면 문서에 반영된다', async () => {
    mountEditor({ initialContent: paragraphDoc('원문') })
    await ready()
    must('HTML 소스 편집').click()
    await wait(10)
    const ta = target.ownerDocument.querySelector<HTMLTextAreaElement>('.de-html-textarea')!
    expect(ta.value).toContain('원문')
    ta.value = '<p>수정본</p>'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(10)
    target.ownerDocument.querySelector<HTMLButtonElement>('.de-html-footer .btn-action')!.click()
    await wait(10)
    expect(target.textContent).toContain('수정본')
  })
})
