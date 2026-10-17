// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ContractCanvasEditor from '$lib/components/cms/contract-editor/ContractCanvasEditor.svelte'
import type { CanvasDocument } from '$lib/types/contract-document'

/**
 * 계약서 캔버스형 편집기 — 이미지 더블클릭 → 공통 이미지 뷰어 연동 (2026-10-16)
 *  · 배경 페이지 + 발행자 이미지 전체가 한 목록으로 열린다
 *  · 배경 페이지는 명암·컬러감만, 발행자 이미지는 모든 편집 메뉴
 *  · 읽기 전용이면 보기만(편집 버튼 없음)
 * 실행: npm run test:component
 */

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

async function wait(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
  flushSync()
}

const DOC: CanvasDocument = {
  pages: [
    { id: 'p1', imageUrl: 'https://x/p1.webp', width: 1200, height: 1700 },
    { id: 'p2', imageUrl: 'https://x/p2.webp', width: 1200, height: 1700 },
  ],
  fields: [
    { id: 'f1', pageId: 'p1', type: 'issuer-image', x: 10, y: 10, width: 300, height: 200, required: false, label: '직인', imageUrl: 'https://x/seal.webp' },
    { id: 'f2', pageId: 'p2', type: 'text', x: 10, y: 300, width: 300, height: 40, required: false, label: '본문' },
  ],
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  document.querySelectorAll('.mv-backdrop').forEach((n) => n.remove())
  vi.unstubAllGlobals()
})

describe('ContractCanvasEditor — 공통 이미지 뷰어', () => {
  it('배경 페이지를 더블클릭하면 페이지·발행자 이미지 전체가 뷰어에 나열되고 그 페이지부터 열린다', async () => {
    app = mount(ContractCanvasEditor, { target, props: { initialDoc: DOC } })
    await wait(30)
    const pages = target.querySelectorAll<HTMLElement>('.canvas-page')
    expect(pages.length).toBe(2)
    pages[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await wait()
    expect(document.querySelector('.mv-backdrop')).toBeTruthy()
    expect(document.querySelector('.mv-count')?.textContent).toContain('2 / 3') // 페이지 2장 + 발행자 이미지 1개
    expect(document.querySelector('.mv-title')?.textContent).toBe('계약서 배경 페이지 2')
  })

  it('발행자 이미지를 더블클릭하면 그 이미지부터 열린다', async () => {
    app = mount(ContractCanvasEditor, { target, props: { initialDoc: DOC } })
    await wait(30)
    target.querySelector<HTMLElement>('.canvas-field.field-issuer-image')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await wait()
    expect(document.querySelector('.mv-count')?.textContent).toContain('3 / 3')
    expect(document.querySelector('.mv-title')?.textContent).toBe('직인')
  })

  it('편집 메뉴는 항목별로 제한된다 — 배경 페이지는 명암·컬러감만', async () => {
    // jsdom에는 fetch·Image 디코딩이 없어 편집 모드 진입 자체는 검증하지 않고, 편집 버튼 노출 여부만 확인한다
    app = mount(ContractCanvasEditor, { target, props: { initialDoc: DOC } })
    await wait(30)
    target.querySelectorAll<HTMLElement>('.canvas-page')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await wait()
    expect(document.querySelector('.mv-backdrop button[aria-label="이미지 편집"]')).toBeTruthy()
  })

  it('읽기 전용이면 뷰어는 열리지만 편집 버튼이 없다', async () => {
    app = mount(ContractCanvasEditor, { target, props: { initialDoc: DOC, readonly: true } })
    await wait(30)
    target.querySelectorAll<HTMLElement>('.canvas-page')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await wait()
    expect(document.querySelector('.mv-backdrop')).toBeTruthy()
    expect(document.querySelector('.mv-backdrop button[aria-label="이미지 편집"]')).toBeNull()
  })

  it('필드 배치 중(placingType)에는 더블클릭으로 뷰어가 열리지 않는다', async () => {
    app = mount(ContractCanvasEditor, { target, props: { initialDoc: DOC } })
    await wait(30)
    // 팔레트에서 "서명" 필드 배치 모드로 진입
    const sigBtn = [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('서명') && !b.textContent.includes('발행자'))
    sigBtn?.click()
    await wait()
    target.querySelectorAll<HTMLElement>('.canvas-page')[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await wait()
    expect(document.querySelector('.mv-backdrop')).toBeNull()
  })
})
