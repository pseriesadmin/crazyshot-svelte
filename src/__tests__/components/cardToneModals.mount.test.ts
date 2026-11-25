// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * 슬라이드 카드 바탕색 선택(흰색·옅은 퍼플·다크) — 홈 카테고리 상품 슬라이드 모달 / /products 헤더 슬라이드 모달 (2026-11-24)
 * 저장된 tone 을 불러와 선택 표시에 반영하고, 선택 시 저장 값에 tone 이 담기는지 확인한다.
 * 실행: CS_COMPONENT_TEST=1 npm run test:component
 */

const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = []

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/utils/toast', () => ({ csToast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('$lib/services/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params })
      if (name === 'get_products_by_ids') {
        const ids = (params.p_ids as string[]) ?? []
        return Promise.resolve({ data: ids.map((id) => ({ id, name: `상품-${id}`, image_urls: [], base_price_daily: 1000 })), error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))

const { default: HomeCategoryProductsModal } = await import('$lib/components/home/admin/HomeCategoryProductsModal.svelte')
const { default: ProductHeroModal } = await import('$lib/components/products/admin/ProductHeroModal.svelte')

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
const tick = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); flushSync() }
const trays = () => [...target.querySelectorAll('.tone-tray')] as HTMLElement[]
const pressedLabels = (tray: HTMLElement) => [...tray.querySelectorAll('.tone[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label'))
const upserts = () => rpcCalls.filter((c) => c.name === 'upsert_product_page_setting')

beforeEach(() => {
  rpcCalls.length = 0
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => { if (app) unmount(app); app = null; target.remove() })

describe.skipIf(!process.env.CS_COMPONENT_TEST)('홈 카테고리 상품 슬라이드 모달 — 카드 바탕색', () => {
  const allSettings = {
    items: [{ category_id: 'camera', mode: 'fixed' as const, products: [{ id: 'a', order: 0, tone: 'white' as const }, { id: 'b', order: 1 }] }],
  }

  it('저장된 tone 을 불러와 선택 표시하고, 없으면 기본(다크)이 선택된다', async () => {
    app = mount(HomeCategoryProductsModal, { target, props: { categoryId: 'camera', categoryName: '카메라', allSettings, onclose: () => {}, embedded: true } })
    await tick(30)
    const t = trays()
    expect(t.length).toBe(2)
    expect(pressedLabels(t[0])).toEqual(['슬라이드 카드 바탕 흰색'])
    expect(pressedLabels(t[1])).toEqual(['슬라이드 카드 바탕 다크'])
  })

  it('선택한 tone 이 저장 값에 담기고, 고르지 않은 상품은 tone 없이 저장된다', async () => {
    app = mount(HomeCategoryProductsModal, { target, props: { categoryId: 'camera', categoryName: '카메라', allSettings, onclose: () => {}, embedded: true } })
    await tick(30)
    ;(trays()[1].querySelector('.tone-lilac') as HTMLButtonElement).click()
    await tick()
    ;(target.querySelector('.hcp-btn-save') as HTMLButtonElement).click()
    await tick(20)
    const saved = upserts().find((c) => c.params.p_key === 'home_category_products')
    expect(saved).toBeTruthy()
    const products = ((saved!.params.p_value as { items: { products: unknown[] }[] }).items[0]).products
    expect(products).toEqual([{ id: 'a', order: 0, tone: 'white' }, { id: 'b', order: 1, tone: 'lilac' }])
  })
})

describe.skipIf(!process.env.CS_COMPONENT_TEST)('/products 헤더 슬라이드 모달 — 카드 바탕색', () => {
  it('헤더 슬라이드: tone 을 불러오고 기본은 옅은 퍼플이 선택된다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_hero', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0, tone: 'dark' }, { id: 'b', order: 1 }] }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    const t = trays()
    expect(t.length).toBe(2)
    expect(pressedLabels(t[0])).toEqual(['슬라이드 카드 바탕 다크'])
    expect(pressedLabels(t[1])).toEqual(['슬라이드 카드 바탕 옅은 퍼플'])
  })

  it('헤더 슬라이드: 선택한 tone 만 저장 값에 담긴다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_hero', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0 }, { id: 'b', order: 1 }] }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    ;(trays()[0].querySelector('.tone-white') as HTMLButtonElement).click()
    await tick()
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(20)
    const saved = upserts().find((c) => c.params.p_key === 'product_page_hero')
    expect(saved).toBeTruthy()
    expect((saved!.params.p_value as { products: unknown[] }).products).toEqual([{ id: 'a', order: 0, tone: 'white' }, { id: 'b', order: 1 }])
  })

  it('MD 추천: 노출조건(찜·예약)을 불러와 표시하고, 바꾼 값이 저장 값의 popup 에 담긴다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_md_picks', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0 }], popup: { on_wish: true, on_reserve: false } }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    const btn = (label: string) => [...target.querySelectorAll('[aria-label="노출조건"] .combo-btn')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement
    expect(btn('찜 선택').getAttribute('aria-pressed')).toBe('true')
    expect(btn('예약 선택').getAttribute('aria-pressed')).toBe('false')
    btn('찜 선택').click()
    btn('예약 선택').click()
    await tick()
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(20)
    const saved = upserts().find((c) => c.params.p_key === 'product_page_md_picks')
    expect((saved!.params.p_value as { popup: unknown }).popup).toEqual({ on_wish: false, on_reserve: true })
  })

  it('MD 추천: 기본값이 아닌 저장값(찜 OFF·예약 ON)도 그대로 불러와 표시하고 그대로 다시 저장한다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_md_picks', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0 }], popup: { on_wish: false, on_reserve: true } }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    const btn = (label: string) => [...target.querySelectorAll('[aria-label="노출조건"] .combo-btn')].find((b) => b.textContent?.includes(label)) as HTMLButtonElement
    expect(btn('찜 선택').getAttribute('aria-pressed')).toBe('false')
    expect(btn('예약 선택').getAttribute('aria-pressed')).toBe('true')
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(20)
    const saved = upserts().find((c) => c.params.p_key === 'product_page_md_picks')
    expect((saved!.params.p_value as { popup: unknown }).popup).toEqual({ on_wish: false, on_reserve: true })
  })

  it('MD 추천: 저장값이 없으면 기본(찜 ON·예약 OFF)으로 표시된다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_md_picks', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0 }] }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    const pressed = [...target.querySelectorAll('[aria-label="노출조건"] .combo-btn[aria-pressed="true"]')].map((b) => b.textContent?.trim())
    expect(pressed).toEqual(['찜 선택'])
  })

  it('헤더 슬라이드 설정에는 노출조건이 나오지 않고 popup 도 저장되지 않는다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_hero', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0 }] }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    expect(target.querySelector('[aria-label="노출조건"]')).toBeNull()
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(20)
    const saved = upserts().find((c) => c.params.p_key === 'product_page_hero')
    expect('popup' in (saved!.params.p_value as object)).toBe(false)
  })

  it('MD 추천(헤더 슬라이드가 아닌 키)에서는 색 선택이 나오지 않는다', async () => {
    app = mount(ProductHeroModal, {
      target,
      props: { settingKey: 'product_page_md_picks', initialSettings: { mode: 'fixed', products: [{ id: 'a', order: 0 }] }, onclose: () => {}, embedded: true },
    })
    await tick(30)
    expect(trays().length).toBe(0)
  })
})
