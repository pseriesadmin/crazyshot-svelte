// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'
import type { ContentBlock } from '$lib/types/content-editor'

/**
 * RichContentEditor — 편집 메뉴 전수 점검 (2026-10-16)
 * 서식 도구줄(PC)의 모든 버튼·시트를 실제로 눌러 문서에 반영되는지 확인한다.
 * 실행: npm run test:component
 */

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
type Ed = import('@tiptap/core').Editor

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}
async function ready() {
  for (let i = 0; i < 250 && !target.querySelector(".ProseMirror"); i++) await wait(20)
  expect(target.querySelector('.ProseMirror')).toBeTruthy()
}
function mountEditor(blocks: ContentBlock[], extra: Record<string, unknown> = {}) {
  app = mount(RichContentEditor, { target, props: { blocks, keywords: [] as string[], ...extra } })
}
const editorOf = () => (target.querySelector<HTMLElement>('.ProseMirror') as unknown as { editor: Ed }).editor
function btn(label: string): HTMLButtonElement {
  const el = target.querySelector<HTMLButtonElement>(`.rc-toolbar-wrap button[aria-label="${label}"]`)
  expect(el, `버튼 ${label}`).toBeTruthy()
  return el!
}
async function click(label: string) {
  btn(label).click()
  await wait()
}
function sheetBtn(text: string): HTMLButtonElement {
  const el = [...target.querySelectorAll<HTMLButtonElement>('.rc-sheet button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)
  expect(el, `시트 버튼 ${text}`).toBeTruthy()
  return el!
}
async function selectText(editor: Ed, from = 1, to = 6) {
  editor.commands.setTextSelection({ from, to })
  await wait()
}

const EMPTY_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
const EMPTY_RECTS = Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects = () => EMPTY_RECTS
Range.prototype.getBoundingClientRect = () => EMPTY_RECT
Element.prototype.getClientRects = () => EMPTY_RECTS

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

const TEXT: ContentBlock[] = [{ type: 'text', html: '<p>안녕하세요 반갑습니다</p>' }]

describe('편집 메뉴 점검 — 글자 서식', () => {
  it('굵게·기울임·밑줄·취소선', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    for (const [label, tag] of [['굵게', '<strong>'], ['기울임', '<em>'], ['밑줄', '<u>'], ['취소선', '<s>']] as const) {
      await selectText(ed)
      await click(label)
      expect(ed.getHTML(), label).toContain(tag)
    }
  })

  it('글자 크기 −/+ 와 크기 목록 시트', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('글자 크게')
    expect(ed.getHTML()).toContain('font-size: 17px')
    await selectText(ed)
    await click('글자 작게')
    await selectText(ed)
    await click('글자 작게')
    expect(ed.getHTML()).toContain('font-size: 15px')
    await selectText(ed)
    await click('글자 크기 목록')
    expect(target.querySelector('.rc-sheet')).toBeTruthy()
  })

  it('서체 시트에서 서체를 고르면 반영된다', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('서체')
    const items = [...target.querySelectorAll<HTMLButtonElement>('.rc-sheet .rc-list-item')]
    expect(items.length).toBeGreaterThan(1)
    items[1].click()
    await wait()
    expect(ed.getHTML()).toContain('font-family')
  })

  it('글자색·배경색 시트', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('글자색')
    target.querySelector<HTMLButtonElement>('.rc-sheet .rc-swatch')!.click()
    await wait()
    expect(ed.getHTML()).toMatch(/color:/)
    await selectText(ed)
    await click('배경색')
    target.querySelector<HTMLButtonElement>('.rc-sheet .rc-swatch')!.click()
    await wait()
    expect(ed.getHTML()).toMatch(/background-color:/)
  })
})

