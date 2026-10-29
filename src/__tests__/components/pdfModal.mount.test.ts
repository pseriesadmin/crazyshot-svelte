// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * PdfModal — 상품설명서 PDF 단순 모달 (2026-10-29)
 * 모달 안 PDF 뷰어는 기존 도구(쪽 목록·쪽 이동·배율·가로 맞춤·회전·내려받기·인쇄)를 그대로 가진다. 계약서 뷰어도 그대로.
 * 닫기: ✕ · 바깥 클릭 · Esc (창 안쪽 클릭은 닫지 않는다)
 */
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {} as Record<string, string>,
  getDocument: () => {
    const doc = {
      numPages: 2,
      getPage: async () => ({
        rotate: 0,
        getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
      }),
      destroy: async () => {},
    }
    return { promise: Promise.resolve(doc) }
  },
}))

import PdfModal from '$lib/components/common/PdfModal.svelte'
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
const has = (label: string) => target.querySelector(`[aria-label="${label}"]`) !== null

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  class Observer { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer })))
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo']
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext']
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

describe('PdfModal', () => {
  it('머리줄에 파일 이름과 ✕, 본문 PDF 뷰어는 쪽 목록·도구줄을 그대로 가진다', async () => {
    app = mount(PdfModal, { target, props: { src: 'https://x/a.pdf', title: '사용설명서.pdf', downloadUrl: 'https://x/a.pdf', downloadFilename: '사용설명서.pdf', onclose: vi.fn() } })
    await until(() => target.querySelectorAll('[data-page]').length === 2)
    expect(target.querySelector('.pm-title')?.textContent).toBe('사용설명서.pdf')
    expect(has('닫기')).toBe(true)
    for (const k of ['쪽 목록 열기·닫기', '현재 쪽', '축소', '확대', '가로 폭에 맞추기', '시계 방향으로 회전', '인쇄', 'PDF 내려받기']) expect(has(k), k).toBe(true)
    await until(() => target.querySelector('[aria-label="쪽 목록"]') !== null)
    // 불러오는 문구는 계약서가 아니라 문서
    expect(target.textContent).not.toContain('계약서')
  })
  it('✕·바깥 클릭·Esc 로 닫히고 창 안쪽 클릭은 닫지 않는다', async () => {
    const onclose = vi.fn()
    app = mount(PdfModal, { target, props: { src: 'https://x/a.pdf', title: 'a.pdf', onclose } })
    await wait()
    ;(target.querySelector('.pm-modal') as HTMLElement).click()
    expect(onclose).not.toHaveBeenCalled()
    ;(target.querySelector('[aria-label="닫기"]') as HTMLElement).click()
    expect(onclose).toHaveBeenCalledTimes(1)
    ;(target.querySelector('.pm-backdrop') as HTMLElement).click()
    expect(onclose).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onclose).toHaveBeenCalledTimes(3)
  })
  it('내려받기 주소가 없으면 내려받기 버튼을 숨긴다', async () => {
    app = mount(PdfModal, { target, props: { src: 'https://x/a.pdf', title: 'a.pdf', onclose: vi.fn() } })
    await wait()
    expect(has('PDF 내려받기')).toBe(false)
  })
  it('PdfViewer 기본값(계약서 뷰어)은 기존 도구와 문구가 그대로다', async () => {
    app = mount(PdfViewer, { target, props: { src: '/x', title: '전자계약서.pdf', downloadUrl: '/d' } })
    await until(() => target.querySelectorAll('[data-page]').length === 2)
    for (const k of ['쪽 목록 열기·닫기', '시계 방향으로 회전', '인쇄', '가로 폭에 맞추기']) expect(has(k), k).toBe(true)
  })
})
