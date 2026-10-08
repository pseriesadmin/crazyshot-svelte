// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * PdfViewer 컴포넌트 mount 검증 (자체 PDF 뷰어, 2026-10-08)
 * pdf.js는 jsdom에서 그릴 수 없어 가짜로 대체한다 — 여기서는 "불러오기·오류 표시·도구줄 동작·확장 훅(prepareBytes/onLoaded)"을 검증한다.
 * 실제 캔버스 그림·스크롤·인쇄는 브라우저에서 눈으로 확인해야 한다(TASK.md 체크리스트).
 * 실행: npm run test:component
 */

const pdfState = vi.hoisted(() => ({ numPages: 3, getDocumentArgs: [] as { data: Uint8Array }[] }))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {} as Record<string, string>,
  getDocument: (args: { data: Uint8Array }) => {
    pdfState.getDocumentArgs.push(args)
    const doc = {
      numPages: pdfState.numPages,
      getPage: async () => ({
        rotate: 0,
        getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => {
          const swap = (rotation ?? 0) % 180 !== 0
          return { width: (swap ? 842 : 595) * scale, height: (swap ? 595 : 842) * scale }
        },
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
      }),
      destroy: async () => {},
    }
    return { promise: Promise.resolve(doc) }
  },
}))

import PdfViewer from '$lib/components/common/PdfViewer.svelte'

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}

async function until(cond: () => boolean, tries = 60) {
  for (let i = 0; i < tries && !cond(); i++) await wait(10)
  expect(cond()).toBe(true)
}

function fetchStub(status: number, bytes = new Uint8Array([37, 80, 68, 70, 45, 49])) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes.buffer.slice(0) }))
}

function btn(label: string): HTMLElement {
  const el = target.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  expect(el, `버튼 ${label}`).toBeTruthy()
  return el!
}