describe('편집 메뉴 점검 — 문단', () => {
  it('정렬 4종(글)', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    for (const [label, v] of [['가운데 정렬', 'center'], ['오른쪽 정렬', 'right'], ['양쪽 정렬', 'justify'], ['왼쪽 정렬', 'left']] as const) {
      await selectText(ed)
      await click(label)
      expect(ed.getHTML(), label).toContain(`text-align: ${v}`)
    }
  })

  it('글머리·번호 목록', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('글머리 목록')
    expect(ed.getHTML()).toContain('<ul')
    await selectText(ed)
    await click('번호 목록')
    expect(ed.getHTML()).toContain('<ol')
  })

  it('들여쓰기·내어쓰기', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('들여쓰기')
    expect(ed.getHTML()).toMatch(/padding-left/)
    await selectText(ed)
    await click('내어쓰기')
    expect(ed.getHTML()).not.toMatch(/padding-left: [1-9]/)
  })

  it('문단 유형: 제목2·제목3·인용·본문', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    for (const [text, tag] of [['제목2', '<h2'], ['제목3', '<h3'], ['인용', '<blockquote'], ['본문', '<p']] as const) {
      await selectText(ed)
      await click('문단 유형')
      sheetBtn(text).click()
      await wait()
      expect(ed.getHTML(), text).toContain(tag)
    }
  })

  it('링크 적용·해제', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('링크')
    const input = target.querySelector<HTMLInputElement>('input[aria-label="링크 주소"]')!
    input.value = 'https://crazyshot.kr'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    target.querySelector<HTMLFormElement>('.rc-sheet form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await wait()
    expect(ed.getHTML()).toContain('href="https://crazyshot.kr')
    await selectText(ed)
    await click('링크')
    sheetBtn('링크 해제').click()
    await wait()
    expect(ed.getHTML()).not.toContain('href=')
  })

  it('서식 지우기', async () => {
    mountEditor([{ type: 'text', html: '<p><strong>안녕하세요</strong> 반갑습니다</p>' }])
    await ready()
    const ed = editorOf()
    await selectText(ed, 1, 6)
    await click('서식 지우기')
    expect(ed.getHTML()).not.toContain('<strong>')
  })

  it('실행취소·다시실행', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    await selectText(ed)
    await click('굵게')
    expect(ed.getHTML()).toContain('<strong>')
    expect(btn('실행취소').disabled).toBe(false)
    await click('실행취소')
    expect(ed.getHTML()).not.toContain('<strong>')
    await click('다시실행')
    expect(ed.getHTML()).toContain('<strong>')
  })
})

