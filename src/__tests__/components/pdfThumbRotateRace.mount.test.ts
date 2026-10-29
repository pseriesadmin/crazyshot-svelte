// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * PdfViewer 쪽 목록(썸네일) — 회전 직후 옛 그림이 새 그림을 덮어 뒤집혀 보이던 문제(2026-10-29)
 * 회전할 때 아직 그리는 중이던 이전 회전 상태의 썸네일 그리기는 취소되어야 하고, 최종 그림은 현재 회전값이어야 한다.
 */
const renders = vi.hoisted(() => [] as Array<{ thumb: boolean; rotation: number; cancelled: boolean; finish: () => void }>)

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {} as Record<string, string>,
  getDocument: () => {
    const doc = {
      numPages: 1,
      getPage: async () => ({
        rotate: 0,
        getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => {
          const swap = (rotation ?? 0) % 180 !== 0
          return { width: (swap ? 842 : 595) * scale, height: (swap ? 595 : 842) * scale, rotation: rotation ?? 0 }
        },
        render: ({ canvasContext, viewport }: { canvasContext: { canvas: HTMLCanvasElement }; viewport: { rotation: number } }) => {
          const entry = {
            thumb: canvasContext.canvas.parentElement?.className.includes('pv-thumb-canvas') ?? false,
            rotation: viewport.rotation,
            cancelled: false,
            finish: () => {},
          }
          renders.push(entry)
          const promise = new Promise<void>((resolve, reject) => {
            entry.finish = () => (entry.cancelled ? reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })) : resolve())
          })
          return { promise, cancel() { entry.cancelled = true; entry.finish() } }
        },
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
async function until(cond: () => boolean, tries = 80) {
  for (let i = 0; i < tries && !cond(); i++) await wait(10)
  expect(cond()).toBe(true)
}

beforeEach(() => {
  renders.length = 0
  target = document.createElement('div')
  document.body.appendChild(target)
  class Observer {
    constructor(private cb: (e: unknown[]) => void) {}
    observe(el: Element) { this.cb([{ target: el, isIntersecting: true }]) }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer })))
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo']
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) { return { canvas: this } } as unknown as HTMLCanvasElement['getContext']
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

describe('PdfViewer 썸네일 — 회전 중 옛 그리기 취소', () => {
  it('회전 전 그리는 중이던 썸네일은 취소되고, 회전 후 그림은 새 회전값(90)으로 그려진다', async () => {
    app = mount(PdfViewer, { target, props: { src: '/x', title: 'a.pdf' } })
    await until(() => renders.some((r) => r.thumb))
    const before = renders.filter((r) => r.thumb)
    expect(before[0].rotation).toBe(0)
    expect(before[0].cancelled).toBe(false) // 아직 그리는 중(끝나지 않음)

    ;(target.querySelector('[aria-label="시계 방향으로 회전"]') as HTMLElement).click()
    await until(() => renders.some((r) => r.thumb && r.rotation === 90))

    expect(before[0].cancelled).toBe(true)
    const last = renders.filter((r) => r.thumb).at(-1)!
    expect(last.rotation).toBe(90)
    expect(last.cancelled).toBe(false)
  })
})
