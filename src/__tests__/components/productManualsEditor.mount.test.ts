// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * ProductManualsEditor — 상품설명서(PDF) 목록 편집 (상품 등록 화면·상품목록 패널 공용)
 * 올리기(서명 발급 → 저장소 직접 업로드) · 삭제 · 변경 · 읽기 전용 · 개수 상한 · PDF 뷰어 열기를 검증한다.
 */
const uploadMock = vi.hoisted(() => vi.fn(async () => ({ error: null })))
vi.mock('$lib/services/supabase', () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: uploadMock }) } },
}))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
const toast = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock('$lib/utils/toast', () => ({ csToast: toast }))
const modalProps = vi.hoisted(() => ({ last: null as null | { src: string; title: string; downloadUrl?: string } }))
vi.mock('$lib/components/common/PdfModal.svelte', () => ({
  default: (_anchor: unknown, props: { src: string; title: string; downloadUrl?: string }) => {
    modalProps.last = { src: props.src, title: props.title, downloadUrl: props.downloadUrl }
  },
}))

import ProductManualsEditor from '$lib/components/cms/ProductManualsEditor.svelte'
import type { ProductManualFile } from '$lib/utils/productManuals'

const PID = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b'
const U1 = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb'
const U2 = 'cccccccc-1111-4222-8333-dddddddddddd'
const A: ProductManualFile = { path: `${PID}/${U1}.pdf`, name: '사용설명서.pdf', size: 2048, uploaded_at: '2026-10-29T03:00:00.000Z' }
const B: ProductManualFile = { path: `${PID}/${U2}.pdf`, name: '안전수칙.pdf', size: 5 * 1024 * 1024, uploaded_at: '2026-10-29T03:00:00.000Z' }

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
function render(props: Record<string, unknown>) {
  app = mount(ProductManualsEditor, { target, props: { files: [], onchange: vi.fn(), ...props } as never })
}
function pdfFile(name = '새설명서.pdf', size = 1000, type = 'application/pdf'): File {
  return new File([new Uint8Array(size)], name, { type })
}
function pickInto(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
function signOk(path: string) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ path, token: 'tok' }) }))
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  uploadMock.mockClear()
  Object.values(toast).forEach((f) => f.mockClear())
  modalProps.last = null
})
afterEach(() => {
  if (app) unmount(app)
  app = null
  target.remove()
  vi.unstubAllGlobals()
})

describe('ProductManualsEditor — 목록 표시', () => {
  it('파일 이름·크기를 보여주고 이름을 누르면 그 파일이 PDF 모달(PdfModal)로 열린다', async () => {
    render({ files: [A, B], productId: PID })
    expect(target.textContent).toContain('사용설명서.pdf')
    expect(target.textContent).toContain('2.0KB')
    expect(target.textContent).toContain('5.0MB')
    ;(target.querySelector('[aria-label="안전수칙.pdf PDF 보기"]') as HTMLElement).click()
    await until(() => modalProps.last !== null)
    expect(modalProps.last!.title).toBe('안전수칙.pdf')
    expect(modalProps.last!.src).toBe(`https://t.supabase.co/storage/v1/object/public/product-manuals/${B.path}`)
    expect(modalProps.last!.downloadUrl).toBe(modalProps.last!.src)
  })
  it('목록이 비면 안내 문구, 읽기 전용이면 추가·변경·삭제 버튼이 없다', () => {
    render({ files: [], productId: PID })
    expect(target.textContent).toContain('등록된 상품설명서가 없습니다')
    expect(target.textContent).toContain('+ 상품설명서 추가')
    unmount(app!); app = null; target.innerHTML = ''
    render({ files: [A], productId: PID, readonly: true })
    expect(target.textContent).not.toContain('+ 상품설명서 추가')
    expect(target.querySelector('[aria-label="사용설명서.pdf 삭제"]')).toBeNull()
    expect(target.querySelector('[aria-label="사용설명서.pdf 파일 변경"]')).toBeNull()
    expect(target.querySelector('[aria-label="사용설명서.pdf PDF 보기"]')).not.toBeNull()
  })
  it('10개가 차면 추가 버튼이 잠긴다', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...A, path: `${PID}/${String(i).padStart(8, '0')}-1111-4222-8333-bbbbbbbbbbbb.pdf`, name: `f${i}.pdf` }))
    render({ files: ten, productId: PID })
    const add = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes('상품설명서 추가')) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(target.textContent).toContain('10/10')
  })
})

