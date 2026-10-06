// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import RichContentEditor from '$lib/components/editor/RichContentEditor.svelte'
import type { ContentBlock } from '$lib/types/content-editor'

/**
 * RichContentEditor — 실제 컴포넌트 mount 검증 (2026-10-05)
 * 핵심 회귀: 툴바 클릭(굵게·크기·정렬·제목)에도 텍스트 선택이 유지되고 결과가 문서에 반영된다.
 * 실행: npm run test:component
 */

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
let api: { flush: () => { blocks: ContentBlock[]; ok: boolean }; isDirty: () => boolean; setBlocks: (b: ContentBlock[]) => void }

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}

async function ready() {
  for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
  expect(target.querySelector('.ProseMirror')).toBeTruthy()
}

function mountEditor(blocks: ContentBlock[], extra: Record<string, unknown> = {}) {
  const props = { blocks, keywords: [] as string[], ...extra }
  app = mount(RichContentEditor, { target, props })
  api = app as unknown as typeof api
  return props
}

function btn(label: string): HTMLButtonElement {
  const el = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
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
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

describe('RichContentEditor — mount', () => {
  it('기존 블록을 단일 문서로 불러오고, 건드리지 않으면 원본을 그대로 돌려준다(무변경 저장)', async () => {
    const original: ContentBlock[] = [
      { type: 'text', html: '<div style="text-align: center;"><span style="font-size: 17px;">안녕</span></div>' },
      { type: 'text', html: '<p>앞<sources-carousel-inline>칩</sources-carousel-inline></p>' },
    ]
    mountEditor(original)
    await ready()
    expect(target.querySelector('.rc-legacy')).toBeTruthy() // 변환 불가 블록은 원본 보존 카드
    expect(target.textContent).toContain('안녕')
    const out = api.flush()
    expect(out.blocks).toBe(original) // 같은 참조 = 재직렬화 없음
    expect(api.isDirty()).toBe(false)
  })

  it('툴바 굵게·크기·정렬·제목 클릭 후에도 선택이 유지되고 결과가 저장 형식에 반영된다', async () => {
    mountEditor([{ type: 'text', html: '<p>안녕하세요 반갑습니다</p>' }])
    await ready()
    const pm = target.querySelector<HTMLElement>('.ProseMirror')!
    const editor = (pm as unknown as { editor: import('@tiptap/core').Editor }).editor
    editor.commands.setTextSelection({ from: 1, to: 6 })
    await wait()

    btn('굵게').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    btn('굵게').click()
    await wait()
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)

    btn('글자 크게').click()
    await wait()
    btn('가운데 정렬').click()
    await wait()
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)

    const html = editor.getHTML()
    expect(html).toContain('<strong>')
    expect(html).toContain('font-size: 17px')
    expect(html).toContain('text-align: center')

    await wait(350) // 디바운스 동기화
    expect(api.isDirty()).toBe(true)
    const out = api.flush()
    expect(out.ok).toBe(true)
    expect((out.blocks[0] as { html: string }).html).toContain('font-size: 17px')
  })

  it('툴바 mousedown은 기본 동작(포커스 이동)을 막는다', async () => {
    mountEditor([{ type: 'text', html: '<p>a</p>' }])
    await ready()
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn('굵게').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('사진 묶음을 선택하면 도구줄이 나타나고 레이아웃 전환·대표 지정/해제가 된다', async () => {
    mountEditor([
      { type: 'image', layout: 'individual', images: [{ url: 'https://x/a.webp', alt: 'a' }, { url: 'https://x/b.webp', alt: 'b' }] },
    ])
    await ready()
    const pm = target.querySelector<HTMLElement>('.ProseMirror')!
    const editor = (pm as unknown as { editor: import('@tiptap/core').Editor }).editor
    editor.commands.setNodeSelection(0)
    await wait()
    expect(target.querySelector('.rc-ctx')).toBeTruthy()

    ;[...target.querySelectorAll<HTMLButtonElement>('.rc-ctx button')].find((b) => b.getAttribute('aria-label') === '콜라주')!.click()
    await wait()
    expect(editor.getJSON().content?.[0].attrs?.layout).toBe('collage')

    ;[...target.querySelectorAll<HTMLButtonElement>('.rc-ctx button')].find((b) => b.getAttribute('aria-label') === '대표 지정')!.click()
    await wait()
    expect((editor.getJSON().content?.[0].attrs?.images as { isHead?: boolean }[])[0].isHead).toBe(true)
    ;[...target.querySelectorAll<HTMLButtonElement>('.rc-ctx button')].find((b) => b.getAttribute('aria-label') === '대표 해제')!.click()
    await wait()
    expect((editor.getJSON().content?.[0].attrs?.images as { isHead?: boolean }[])[0].isHead).toBeUndefined()
  })

  it('유튜브 주소로 동영상을 커서 위치에 삽입하고 저장 형식은 youtube 블록이다', async () => {
    mountEditor([{ type: 'text', html: '<p>본문</p>' }])
    await ready()
    btn('동영상').click()
    await wait()
    const input = target.querySelector<HTMLInputElement>('input[aria-label="유튜브 주소"]')!
    input.value = 'https://youtu.be/dQw4w9WgXcQ'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    target.querySelector<HTMLFormElement>('.rc-sheet form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await wait(350)
    const out = api.flush()
    expect(out.blocks.some((b) => b.type === 'youtube' && b.videoId === 'dQw4w9WgXcQ')).toBe(true)
  })

  describe('이미지 묶음 편집', () => {
    const img = (n: string, extra: Record<string, unknown> = {}) => ({ url: `https://x/${n}.webp`, alt: n, ...extra })
    const groups = (editor: import('@tiptap/core').Editor) =>
      (editor.getJSON().content ?? []).filter((n) => n.type === 'imageGroup').map((g) => g.attrs as { layout: string; images: { url: string; alt: string; isHead?: boolean }[] })
    const editorOf = () => (target.querySelector<HTMLElement>('.ProseMirror') as unknown as { editor: import('@tiptap/core').Editor }).editor
    const ctxBtn = (label: string) => target.querySelector<HTMLButtonElement>(`.rc-ctx button[aria-label="${label}"]`)!

    it('묶음이 선택된 상태에서 동영상을 넣어도 기존 묶음이 사라지지 않는다(덮어쓰기 회귀)', async () => {
      mountEditor([{ type: 'image', layout: 'individual', images: [img('a')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      btn('동영상').click()
      await wait()
      const input = target.querySelector<HTMLInputElement>('input[aria-label="유튜브 주소"]')!
      input.value = 'https://youtu.be/dQw4w9WgXcQ'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait()
      target.querySelector<HTMLFormElement>('.rc-sheet form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await wait()
      expect(groups(editor)).toHaveLength(1)
      expect(editor.getJSON().content?.some((n) => n.type === 'youtubeEmbed')).toBe(true)
    })

    it('묶음 나누기·합치기: 한 장씩 나뉘고, 바로 다음 묶음과 다시 합쳐진다', async () => {
      mountEditor([{ type: 'image', layout: 'collage', images: [img('a'), img('b'), img('c')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('묶음 나누기').click()
      await wait()
      expect(groups(editor).map((g) => g.images.length)).toEqual([1, 1, 1])
      editor.commands.setNodeSelection(0)
      await wait()
      expect(ctxBtn('다음 묶음과 합치기').disabled).toBe(false)
      ctxBtn('다음 묶음과 합치기').click()
      await wait()
      expect(groups(editor).map((g) => g.images.map((i) => i.alt))).toEqual([['a', 'b'], ['c']])
    })

    it('대표 이미지는 문서 전체에서 1장만 유지되고, 합칠 때도 중복되지 않는다', async () => {
      mountEditor([
        { type: 'image', layout: 'individual', images: [img('a', { isHead: true })] },
        { type: 'image', layout: 'individual', images: [img('b')] },
      ])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(editor.state.doc.firstChild!.nodeSize)
      await wait()
      ctxBtn('대표 지정').click()
      await wait()
      const heads = groups(editor).flatMap((g) => g.images).filter((i) => i.isHead)
      expect(heads.map((i) => i.alt)).toEqual(['b'])
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('다음 묶음과 합치기').click()
      await wait()
      expect(groups(editor).flatMap((g) => g.images).filter((i) => i.isHead)).toHaveLength(1)
    })

    it('사진 설명(alt) 편집과 앞으로·뒤로 순서 변경이 저장 형식에 반영된다', async () => {
      mountEditor([{ type: 'image', layout: 'slide', images: [img('a'), img('b'), img('c')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('뒤로').click() // 활성 사진 0 → 뒤로: a와 b 교환
      await wait()
      expect(groups(editor)[0].images.map((i) => i.alt)).toEqual(['b', 'a', 'c'])
      ctxBtn('사진 설명(대체 텍스트)').click()
      await wait()
      const input = target.querySelector<HTMLInputElement>('input[aria-label="사진 설명"]')!
      input.value = '새 설명'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait()
      target.querySelector<HTMLFormElement>('.rc-sheet form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await wait(350)
      expect(groups(editor)[0].images.some((i) => i.alt === '새 설명')).toBe(true)
      const out = api.flush()
      expect(out.ok).toBe(true)
      const saved = out.blocks.find((b) => b.type === 'image') as { images: { alt: string }[] }
      expect(saved.images).toHaveLength(3)
    })

    function stubFigRects(editor: import('@tiptap/core').Editor) {
      const dom = editor.view.nodeDOM(0) as HTMLElement
      const figs = Array.from(dom.querySelectorAll<HTMLElement>('figure.rc-fig'))
      figs.forEach((f, i) => {
        f.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, top: 0, bottom: 100, width: 100, height: 100, x: i * 100, y: 0, toJSON: () => ({}) }) as DOMRect
      })
      return figs
    }
    const ptr = (type: string, x: number, y = 50) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })

    it('선택된 묶음의 사진을 끌어 놓으면 순서가 바뀌고 저장 형식에 반영된다', async () => {
      mountEditor([{ type: 'image', layout: 'collage', images: [img('a'), img('b'), img('c')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      const figs = stubFigRects(editor)
      const down = ptr('pointerdown', 50)
      figs[0].dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true) // PM 노드 드래그가 시작되지 않게 막힘
      window.dispatchEvent(ptr('pointermove', 150))
      window.dispatchEvent(ptr('pointermove', 250)) // c 위
      expect(figs[2].classList.contains('rc-fig-drop')).toBe(true)
      expect(figs[0].classList.contains('rc-fig-dragging')).toBe(true)
      window.dispatchEvent(ptr('pointerup', 250))
      await wait(350)
      expect(groups(editor)[0].images.map((i) => i.alt)).toEqual(['b', 'c', 'a'])
      expect(target.querySelector('.rc-fig-dragging, .rc-fig-drop')).toBeNull()
      const saved = api.flush().blocks.find((b) => b.type === 'image') as { images: { alt: string }[] }
      expect(saved.images.map((i) => i.alt)).toEqual(['b', 'c', 'a'])
    })

    it('조금만 움직이거나 Esc를 누르면 순서가 바뀌지 않는다', async () => {
      mountEditor([{ type: 'image', layout: 'collage', images: [img('a'), img('b')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      const figs = stubFigRects(editor)
      figs[0].dispatchEvent(ptr('pointerdown', 50))
      window.dispatchEvent(ptr('pointermove', 52)) // 임계값(6px) 미만
      window.dispatchEvent(ptr('pointerup', 52))
      await wait()
      expect(groups(editor)[0].images.map((i) => i.alt)).toEqual(['a', 'b'])

      figs[0].dispatchEvent(ptr('pointerdown', 50))
      window.dispatchEvent(ptr('pointermove', 150))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      window.dispatchEvent(ptr('pointerup', 150))
      await wait()
      expect(groups(editor)[0].images.map((i) => i.alt)).toEqual(['a', 'b'])
    })

    it('선택되지 않은 묶음이나 사진 1장짜리 묶음에서는 끌기를 가로채지 않는다', async () => {
      mountEditor([{ type: 'image', layout: 'individual', images: [img('a')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      const figs = stubFigRects(editor)
      const down = ptr('pointerdown', 50)
      figs[0].dispatchEvent(down)
      expect(down.defaultPrevented).toBe(false)
    })

    it('사진 크기·정렬 시트에서 폭 프리셋·슬라이더·정렬을 바꾸면 문서와 저장 형식에 반영된다', async () => {
      mountEditor([{ type: 'image', layout: 'individual', images: [img('a')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('사진 크기·정렬').click()
      await wait()
      const chip = [...target.querySelectorAll<HTMLButtonElement>('.rc-sheet .rc-chipbtn')].find((b) => b.textContent?.trim() === '50%')!
      chip.click()
      await wait()
      expect(editor.getJSON().content?.[0].attrs?.width).toBe(50)
      const group = target.querySelector<HTMLElement>('.rc-images')!
      expect(group.style.width).toBe('50%')

      const slider = target.querySelector<HTMLInputElement>('input[aria-label="사진 묶음 폭(%)"]')!
      slider.value = '35'
      slider.dispatchEvent(new Event('change', { bubbles: true }))
      await wait()
      expect(editor.getJSON().content?.[0].attrs?.width).toBe(35)

      target.querySelector<HTMLButtonElement>('.rc-sheet button[aria-label="오른쪽 정렬"]')!.click()
      await wait(350)
      expect(editor.getJSON().content?.[0].attrs?.align).toBe('right')
      const saved = api.flush().blocks.find((b) => b.type === 'image') as { width?: number; align?: string }
      expect(saved.width).toBe(35)
      expect(saved.align).toBe('right')
    })

    it('묶음 나누기·합치기에서 폭·정렬이 유지된다', async () => {
      mountEditor([{ type: 'image', layout: 'collage', images: [img('a'), img('b')], width: 60, align: 'left' }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('묶음 나누기').click()
      await wait()
      const g = (editor.getJSON().content ?? []).filter((n) => n.type === 'imageGroup')
      expect(g.map((n) => [n.attrs?.width, n.attrs?.align])).toEqual([[60, 'left'], [60, 'left']])
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('다음 묶음과 합치기').click()
      await wait()
      const merged = (editor.getJSON().content ?? []).find((n) => n.type === 'imageGroup')!
      expect([merged.attrs?.width, merged.attrs?.align]).toEqual([60, 'left'])
    })

    it('합치면 30장을 넘을 때는 일부를 자르지 않고 합치기를 거부한다(대표 이미지 유실 방지)', async () => {
      const many = Array.from({ length: 20 }, (_, i) => img(`m${i}`))
      mountEditor([
        { type: 'image', layout: 'individual', images: many },
        { type: 'image', layout: 'individual', images: [...many.slice(0, 10), img('head', { isHead: true }), ...many.slice(10)] },
      ])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      ctxBtn('다음 묶음과 합치기').click()
      await wait()
      const gs = groups(editor)
      expect(gs).toHaveLength(2)
      expect(gs[0].images).toHaveLength(20)
      expect(gs[1].images.some((i) => i.isHead)).toBe(true)
    })

    it('끄는 사이 선택이 다른 묶음으로 옮겨가도 끌던 묶음만 순서가 바뀌고 다른 묶음은 그대로다', async () => {
      mountEditor([
        { type: 'image', layout: 'collage', images: [img('a'), img('b'), img('c')] },
        { type: 'image', layout: 'collage', images: [img('x'), img('y')] },
      ])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      const figs = stubFigRects(editor)
      figs[0].dispatchEvent(ptr('pointerdown', 50))
      window.dispatchEvent(ptr('pointermove', 150))
      window.dispatchEvent(ptr('pointermove', 250))
      editor.commands.setNodeSelection(editor.state.doc.firstChild!.nodeSize) // 드래그 중 다른 묶음으로 선택 이동
      await wait()
      window.dispatchEvent(ptr('pointerup', 250))
      await wait()
      const gs = groups(editor)
      expect(gs[0].images.map((i) => i.alt)).toEqual(['b', 'c', 'a'])
      expect(gs[1].images.map((i) => i.alt)).toEqual(['x', 'y'])
    })

    it('끄는 도중 끌던 묶음이 지워지면 아무것도 반영하지 않고 오류도 없다', async () => {
      mountEditor([{ type: 'image', layout: 'collage', images: [img('a'), img('b'), img('c')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      const figs = stubFigRects(editor)
      figs[0].dispatchEvent(ptr('pointerdown', 50))
      window.dispatchEvent(ptr('pointermove', 150))
      window.dispatchEvent(ptr('pointermove', 250))
      editor.chain().focus().deleteSelection().run()
      await wait()
      window.dispatchEvent(ptr('pointerup', 250))
      await wait()
      expect(groups(editor)).toHaveLength(0)
    })

    it('끄는 도중 앞쪽에 다른 노드가 삽입돼 위치만 밀려도 순서 변경은 정상 반영된다(오탐 방지)', async () => {
      mountEditor([{ type: 'image', layout: 'collage', images: [img('a'), img('b'), img('c')] }])
      await ready()
      const editor = editorOf()
      editor.commands.setNodeSelection(0)
      await wait()
      const figs = stubFigRects(editor)
      figs[0].dispatchEvent(ptr('pointerdown', 50))
      window.dispatchEvent(ptr('pointermove', 150))
      window.dispatchEvent(ptr('pointermove', 250))
      editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: '위에 새로 생긴 문단' }] }) // 묶음 위치가 밀림
      await wait()
      expect(editor.state.selection.from).toBeGreaterThan(0)
      window.dispatchEvent(ptr('pointerup', 250))
      await wait()
      expect(groups(editor)[0].images.map((i) => i.alt)).toEqual(['b', 'c', 'a'])
    })
  })
})
