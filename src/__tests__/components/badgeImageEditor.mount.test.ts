// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import BadgeImageEditor from '$lib/components/cms/badge/BadgeImageEditor.svelte'

/** 배지 편집기 — 위쪽 항목(글자·색·슬라이더·모양)을 바꾸면 편집 미리보기(.stage)가 따라 바뀌는지 */
describe.skipIf(!process.env.CS_COMPONENT_TEST)('BadgeImageEditor 미리보기 반영', () => {
  let cmp: ReturnType<typeof mount> | null = null
  afterEach(() => {
    if (cmp) unmount(cmp)
    cmp = null
    document.body.innerHTML = ''
  })
  const stage = () => (document.querySelector('.stage') as HTMLElement).innerHTML
  function setup() {
    cmp = mount(BadgeImageEditor, { target: document.body, props: { onapply: async () => true } })
    flushSync()
  }
  function type(id: string, v: string) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('메인·작은·아래 글자', () => {
    setup()
    type('be-main', 'HELLO')
    expect(stage()).toContain('>HELLO<')
    type('be-small', 'SMALLTXT')
    expect(stage()).toContain('>SMALLTXT<')
    type('be-sub', 'SUBTXT')
    expect(stage()).toContain('>SUBTXT<')
  })
  it('이름이 메인 글자에 반영된다', () => {
    cmp = mount(BadgeImageEditor, { target: document.body, props: { onapply: async () => true, name: 'hot' } })
    flushSync()
    expect(stage()).toContain('>hot<')
    expect((document.getElementById('be-main') as HTMLTextAreaElement).value).toBe('hot')
  })
  it('슬라이더(크기·위치)', () => {
    setup()
    const before = stage()
    type('be-sl-scale', '1.5')
    const a = stage()
    expect(a).not.toBe(before)
    type('be-sl-dx', '30')
    expect(stage()).toContain('translate(30 0)')
  })
  it('색 — 포인트 HEX 입력·색상 세트', () => {
    setup()
    const before = stage()
    type('be-c1', '#112233')
    expect(stage()).not.toBe(before)
    expect(stage().toLowerCase()).toContain('#374554') // 본체색 #112233 을 16% 밝힌 그라데이션 시작색
    const set = Array.from(document.querySelectorAll('.mini-btn')).find((b) => b.textContent?.includes('퍼플 + 라벤더')) as HTMLButtonElement
    set.click()
    flushSync()
    expect(stage().toLowerCase()).toContain('#c1bbec')
  })
  it('모양 선택', () => {
    setup()
    const before = stage()
    const tile = document.querySelector('button[aria-label="방패 (프리미엄)"]') as HTMLButtonElement
    tile.click()
    flushSync()
    expect(stage()).not.toBe(before)
  })

  it('따옴표가 든 문구로 화면 코드에 이벤트 속성이 생기지 않는다', () => {
    setup()
    type('be-main', '"onpointerover=alert(1) x="')
    type('be-small', "'onfocus=alert(2) y='")
    const all = Array.from(document.querySelectorAll('.stage *, .tpl-grid *'))
    const bad = all.filter((el) => Array.from(el.attributes).some((a) => a.name.toLowerCase().startsWith('on')))
    expect(bad).toHaveLength(0)
    expect(stage()).toContain('&quot;onpointerover=alert(1) x=&quot;')
  })

  // 저장 흐름(PNG 만들기 → 올리기 → 저장) — jsdom 에는 이미지 디코딩·canvas 가 없어 최소한으로 대체한다
  function stubPngPipeline() {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(_v: string) {
          queueMicrotask(() => this.onload?.())
        }
      }
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/png' })))
  }
  const saveBtn = () => Array.from(document.querySelectorAll('.btn-apply')).find((b) => b.textContent?.includes('저장')) as HTMLButtonElement

  it('올리기에 실패하면 저장을 이어가지 않는다', async () => {
    stubPngPipeline()
    const onsave = vi.fn(async () => {})
    const onapply = vi.fn(async () => false)
    cmp = mount(BadgeImageEditor, { target: document.body, props: { onapply, onsave } })
    flushSync()
    saveBtn().click()
    await vi.waitFor(() => expect(onapply).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(onsave).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('올리기에 성공하면 저장을 이어간다', async () => {
    stubPngPipeline()
    const onsave = vi.fn(async () => {})
    const onapply = vi.fn(async () => true)
    cmp = mount(BadgeImageEditor, { target: document.body, props: { onapply, onsave } })
    flushSync()
    saveBtn().click()
    await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1))
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('문구가 모두 비면 올리지도 저장하지도 않는다', async () => {
    stubPngPipeline()
    const onsave = vi.fn(async () => {})
    const onapply = vi.fn(async () => true)
    cmp = mount(BadgeImageEditor, { target: document.body, props: { onapply, onsave } })
    flushSync()
    type('be-main', '')
    saveBtn().click()
    await new Promise((r) => setTimeout(r, 20))
    expect(onapply).not.toHaveBeenCalled()
    expect(onsave).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('기존 배지(덮어쓰기)는 첫 클릭에 경고만 하고 두 번째 클릭에 저장한다', async () => {
    stubPngPipeline()
    const onsave = vi.fn(async () => {})
    const onapply = vi.fn(async () => true)
    cmp = mount(BadgeImageEditor, { target: document.body, props: { onapply, onsave, confirmOverwrite: true } })
    flushSync()
    saveBtn().click()
    flushSync()
    await new Promise((r) => setTimeout(r, 20))
    expect(onapply).not.toHaveBeenCalled()
    expect(onsave).not.toHaveBeenCalled()
    expect(saveBtn().textContent).toContain('한번 더 누르면 저장됩니다')
    saveBtn().click()
    await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1))
    expect(onapply).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