describe('편집 메뉴 점검 — 삽입', () => {
  it('구분선·이모지·표', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    ed.commands.setTextSelection(3)
    await wait()
    await click('구분선')
    expect(ed.getHTML()).toContain('<hr')

    await click('이모지')
    target.querySelector<HTMLButtonElement>('.rc-sheet .rc-emoji-btn')!.click()
    await wait()
    expect(ed.getText().length).toBeGreaterThan('안녕하세요 반갑습니다'.length)

    await click('표')
    target.querySelector<HTMLFormElement>('.rc-sheet form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await wait()
    expect(ed.getHTML()).toContain('<table')
  })

  it('사진·첨부 버튼은 파일 선택창을 연다', async () => {
    const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    mountEditor(TEXT)
    await ready()
    await click('사진')
    await click('첨부')
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})

describe('편집 메뉴 점검 — 사진 묶음 선택 시', () => {
  const IMG: ContentBlock[] = [{ type: 'image', layout: 'individual', images: [{ url: 'https://x/a.webp', alt: 'a' }], width: 50 }]
  const attrsOf = (ed: Ed) => ed.getJSON().content?.[0].attrs as { align?: string; width?: number }
  // jsdom에는 레이아웃이 없어 모든 위치가 0 → 화면 밖으로 판정돼 손잡이가 숨겨진다. 화면 안의 위치를 지정해 선택을 갱신한다
  async function placeOnScreen(ed: Ed) {
    const dom = ed.view.nodeDOM(0) as HTMLElement
    dom.getBoundingClientRect = () => ({ left: 200, right: 400, top: 200, bottom: 400, width: 200, height: 200, x: 200, y: 200, toJSON: () => ({}) }) as DOMRect
    ed.commands.setNodeSelection(0)
    await wait()
  }

  it('서식 도구줄의 정렬 버튼이 사진 묶음 정렬로 동작한다(양쪽 정렬은 비활성)', async () => {
    mountEditor(IMG)
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    expect(btn('양쪽 정렬').disabled).toBe(true)
    await click('오른쪽 정렬')
    expect(attrsOf(ed).align).toBe('right')
    expect(btn('오른쪽 정렬').getAttribute('aria-pressed')).toBe('true')
    await click('왼쪽 정렬')
    expect(attrsOf(ed).align).toBe('left')
    await click('가운데 정렬')
    expect(attrsOf(ed).align).toBe('center')
  })

  it('모서리 손잡이를 끌면 폭이 바뀌고 놓을 때 문서에 반영된다(가운데 정렬은 중심 기준 대칭)', async () => {
    mountEditor(IMG)
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    const dom = ed.view.nodeDOM(0) as HTMLElement
    // 폭 50% = 200px → 편집 영역 전체 400px, 가운데 x=300
    dom.getBoundingClientRect = () => ({ left: 200, right: 400, top: 0, bottom: 100, width: 200, height: 100, x: 200, y: 0, toJSON: () => ({}) }) as DOMRect
    await wait(0)
    ed.commands.setNodeSelection(0) // 선택 갱신으로 손잡이 위치 재측정
    await wait()
    const corners = target.querySelectorAll<HTMLElement>('.rc-resize')
    expect(corners.length).toBe(4)
    const se = target.querySelector<HTMLElement>('.rc-resize-se')!
    const ev = (type: string, x: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 50, button: 0 })
    se.dispatchEvent(ev('pointerdown', 400))
    se.dispatchEvent(ev('pointermove', 360)) // 중심(300)에서 60 → 폭 = 2*60/400 = 30%
    await wait()
    expect(dom.style.width).toBe('30%')
    se.dispatchEvent(ev('pointerup', 360))
    await wait(350)
    expect(attrsOf(ed).width).toBe(30)
  })

  it('클릭이 아닌 방법(키보드·코드)으로 선택한 묶음에서도 앞으로·뒤로가 연속으로 동작한다', async () => {
    mountEditor([{ type: 'image', layout: 'individual', images: [{ url: 'https://x/a.webp', alt: 'a' }, { url: 'https://x/b.webp', alt: 'b' }] }])
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    const ctx = (label: string) => target.querySelector<HTMLButtonElement>(`.rc-ctx button[aria-label="${label}"]`)!
    const alts = () => (ed.getJSON().content?.[0].attrs?.images as { alt: string }[]).map((i) => i.alt).join(',')
    ctx('뒤로').click()
    await wait()
    expect(alts()).toBe('b,a')
    expect(ctx('앞으로').disabled).toBe(false) // 이동한 사진을 계속 따라가야 한다(0번으로 돌아가면 비활성)
    ctx('앞으로').click()
    await wait()
    expect(alts()).toBe('a,b')
  })

  it('이미지 도구줄의 크기 아이콘으로 크기 조절 점을 숨기고 다시 보이게 하며, 선택은 기억된다', async () => {
    localStorage.removeItem('rc-image-resize-handles')
    mountEditor(IMG)
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    const toggle = () => target.querySelector<HTMLButtonElement>('.rc-ctx button[aria-label="크기 조절 점 표시/숨김"]')!
    await placeOnScreen(ed)
    expect(target.querySelectorAll('.rc-resize').length).toBe(4) // 기본: 표시
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    toggle().click()
    await wait()
    expect(target.querySelectorAll('.rc-resize').length).toBe(0)
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('rc-image-resize-handles')).toBe('off')
    // 다른 사진을 다시 선택해도 숨김 유지
    ed.commands.setTextSelection(0)
    await placeOnScreen(ed)
    expect(target.querySelectorAll('.rc-resize').length).toBe(0)
    toggle().click()
    await wait()
    expect(target.querySelectorAll('.rc-resize').length).toBe(4)
    expect(localStorage.getItem('rc-image-resize-handles')).toBe('on')
  })

  it('저장된 숨김 선택이 있으면 처음부터 점이 보이지 않는다', async () => {
    localStorage.setItem('rc-image-resize-handles', 'off')
    mountEditor(IMG)
    await ready()
    editorOf().commands.setNodeSelection(0)
    await wait()
    expect(target.querySelectorAll('.rc-resize').length).toBe(0)
    expect(target.querySelector<HTMLButtonElement>('.rc-ctx button[aria-label="크기 조절 점 표시/숨김"]')!.getAttribute('aria-pressed')).toBe('false')
    localStorage.removeItem('rc-image-resize-handles')
  })

  it('왼쪽 정렬이면 오른쪽 모서리만, 오른쪽 정렬이면 왼쪽 모서리만 보인다', async () => {
    mountEditor([{ type: 'image', layout: 'individual', images: [{ url: 'https://x/a.webp', alt: 'a' }], width: 50, align: 'left' }])
    await ready()
    const ed = editorOf()
    await placeOnScreen(ed)
    expect(target.querySelectorAll('.rc-resize-ne, .rc-resize-se').length).toBe(2)
    expect(target.querySelectorAll('.rc-resize-nw, .rc-resize-sw').length).toBe(0)
  })
})

