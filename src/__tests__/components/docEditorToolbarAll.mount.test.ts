// @vitest-environment jsdom
/**
 * 통합 편집기 툴바 전수 동작 검증 (2026-10-14) — 버튼 하나하나를 눌러 문서(JSON)에 반영되는지 확인한다.
 * jsdom 이라 실제 화면 배치·선택 시트 위치·마우스 선택은 검증하지 못한다(그 부분은 실화면 확인).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import DocEditor from '$lib/modules/doc-editor/ui/DocEditor.svelte'
import type { JSONContent } from '@tiptap/core'

type TT = {
  getJSON: () => JSONContent
  commands: { selectAll: () => boolean; setTextSelection: (p: unknown) => boolean; focus: (p?: unknown) => boolean }
  chain: () => { focus: () => { insertTable: (o: unknown) => { run: () => boolean } } }
  isActive: (n: string, a?: unknown) => boolean
}
let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}
const ed = () => (target.querySelector('.ProseMirror') as unknown as { editor: TT }).editor
const json = () => JSON.stringify(ed().getJSON())
const btn = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
function must(label: string): HTMLButtonElement {
  const el = btn(label)
  expect(el, `버튼 ${label}`).toBeTruthy()
  return el!
}
async function click(label: string) {
  must(label).click()
  await wait(5)
}
const sheetItem = (text: string) =>
  Array.from(target.querySelectorAll<HTMLButtonElement>('.dt-sheet button')).find((b) => (b.textContent ?? '').trim() === text)
async function clickSheet(text: string) {
  const b = sheetItem(text)
  expect(b, `시트 항목 ${text}`).toBeTruthy()
  b!.click()
  await wait(5)
}
const DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '가나다라' }] }] }
async function setup(content: JSONContent = DOC, props: Record<string, unknown> = {}) {
  app = mount(DocEditor, { target, props: { iconFontUrl: null, initialContent: content, ...props } })
  for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
  await wait(20)
  ed().commands.selectAll()
  await wait(5)
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
  vi.restoreAllMocks()
})

describe('1줄 — 서식', () => {
  it('실행취소/다시실행', async () => {
    await setup()
    await click('굵게')
    expect(json()).toContain('"bold"')
    await click('실행취소')
    expect(json()).not.toContain('"bold"')
    await click('다시실행')
    expect(json()).toContain('"bold"')
  })

  it.each([['굵게', 'bold'], ['기울임', 'italic'], ['밑줄', 'underline'], ['취소선', 'strike']])('%s 토글(켜기→끄기)', async (label, mark) => {
    await setup()
    await click(label)
    expect(json()).toContain(`"${mark}"`)
    expect(must(label).getAttribute('aria-pressed')).toBe('true')
    await click(label)
    expect(json()).not.toContain(`"${mark}"`)
  })

  it.each([['왼쪽 정렬', 'left'], ['가운데 정렬', 'center'], ['오른쪽 정렬', 'right'], ['양쪽 정렬', 'justify']])('%s', async (label, v) => {
    await setup()
    await click(label)
    expect(json()).toContain(`"textAlign":"${v}"`)
  })

  it('글머리 목록·번호 목록 토글', async () => {
    await setup()
    // 전체 선택(Ctrl+A)은 목록 뒤 자동 빈 문단(StarterKit trailingNode)까지 포함해 해제가 안 되므로, 실제 사용처럼 커서를 첫 줄에 둔다
    ed().commands.focus('start')
    await click('글머리 목록')
    expect(json()).toContain('"bulletList"')
    ed().commands.focus('start')
    await click('글머리 목록')
    expect(json()).not.toContain('"bulletList"')
    ed().commands.focus('start')
    await click('번호 목록')
    expect(json()).toContain('"orderedList"')
  })

  it('들여쓰기·내어쓰기(문단)', async () => {
    await setup()
    await click('들여쓰기')
    await click('들여쓰기')
    expect(json()).toContain('"indent":2')
    await click('내어쓰기')
    expect(json()).toContain('"indent":1')
  })

  it('글자 크기 −/+ 와 프리셋 시트', async () => {
    await setup()
    await click('글자 크게')
    expect(json()).toContain('"fontSize":"17px"')
    await click('글자 작게')
    await click('글자 작게')
    expect(json()).toContain('"fontSize":"15px"')
    await click('글자 크기 목록')
    expect(target.querySelector('.dt-sheet')).toBeTruthy()
    await clickSheet('24')
    expect(json()).toContain('"fontSize":"24px"')
    expect(target.querySelector('.dt-sheet')).toBeNull() // 선택하면 닫힌다
  })

  it('pt 단위 글자(한글·워드 가져오기 문서)는 px로 환산해 표시하고, +를 누르면 커진다', async () => {
    await setup({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '가나다라', marks: [{ type: 'textStyle', attrs: { fontSize: '13pt' } }] }] }],
    })
    expect(must('글자 크기 목록').textContent?.trim()).toBe('17') // 13pt ≈ 17px
    await click('글자 크게')
    expect(json()).toContain('"fontSize":"18px"')
  })

  it('em·% 단위 글자 크기는 1px 같은 엉터리 값 대신 기본 크기로 표시한다', async () => {
    await setup({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '가나다라', marks: [{ type: 'textStyle', attrs: { fontSize: '1.2em' } }] }] }],
    })
    expect(must('글자 크기 목록').textContent?.trim()).toBe('16')
  })

  it('서체 시트: 선택·기본 서체로 해제', async () => {
    await setup()
    await click('서체')
    await clickSheet('굴림')
    expect(json()).toContain('Gulim')
    await click('서체')
    await clickSheet('기본 서체')
    expect(json()).not.toContain('Gulim')
  })

  it('글자색 시트: 20색 중 선택·기본 글자색으로 해제', async () => {
    await setup()
    await click('글자색')
    const sw = target.querySelectorAll<HTMLButtonElement>('.dt-sheet .dt-swatch')
    expect(sw.length).toBe(20)
    sw[5]!.click() // #cf0000
    await wait(5)
    expect(json().toLowerCase()).toContain('"color":"#cf0000"')
    await click('글자색')
    await clickSheet('기본 글자색')
    expect(json().toLowerCase()).not.toContain('#cf0000')
  })

  it('배경색 시트: 선택·배경색 없음', async () => {
    await setup()
    await click('배경색')
    target.querySelectorAll<HTMLButtonElement>('.dt-sheet .dt-swatch')[9]!.click() // #ffc107
    await wait(5)
    expect(json().toLowerCase()).toContain('"backgroundcolor":"#ffc107"')
    await click('배경색')
    await clickSheet('배경색 없음')
    expect(json().toLowerCase()).not.toContain('#ffc107')
  })

  it('문단 유형 시트: 제목1·2·3·인용·본문', async () => {
    await setup()
    for (const [label, expected] of [['제목1', '"level":1'], ['제목2', '"level":2'], ['제목3', '"level":3']] as const) {
      ed().commands.focus('start')
      await click('문단 유형')
      await clickSheet(label)
      expect(json()).toContain(expected)
    }
    ed().commands.focus('start')
    await click('문단 유형')
    await clickSheet('인용')
    expect(json()).toContain('"blockquote"')
    ed().commands.focus('start')
    await click('문단 유형')
    await clickSheet('본문')
    expect(json()).not.toContain('"blockquote"')
    expect(json()).not.toContain('"heading"')
  })

  it('링크: 스킴 없는 주소(example.com)도 제출되어 https 링크가 걸린다 / 해제', async () => {
    await setup()
    await click('링크')
    const input = target.querySelector<HTMLInputElement>('.dt-sheet input')!
    input.value = 'example.com'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(5)
    // 실제 브라우저처럼 제출 버튼 클릭(=네이티브 유효성 검사 포함)
    target.querySelector<HTMLButtonElement>('.dt-sheet button[type="submit"]')!.click()
    await wait(10)
    expect(json()).toContain('https://example.com')
    ed().commands.selectAll()
    await click('링크')
    await clickSheet('링크 해제')
    expect(json()).not.toContain('https://example.com')
  })

  it('링크: 허용되지 않는 주소(javascript:)는 걸리지 않고 안내한다', async () => {
    const notify = vi.fn()
    await setup(DOC, { notify })
    await click('링크')
    const input = target.querySelector<HTMLInputElement>('.dt-sheet input')!
    input.value = 'javascript:alert(1)'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(5)
    ;(target.querySelector('.dt-sheet form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await wait(5)
    expect(json()).not.toContain('javascript:')
    expect(notify).toHaveBeenCalled()
  })

  it('서식 지우기: 굵게·정렬·크기·색 제거', async () => {
    await setup()
    await click('굵게')
    await click('가운데 정렬')
    await click('글자 크게')
    await click('서식 지우기')
    const j = json()
    expect(j).not.toContain('"bold"')
    expect(j).not.toContain('"fontSize"')
    expect(j).not.toContain('"textAlign":"center"')
  })
})

describe('2줄 — 삽입·보기', () => {
  it('사진: 숨은 파일 입력을 연다', async () => {
    await setup()
    const spy = vi.spyOn(HTMLInputElement.prototype, 'click')
    await click('사진')
    expect(spy).toHaveBeenCalled()
    expect(document.querySelector('input[type="file"]')).toBeTruthy()
  })

  it('이모지: 시트에서 선택하면 본문에 들어간다', async () => {
    await setup()
    ed().commands.focus('end')
    await click('이모지')
    expect(target.querySelectorAll('.dt-sheet .dt-emoji-btn').length).toBe(40)
    target.querySelector<HTMLButtonElement>('.dt-sheet .dt-emoji-btn')!.click()
    await wait(5)
    expect(json()).toContain('😀')
  })

  it('표: 행·열 수를 정해 삽입(헤더행 포함)', async () => {
    await setup()
    ed().commands.focus('end')
    await click('표')
    const nums = target.querySelectorAll<HTMLInputElement>('.dt-sheet input[type="number"]')
    nums[0]!.value = '2'
    nums[0]!.dispatchEvent(new Event('input', { bubbles: true }))
    nums[1]!.value = '4'
    nums[1]!.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(5)
    target.querySelector<HTMLButtonElement>('.dt-sheet button[type="submit"]')!.click()
    await wait(10)
    const t = ed().getJSON().content!.find((n) => n.type === 'table')!
    expect(t.content!.length).toBe(2)
    expect(t.content![0]!.content!.length).toBe(4)
    expect(JSON.stringify(t.content![0])).toContain('tableHeader')
  })

  it('구분선', async () => {
    await setup()
    ed().commands.focus('end')
    await click('구분선')
    expect(json()).toContain('horizontalRule')
  })

  it('HTML 소스: 열기 → 수정 → 적용 / 취소', async () => {
    await setup()
    await click('HTML 소스 편집')
    const ta = target.ownerDocument.querySelector<HTMLTextAreaElement>('.de-html-textarea')!
    expect(ta.value).toContain('가나다라')
    ta.value = '<p>수정됨</p>'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(5)
    ;(document.querySelector('.de-html-footer .btn-action') as HTMLButtonElement).click()
    await wait(10)
    expect(json()).toContain('수정됨')
    expect(document.querySelector('.de-html-textarea')).toBeNull()
    await click('HTML 소스 편집')
    ;(document.querySelector('.de-html-footer .btn-cancel') as HTMLButtonElement).click()
    await wait(5)
    expect(document.querySelector('.de-html-textarea')).toBeNull()
  })

  it('확대·축소·초기화(50~200%, 10% 단계)', async () => {
    await setup()
    const area = () => target.querySelector('.de-editor-area') as HTMLElement
    await click('캔버스 확대')
    expect(area().style.getPropertyValue('--de-zoom')).toBe('110%')
    await click('캔버스 축소')
    await click('캔버스 축소')
    expect(area().style.getPropertyValue('--de-zoom')).toBe('90%')
    target.querySelector<HTMLButtonElement>('button.dt-zoom-value')!.click()
    await wait(5)
    expect(area().style.getPropertyValue('--de-zoom')).toBe('100%')
    for (let i = 0; i < 15; i++) must('캔버스 확대').click()
    await wait(5)
    expect(area().style.getPropertyValue('--de-zoom')).toBe('200%')
    expect(must('캔버스 확대').disabled).toBe(true)
  })
})

describe('시트 공통 동작', () => {
  it('Escape·바깥 클릭으로 닫히고, 같은 버튼을 다시 누르면 토글된다', async () => {
    await setup()
    await click('서체')
    expect(target.querySelector('.dt-sheet')).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wait(5)
    expect(target.querySelector('.dt-sheet')).toBeNull()
    await click('서체')
    await click('서체')
    expect(target.querySelector('.dt-sheet')).toBeNull()
    await click('서체')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wait(5)
    expect(target.querySelector('.dt-sheet')).toBeNull()
  })

  it('readonly 이면 툴바 자체가 없다', async () => {
    await setup(DOC, { readonly: true })
    expect(target.querySelector('.dt-wrap')).toBeNull()
  })
})

describe('표 도구줄(표 안에 커서가 있을 때)', () => {
  async function withTable() {
    await setup(DOC)
    ed().commands.focus('end')
    await click('표')
    target.querySelector<HTMLButtonElement>('.dt-sheet button[type="submit"]')!.click()
    await wait(20)
  }
  const rows = () => (ed().getJSON().content!.find((n) => n.type === 'table')?.content ?? []).length
  const cols = () => (ed().getJSON().content!.find((n) => n.type === 'table')?.content?.[0]?.content ?? []).length

  it('행·열 추가/삭제', async () => {
    await withTable()
    expect(target.querySelector('.tcb')).toBeTruthy()
    expect([rows(), cols()]).toEqual([3, 3])
    await click('행 아래에 추가')
    expect(rows()).toBe(4)
    await click('행 위에 추가')
    expect(rows()).toBe(5)
    await click('행 삭제')
    expect(rows()).toBe(4)
    await click('열 오른쪽에 추가')
    expect(cols()).toBe(4)
    await click('열 왼쪽에 추가')
    expect(cols()).toBe(5)
    await click('열 삭제')
    expect(cols()).toBe(4)
  })

  it('헤더행·헤더열 토글, 반복 영역 지정/해제, 표 삭제', async () => {
    await withTable()
    const first = () => JSON.stringify(ed().getJSON().content!.find((n) => n.type === 'table')!.content![0])
    expect(first()).toContain('tableHeader')
    await click('헤더행 토글')
    expect(first()).not.toContain('tableHeader')
    await click('헤더열 토글')
    expect(json()).toContain('tableHeader')
    await click('반복 영역 지정/해제')
    expect(json()).toContain('"repeatRegion":true')
    await click('반복 영역 지정/해제')
    expect(json()).not.toContain('"repeatRegion":true')
    await click('표 삭제')
    expect(json()).not.toContain('"table"')
  })

  it('셀 병합/분할 버튼이 오류 없이 동작한다(셀 하나 선택 상태에서는 변화 없음)', async () => {
    await withTable()
    const before = json()
    await click('셀 병합')
    await click('셀 분할')
    expect(json()).toBe(before)
  })
})