describe('ProductManualsEditor — 삭제·추가·변경', () => {
  it('삭제(✕)를 누르면 그 파일만 빠진 목록과 삭제 항목이 onchange 로 전달된다', async () => {
    const onchange = vi.fn()
    render({ files: [A, B], productId: PID, onchange })
    ;(target.querySelector('[aria-label="사용설명서.pdf 삭제"]') as HTMLElement).click()
    await until(() => onchange.mock.calls.length === 1)
    expect(onchange.mock.calls[0][0]).toEqual([B])
    expect(onchange.mock.calls[0][1]).toEqual([A])
  })
  it('등록 화면(임시 범위): 삭제 시 임시 파일을 저장소에서 바로 지운다', async () => {
    const tempPath = `temp/abc123_xyz/${U1}.pdf`
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const onchange = vi.fn()
    render({ files: [{ ...A, path: tempPath }], tempId: 'abc123_xyz', onchange })
    ;(target.querySelector('[aria-label="사용설명서.pdf 삭제"]') as HTMLElement).click()
    await until(() => fetchMock.mock.calls.length === 1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/cms/product-manuals')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(String(init.body))).toEqual({ path: tempPath })
  })
  it('PDF 추가: 서명 발급 → 저장소 직접 업로드 → 목록에 붙여 onchange', async () => {
    const newPath = `${PID}/${U2}.pdf`
    const fetchMock = signOk(newPath)
    vi.stubGlobal('fetch', fetchMock)
    const onchange = vi.fn()
    render({ files: [A], productId: PID, onchange })
    const input = target.querySelector('input[type=file][multiple]') as HTMLInputElement
    pickInto(input, [pdfFile('새설명서.pdf', 4321)])
    await until(() => onchange.mock.calls.length === 1)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toEqual({ content_type: 'application/pdf', size: 4321, product_id: PID })
    expect(uploadMock).toHaveBeenCalledTimes(1)
    const next = onchange.mock.calls[0][0] as ProductManualFile[]
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ path: newPath, name: '새설명서.pdf', size: 4321 })
  })
  it('PDF가 아니거나 10MB 넘는 파일은 서버 호출 없이 거절하고 안내한다', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onchange = vi.fn()
    render({ files: [], productId: PID, onchange })
    const input = target.querySelector('input[type=file][multiple]') as HTMLInputElement
    pickInto(input, [pdfFile('사진.png', 100, 'image/png'), pdfFile('큰파일.pdf', 11 * 1024 * 1024)])
    await until(() => toast.error.mock.calls.length >= 2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onchange).not.toHaveBeenCalled()
  })
  it('서명 발급이 실패하면 목록을 바꾸지 않고 사유를 안내한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: '상품설명서는 최대 10개까지 등록할 수 있어요.' }) })))
    const onchange = vi.fn()
    render({ files: [], productId: PID, onchange })
    pickInto(target.querySelector('input[type=file][multiple]') as HTMLInputElement, [pdfFile()])
    await until(() => toast.error.mock.calls.length === 1)
    expect(onchange).not.toHaveBeenCalled()
    expect(uploadMock).not.toHaveBeenCalled()
  })
  it('파일 변경: 같은 자리에 새 파일을 끼우고 이전 파일은 삭제 항목으로 전달', async () => {
    const newPath = `${PID}/${U2}.pdf`
    vi.stubGlobal('fetch', signOk(newPath))
    const onchange = vi.fn()
    render({ files: [A], productId: PID, onchange })
    ;(target.querySelector('[aria-label="사용설명서.pdf 파일 변경"]') as HTMLElement).click()
    const inputs = target.querySelectorAll('input[type=file]')
    pickInto(inputs[1] as HTMLInputElement, [pdfFile('개정판.pdf', 777)])
    await until(() => onchange.mock.calls.length === 1)
    const [next, removed] = onchange.mock.calls[0] as [ProductManualFile[], ProductManualFile[]]
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ path: newPath, name: '개정판.pdf', size: 777 })
    expect(removed).toEqual([A])
  })
})
