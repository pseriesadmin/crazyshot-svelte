// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import DocEditor from '$lib/modules/doc-editor/ui/DocEditor.svelte'
import type { JSONContent, Editor } from '@tiptap/core'

/**
 * doc-editor — RichContentEditor 개선분 이관 검증 (2026-10-16)
 *  ① 서식 도구줄 정렬 버튼이 선택된 이미지의 정렬로 동작  ② 이미지 모서리 손잡이로 크기 조절  ③ 더블클릭 → onEditImage → replace
 * 실행: npm run test:component
 */

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}
async function ready() {
  for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
  expect(target.querySelector('.ProseMirror')).toBeTruthy()
}
const editorOf = () => (target.querySelector<HTMLElement>('.ProseMirror') as unknown as { editor: Editor }).editor
const imgDoc = (attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'tiptap-doc',
  doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x/a.webp', width: 200, align: 'center', ...attrs } }] },
}) as unknown as JSONContent
function mountEditor(attrs: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  app = mount(DocEditor, { target, props: { iconFontUrl: null, initialContent: imgDoc(attrs), ...extra } })
}
const tb = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const imgAttrs = (ed: Editor) => ed.getJSON().content?.[0].attrs as { align?: string; width?: number; src?: string }

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

describe('doc-editor — 이미지 정렬(서식 도구줄)', () => {
  it('이미지를 선택하면 정렬 버튼이 이미지 정렬로 동작하고, 양쪽 정렬은 비활성이다', async () => {
    mountEditor()
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    expect(tb('양쪽 정렬').disabled).toBe(true)
    tb('오른쪽 정렬').click()
    await wait()
    expect(imgAttrs(ed).align).toBe('right')
    expect(tb('오른쪽 정렬').getAttribute('aria-pressed')).toBe('true')
    tb('왼쪽 정렬').click()
    await wait()
    expect(imgAttrs(ed).align).toBe('left')
    tb('가운데 정렬').click()
    await wait()
    expect(imgAttrs(ed).align).toBe('center')
  })

  it('겹치기 이미지는 정렬 버튼이 비활성이다', async () => {
    mountEditor({ overlay: true, x: 10, y: 10 })
    await ready()
    editorOf().commands.setNodeSelection(0)
    await wait()
    expect(tb('가운데 정렬').disabled).toBe(true)
  })
})

describe('doc-editor — 이미지 모서리 크기 조절', () => {
  async function select(attrs: Record<string, unknown> = {}) {
    mountEditor(attrs)
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    const img = target.querySelector<HTMLImageElement>('.ProseMirror img')!
    img.getBoundingClientRect = () => ({ left: 100, right: 300, top: 0, bottom: 100, width: 200, height: 100, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect
    return { ed, img }
  }
  const handle = (id: string) => target.querySelector<HTMLElement>(`[data-de-resize="${id}"]`)!
  const visible = () => [...target.querySelectorAll<HTMLElement>('[data-de-resize]')].filter((h) => h.style.display !== 'none').map((h) => h.dataset.deResize)
  const ptr = (type: string, x: number) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 50, button: 0 })

  it('가운데 정렬: 네 모서리가 보이고, 끌면 중심 기준 대칭으로 너비가 바뀌며 놓을 때 문서에 반영된다', async () => {
    const { ed, img } = await select()
    expect(visible().sort()).toEqual(['ne', 'nw', 'se', 'sw'])
    const se = handle('se')
    se.dispatchEvent(ptr('pointerdown', 300))
    se.dispatchEvent(ptr('pointermove', 350)) // 중심(200)에서 150 → 300px
    expect(img.style.width).toBe('300px')
    expect(target.textContent).toContain('300px')
    expect(imgAttrs(ed).width).toBe(200) // 끄는 동안은 문서 변경 없음
    se.dispatchEvent(ptr('pointerup', 350))
    await wait()
    expect(imgAttrs(ed).width).toBe(300)
  })

  it('너비는 20~1200px로 제한된다', async () => {
    const { ed } = await select()
    const se = handle('se')
    se.dispatchEvent(ptr('pointerdown', 300))
    se.dispatchEvent(ptr('pointermove', 205)) // 너무 작게
    se.dispatchEvent(ptr('pointerup', 205))
    await wait()
    expect(imgAttrs(ed).width).toBe(20)
  })

  it('왼쪽 정렬이면 오른쪽 모서리만, 오른쪽 정렬이면 왼쪽 모서리만, 겹치기는 오른쪽만 보인다', async () => {
    await select({ align: 'left' })
    expect(visible().sort()).toEqual(['ne', 'se'])
    unmount(app!)
    app = null
    target.replaceChildren()
    await select({ align: 'right' })
    expect(visible().sort()).toEqual(['nw', 'sw'])
    unmount(app!)
    app = null
    target.replaceChildren()
    await select({ overlay: true, x: 0, y: 0 })
    expect(visible().sort()).toEqual(['ne', 'se'])
  })

  it('도구줄의 크기 아이콘으로 모서리 점을 숨기고 다시 보이게 하며, 선택은 기억된다', async () => {
    localStorage.removeItem('de-image-resize-handles')
    await select()
    expect(visible().length).toBe(4)
    const toggle = () => [...target.querySelectorAll<HTMLButtonElement>('.ProseMirror button')].find((b) => b.getAttribute('aria-label') === '크기 조절 점 표시/숨김')!
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    toggle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(visible().length).toBe(0)
    expect(toggle().getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('de-image-resize-handles')).toBe('off')
    toggle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(visible().length).toBe(4)
    expect(localStorage.getItem('de-image-resize-handles')).toBe('on')
  })

  it('선택하지 않은 이미지에는 손잡이가 보이지 않는다', async () => {
    mountEditor()
    await ready()
    const ed = editorOf()
    ed.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: '앞 문단' }] })
    ed.commands.setTextSelection(2) // 이미지 밖(문단)으로 선택 이동
    await wait()
    expect(visible()).toEqual([])
  })
})

