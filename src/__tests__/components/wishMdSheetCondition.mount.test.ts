// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * 'MD 추천' 팝업 열림 판정 — 노출조건(찜 선택·예약 선택)에 따라 열리거나 열리지 않는다 (2026-11-25)
 *  - 불허이면 가벼운 조건 조회(?only=popup)만 하고 상품 목록 전체는 조회하지 않는다
 *  - 허용이면 상품 목록을 조회한 뒤 연다
 *  - 조건 조회 실패: 찜은 열고(안내 표시), 예약신청은 열지 않는다
 * 실행: CS_COMPONENT_TEST=1 npm run test:component
 */

const { default: WishMdSheet } = await import('$lib/components/common/WishMdSheet.svelte')
const { wishMdSheet, openWishMdSheet, closeWishMdSheet } = await import('$lib/stores/wishMdSheet.svelte')

const fullPayload = { products: [], wishedIds: [], productBadges: {}, productCardKeywords: {}, mdMobileImages: {}, popup: { on_wish: true, on_reserve: true } }
let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
let fetchMock: ReturnType<typeof vi.fn>
const tick = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); flushSync() }
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

function stubFetch(condition: { on_wish: boolean; on_reserve: boolean } | 'fail') {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('only=popup')) {
      if (condition === 'fail') return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({ popup: condition }) }
    }
    return { ok: true, json: async () => fullPayload }
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  closeWishMdSheet()
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => { if (app) unmount(app); app = null; target.remove(); vi.unstubAllGlobals() })

describe.skipIf(!process.env.CS_COMPONENT_TEST)('WishMdSheet — 노출조건에 따른 열림', () => {
  it('예약 선택 OFF: 예약신청으로는 열리지 않고 상품 목록 조회도 하지 않는다', async () => {
    stubFetch({ on_wish: true, on_reserve: false })
    app = mount(WishMdSheet, { target })
    openWishMdSheet('reserve')
    await tick(20)
    expect(wishMdSheet.open).toBe(false)
    expect(wishMdSheet.requested).toBeNull()
    expect(urls()).toEqual(['/products/_md?only=popup'])
  })

  it('찜 선택 OFF: 찜으로는 열리지 않는다', async () => {
    stubFetch({ on_wish: false, on_reserve: true })
    app = mount(WishMdSheet, { target })
    openWishMdSheet('wish')
    await tick(20)
    expect(wishMdSheet.open).toBe(false)
  })

  it('예약 선택 ON: 예약신청으로 열리고, 닫은 뒤 다시 요청해도 열린다', async () => {
    stubFetch({ on_wish: false, on_reserve: true })
    app = mount(WishMdSheet, { target })
    openWishMdSheet('reserve')
    await tick(20)
    expect(wishMdSheet.open).toBe(true)
    expect(urls()).toEqual(['/products/_md?only=popup', '/products/_md'])
    closeWishMdSheet()
    await tick()
    openWishMdSheet('reserve')
    await tick(20)
    expect(wishMdSheet.open).toBe(true)
  })

  it('조건 조회 실패: 찜은 열리고 예약신청은 열리지 않는다', async () => {
    stubFetch('fail')
    app = mount(WishMdSheet, { target })
    openWishMdSheet('reserve')
    await tick(20)
    expect(wishMdSheet.open).toBe(false)
    openWishMdSheet('wish')
    await tick(20)
    expect(wishMdSheet.open).toBe(true)
  })
})
