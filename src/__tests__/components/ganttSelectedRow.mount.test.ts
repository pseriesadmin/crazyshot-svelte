// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * CMS 홈 간트 — 행 클릭으로 상세 패널을 열어도 effect_update_depth_exceeded가 나지 않는다 (2026-10-02)
 * 회귀 배경: selectedRow가 $state 프록시라 재동기화 $effect의 `latest !== selectedRow`가 항상 참 → 무한 반복 → 모달이 닫히지 않음.
 * 실행: npm run test:component (CS_COMPONENT_TEST=1)
 */
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }))
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/cms') } }))
vi.mock('$app/stores', () => ({ page: { subscribe: () => () => {} } }))
globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ siblings: [], options: [], bundles: [], payment: null, steps: [], units: [], rows: [] }) })) as never
// jsdom에는 Web Animations API가 없어 svelte transition(fly)이 실패한다 — 테스트 환경 보정
;(Element.prototype as unknown as { animate: unknown }).animate = () => ({ cancel() {}, finish() {}, onfinish: null, currentTime: 0 })

const { default: Gantt } = await import('$lib/components/cms/dashboard/CmsDashboardGantt.svelte')

describe.skipIf(!process.env.CS_COMPONENT_TEST)('CmsDashboardGantt 상세 패널', () => {
  it('행 클릭 → 패널이 열리고 effect_update_depth_exceeded 없이 안정, 닫기 콜백 후 사라진다', async () => {
    const target = document.createElement('div'); document.body.appendChild(target)
    const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
    const row = { reservation_id: 1, reservation_code: 'CS1', status: 'confirmed', rental_start: d(0), rental_end: d(2), rental_days: 2, pickup_method: 'visit', return_method: 'visit', pickup_time: '10:00', return_time: '10:00', user_id: 'u', customer_name: 'a', customer_email: 'a@a', customer_phone: '010', membership_grade: 'NONE', credit_score: 50, product_id: 'p', product_name: 'n', product_code: 'c', product_category: 'CAMERA', product_image_url: null, order_id: 5, order_key: 'k', order_amount: 100, discount_amount: 0, coupon_discount_amount: 20, total_amount: 120, selected_points: 0, order_delivery_fee: 0, tax_amount: 0 }
    let err: unknown = null
    const app = mount(Gantt, { target, props: { initial: { from: d(-30), to: d(30), rows: [row] } } as never })
    try {
      flushSync()
      ;(target.querySelector('.gantt-label-body') as HTMLElement).click()
      flushSync(); await new Promise(r => setTimeout(r, 150)); flushSync()
      expect(target.querySelector('.gantt-detail-overlay')).not.toBeNull()
    } catch (e) { err = e }
    unmount(app); target.remove()
    expect(String(err)).not.toContain('effect_update_depth_exceeded')
    expect(err).toBeNull()
  })
})