describe('doc-editor — 이미지 더블클릭(뷰어 연동 지점)', () => {
  it('더블클릭하면 onEditImage가 호출되고, replace(새 주소)로 src만 교체된다(너비·정렬 유지)', async () => {
    const onEditImage = vi.fn()
    mountEditor({ width: 150, align: 'left' }, { onEditImage })
    await ready()
    const ed = editorOf()
    target.querySelector('.ProseMirror img')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(onEditImage).toHaveBeenCalledTimes(1)
    const info = onEditImage.mock.calls[0][0] as { src: string; replace: (s: string) => void }
    expect(info.src).toBe('https://x/a.webp')
    info.replace('data:image/webp;base64,AAAA')
    await wait()
    expect(imgAttrs(ed)).toMatchObject({ src: 'data:image/webp;base64,AAAA', width: 150, align: 'left' })
  })

  const barBtn = (title: string) => [...target.querySelectorAll<HTMLButtonElement>('.ProseMirror button')].find((b) => b.title.startsWith(title))!
  const down = (el: Element) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

  it('더블클릭은 보기(startEdit=false), 이미지 도구줄의 "편집" 버튼은 바로 편집(startEdit=true)으로 호출한다', async () => {
    const onEditImage = vi.fn()
    mountEditor({}, { onEditImage })
    await ready()
    editorOf().commands.setNodeSelection(0)
    await wait()
    target.querySelector('.ProseMirror img')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(onEditImage.mock.calls[0][0].startEdit).toBe(false)
    down(barBtn('이미지 편집'))
    expect(onEditImage).toHaveBeenCalledTimes(2)
    expect(onEditImage.mock.calls[1][0].startEdit).toBe(true)
    expect(onEditImage.mock.calls[1][0].src).toBe('https://x/a.webp')
  })

  it('ALT 버튼으로 사진 설명을 입력하면 alt가 저장되고, 있으면 버튼이 강조된다', async () => {
    mountEditor({ width: 120, align: 'left' })
    await ready()
    const ed = editorOf()
    ed.commands.setNodeSelection(0)
    await wait()
    const altBtn = barBtn('사진 설명')
    down(altBtn)
    const input = target.querySelector<HTMLInputElement>('.ProseMirror input[placeholder="사진 설명"]')!
    expect(input.style.display).toBe('block')
    input.value = '카메라 정면'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await wait()
    expect(imgAttrs(ed)).toMatchObject({ alt: '카메라 정면', width: 120, align: 'left' })
    expect(altBtn.dataset.state).toBe('active')
  })

  it('문서 안 모든 이미지(문서 순서)와 눌린 이미지 순번을 넘기고, 어느 이미지든 replace는 그 자리의 src만 바꾼다', async () => {
    const onEditImage = vi.fn()
    app = mount(DocEditor, {
      target,
      props: {
        iconFontUrl: null,
        onEditImage,
        initialContent: {
          type: 'tiptap-doc',
          doc: {
            type: 'doc',
            content: [
              { type: 'image', attrs: { src: 'https://x/a.webp', alt: 'A', width: 100, align: 'center' } },
              { type: 'paragraph', content: [{ type: 'text', text: '사이' }] },
              { type: 'image', attrs: { src: 'https://x/b.webp', alt: 'B', width: 150, align: 'left' } },
              { type: 'image', attrs: { src: 'https://x/c.webp', alt: 'C', width: 250, align: 'right' } },
            ],
          },
        } as unknown as JSONContent,
      },
    })
    await ready()
    const imgs = target.querySelectorAll('.ProseMirror img')
    expect(imgs.length).toBe(3)
    imgs[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })) // 두 번째(B)
    const info = onEditImage.mock.calls[0][0] as { images: { src: string; alt: string; replace: (s: string) => void }[]; index: number }
    expect(info.images.map((i) => i.src)).toEqual(['https://x/a.webp', 'https://x/b.webp', 'https://x/c.webp'])
    expect(info.images.map((i) => i.alt)).toEqual(['A', 'B', 'C'])
    expect(info.index).toBe(1)
    info.images[2].replace('data:image/webp;base64,CCCC') // 눌린 이미지가 아닌 C 를 교체
    info.images[2].replace('data:image/webp;base64,DDDD') // 같은 이미지를 한 번 더 교체해도 같은 자리를 찾는다
    await wait()
    const nodes = (editorOf().getJSON().content ?? []).filter((n) => n.type === 'image').map((n) => n.attrs as { src: string; width: number; align: string })
    expect(nodes.map((n) => n.src)).toEqual(['https://x/a.webp', 'https://x/b.webp', 'data:image/webp;base64,DDDD'])
    expect(nodes[2]).toMatchObject({ width: 250, align: 'right' })
  })

  it('읽기 전용에서는 더블클릭해도 호출되지 않는다', async () => {
    const onEditImage = vi.fn()
    mountEditor({}, { onEditImage, readonly: true })
    await ready()
    target.querySelector('.ProseMirror img')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(onEditImage).not.toHaveBeenCalled()
  })
})