describe('편집 메뉴 점검 — 표 도구줄', () => {
  it('행·열 추가/삭제, 셀 병합/분할, 표 삭제', async () => {
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    ed.commands.setTextSelection(3)
    await wait()
    await click('표')
    target.querySelector<HTMLFormElement>('.rc-sheet form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await wait()
    const rows = () => ed.getHTML().split('<tr').length - 1
    const cols = () => (ed.getHTML().split('</tr>')[0].split('<td').length - 1) + (ed.getHTML().split('</tr>')[0].split('<th').length - 1)
    const ctx = (label: string) => target.querySelector<HTMLButtonElement>(`.rc-ctx button[aria-label="${label}"]`)
    const r0 = rows()
    const c0 = cols()
    expect(ctx('아래에 행 추가'), '표 도구줄').toBeTruthy()
    ctx('아래에 행 추가')!.click(); await wait()
    expect(rows()).toBe(r0 + 1)
    ctx('위에 행 추가')!.click(); await wait()
    expect(rows()).toBe(r0 + 2)
    ctx('행 삭제')!.click(); await wait()
    expect(rows()).toBe(r0 + 1)
    ctx('오른쪽에 열 추가')!.click(); await wait()
    expect(cols()).toBe(c0 + 1)
    ctx('왼쪽에 열 추가')!.click(); await wait()
    expect(cols()).toBe(c0 + 2)
    const labels = [...target.querySelectorAll<HTMLButtonElement>('.rc-ctx button')].map((b) => b.getAttribute('aria-label'))
    expect(labels.some((l) => l?.includes('열 삭제'))).toBe(true)
    expect(labels.some((l) => l?.includes('표 삭제'))).toBe(true)
    ;(ctx('표 삭제') ?? [...target.querySelectorAll<HTMLButtonElement>('.rc-ctx button')].find((b) => b.getAttribute('aria-label')?.includes('표 삭제')))!.click()
    await wait()
    expect(ed.getHTML()).not.toContain('<table')
  })
})

describe('편집 메뉴 점검 — 모바일 도구줄', () => {
  it('굵게·정렬 시트·목록·더보기 시트의 항목이 동작한다', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 767px'), media: q, addEventListener() {}, removeEventListener() {} }))
    mountEditor(TEXT)
    await ready()
    const ed = editorOf()
    const pmEl = target.querySelector<HTMLElement>('.ProseMirror')!
    pmEl.focus()
    pmEl.dispatchEvent(new FocusEvent('focus'))
    await wait()
    await selectText(ed)
    const m = (label: string) => target.querySelector<HTMLButtonElement>(`.rc-mbar button[aria-label="${label}"]`)
    expect(m('굵게'), '모바일 툴바').toBeTruthy()
    m('굵게')!.click(); await wait()
    expect(ed.getHTML()).toContain('<strong>')
    await selectText(ed)
    m('정렬')!.click(); await wait()
    sheetBtn('가운데 정렬').click(); await wait()
    expect(ed.getHTML()).toContain('text-align: center')
    await selectText(ed)
    m('글머리 목록')!.click(); await wait()
    expect(ed.getHTML()).toContain('<ul')
    await selectText(ed)
    m('더보기')!.click(); await wait()
    const more = [...target.querySelectorAll<HTMLButtonElement>('.rc-sheet .rc-more-item')].find((b) => b.textContent?.includes('취소선'))!
    more.click(); await wait()
    expect(ed.getHTML()).toContain('<s>')
  })
})

describe('편집 메뉴 점검 — 사진 더블클릭 뷰어', () => {
  // 뷰어의 요소 크기 바인딩(bind:clientWidth)이 ResizeObserver를 쓰는데 jsdom에는 없다(테스트 환경 한계, 실제 브라우저에는 있음)
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  })
  it('문서 안 모든 묶음의 사진이 문서 순서로 뷰어에 나열되고, 더블클릭한 사진부터 보인다', async () => {
    mountEditor([
      { type: 'image', layout: 'individual', images: [{ url: 'https://x/a.webp', alt: 'a' }, { url: 'https://x/b.webp', alt: 'b' }] },
      { type: 'text', html: '<p>사이</p>' },
      { type: 'image', layout: 'collage', images: [{ url: 'https://x/c.webp', alt: 'c' }] },
    ])
    await ready()
    const figs = target.querySelectorAll<HTMLElement>('figure.rc-fig')
    expect(figs.length).toBe(3)
    figs[2].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })) // 두 번째 묶음의 c
    await wait(50)
    expect(document.querySelectorAll('.mv-backdrop').length).toBe(1)
    document.querySelector<HTMLButtonElement>('.mv-backdrop button[aria-label="썸네일 정렬"]')!.click()
    await wait()
    expect(document.querySelectorAll('.mv-thumb').length).toBe(3) // 다른 묶음의 사진까지 전부
    expect(document.querySelector('.mv-count')?.textContent).toContain('3 / 3') // 더블클릭한 c 가 3번째
    document.querySelector<HTMLButtonElement>('.mv-backdrop button[aria-label="닫기"]')!.click()
    await wait()
  })
})