beforeEach(() => {
  pdfState.numPages = 3
  pdfState.getDocumentArgs = []
  target = document.createElement('div')
  document.body.appendChild(target)
  // jsdom에 없는 브라우저 API 대체
  class Observer { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo']
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext']
})

afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

describe('PdfViewer — 불러오기와 도구줄', () => {
  it('PDF를 불러오면 전체 쪽 수·배율·쪽 박스를 표시하고 onLoaded로 원본 바이트를 넘긴다', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])
    vi.stubGlobal('fetch', fetchStub(200, bytes))
    const onLoaded = vi.fn()
    app = mount(PdfViewer, { target, props: { src: '/api/x?view=1', title: '전자계약서_TEST.pdf', downloadUrl: '/api/x', downloadFilename: 'c.pdf', onLoaded } })
    await until(() => target.querySelectorAll('[data-page]').length === 3)

    expect(target.textContent).toContain('/ 3')
    expect(target.querySelector('.pv-zoom')?.textContent).toMatch(/^\d+%$/)
    expect(onLoaded).toHaveBeenCalledTimes(1)
    const info = onLoaded.mock.calls[0][0]
    expect(info.pageCount).toBe(3)
    expect(Array.from(info.bytes)).toEqual(Array.from(bytes))
    // 내려받기 링크는 서버 attachment 주소(교부 증빙 기록 경로)를 가리킨다
    const dl = btn('PDF 내려받기') as HTMLAnchorElement
    expect(dl.getAttribute('href')).toBe('/api/x')
    expect(dl.getAttribute('download')).toBe('c.pdf')
  })

  it('prepareBytes 훅(복호화 등)이 그리기 전에 바이트를 변환하고, 변환된 바이트가 pdf.js와 onLoaded로 전달된다', async () => {
    vi.stubGlobal('fetch', fetchStub(200, new Uint8Array([1, 2, 3])))
    const prepareBytes = vi.fn(async (b: Uint8Array) => new Uint8Array([...b, 9, 9]))
    const onLoaded = vi.fn()
    app = mount(PdfViewer, { target, props: { src: '/x', prepareBytes, onLoaded } })
    await until(() => onLoaded.mock.calls.length === 1)
    expect(prepareBytes).toHaveBeenCalledTimes(1)
    expect(Array.from(prepareBytes.mock.calls[0][0])).toEqual([1, 2, 3])
    expect(Array.from(onLoaded.mock.calls[0][0].bytes)).toEqual([1, 2, 3, 9, 9])
    expect(Array.from(pdfState.getDocumentArgs[0].data)).toEqual([1, 2, 3, 9, 9])
  })

  it('PDF가 아직 없으면(404) "준비 중" 안내와 내려받기 링크를 보이고 onError를 호출한다', async () => {
    vi.stubGlobal('fetch', fetchStub(404))
    const onError = vi.fn()
    app = mount(PdfViewer, { target, props: { src: '/x', downloadUrl: '/api/x', onError } })
    await until(() => !!target.querySelector('[role="alert"]'))
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('준비 중')
    expect(target.querySelector('.pv-link')?.getAttribute('href')).toBe('/api/x')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(target.querySelectorAll('[data-page]').length).toBe(0)
  })

  it('로그인이 풀린 경우(401)와 서버 오류(500)는 서로 다른 안내를 보인다', async () => {
    vi.stubGlobal('fetch', fetchStub(401))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => !!target.querySelector('[role="alert"]'))
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('로그인')
    unmount(app)
    app = null
    target.innerHTML = ''

    vi.stubGlobal('fetch', fetchStub(500))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => !!target.querySelector('[role="alert"]'))
    expect(target.querySelector('[role="alert"]')?.textContent).toContain('불러오지 못했어요')
  })

  it('확대·축소 버튼은 100% 기준으로 125%·75%로 한 단계씩 이동한다', async () => {
    vi.stubGlobal('fetch', fetchStub(200))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => target.querySelectorAll('[data-page]').length === 3)
    const zoomText = () => target.querySelector('.pv-zoom')?.textContent
    expect(zoomText()).toBe('100%') // jsdom은 영역 너비가 0이라 가로 맞춤이 100%로 대체됨
    btn('확대').click()
    await wait()
    expect(zoomText()).toBe('125%')
    btn('축소').click()
    btn('축소').click()
    await wait()
    expect(zoomText()).toBe('75%')
    btn('가로 폭에 맞추기').click()
    await wait()
    expect(zoomText()).toBe('100%')
  })

  it('쪽 번호 입력은 1~전체 쪽으로 고정되고, 숫자가 아니면 현재 쪽(직전 이동한 쪽)으로 되돌린다', async () => {
    vi.stubGlobal('fetch', fetchStub(200))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => target.querySelectorAll('[data-page]').length === 3)
    const input = target.querySelector<HTMLInputElement>('.pv-page-input')!
    input.focus()
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
    await wait()
    expect(input.value).toBe('3')
    input.focus()
    input.value = 'abc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
    await wait()
    expect(input.value).toBe('3') // 직전에 3쪽으로 이동했으므로 현재 쪽(3)으로 되돌아간다
  })

  it('회전하면 쪽 박스의 가로·세로가 바뀐다', async () => {
    vi.stubGlobal('fetch', fetchStub(200))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => target.querySelectorAll('[data-page]').length === 3)
    const box = () => {
      const el = target.querySelector<HTMLElement>('[data-page="1"]')!
      return { w: parseInt(el.style.width), h: parseInt(el.style.height) }
    }
    const before = box()
    expect(before.h).toBeGreaterThan(before.w) // A4 세로
    btn('시계 방향으로 회전').click()
    await wait()
    const after = box()
    expect(after.w).toBeGreaterThan(after.h)
    expect(after.w).toBe(before.h)
  })

  it('쪽 목록(썸네일)은 넓은 화면에서 기본으로 열려 있고 토글로 닫을 수 있다', async () => {
    vi.stubGlobal('fetch', fetchStub(200))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => target.querySelectorAll('[data-page]').length === 3)
    await until(() => target.querySelectorAll('[data-thumb]').length === 3)
    btn('쪽 목록 열기·닫기').click()
    await wait()
    expect(target.querySelectorAll('[data-thumb]').length).toBe(0)
  })

  it('확장 훅(onLoaded)이 예외를 던져도 불러온 문서는 오류 화면으로 바뀌지 않는다', async () => {
    vi.stubGlobal('fetch', fetchStub(200))
    const onLoaded = vi.fn(() => { throw new Error('hook boom') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    app = mount(PdfViewer, { target, props: { src: '/x', onLoaded } })
    await until(() => target.querySelectorAll('[data-page]').length === 3)
    expect(target.querySelector('[role="alert"]')).toBeNull()
    expect(onLoaded).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('pdf.js·네트워크가 던진 영어 오류 문구는 고객 화면에 노출하지 않고 일반 안내로 바꾼다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('NetworkError when attempting to fetch resource.') }))
    app = mount(PdfViewer, { target, props: { src: '/x' } })
    await until(() => !!target.querySelector('[role="alert"]'))
    const text = target.querySelector('[role="alert"]')?.textContent ?? ''
    expect(text).not.toContain('NetworkError')
    expect(text).toContain('불러오지 못했어요')
  })
})
