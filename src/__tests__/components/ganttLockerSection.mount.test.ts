// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * CMS 홈 간트 → 대여정보 모달 — 방문 예약에서 '무인보관함 배정정보'(입력·확정 UI)가 권한별로 나오는지 (2026-11-27)
 * 실행: CS_COMPONENT_TEST=1 npx vitest run src/__tests__/components/ganttLockerSection.mount.test.ts
 */
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }))
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/cms') } }))
vi.mock('$app/stores', () => ({ page: { subscribe: () => () => {} } }))
globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ locker_password: null, locker_number: null, locker_guide_legs: null, siblings: [], options: [], bundles: [], payment: null, steps: [], units: [], rows: [] }) })) as never
;(Element.prototype as unknown as { animate: unknown }).animate = () => ({ cancel() {}, finish() {}, onfinish: null, currentTime: 0 })

const { default: Gantt } = await import('$lib/components/cms/dashboard/CmsDashboardGantt.svelte')

async function openPanel(cmsRole: string | null): Promise<{ text: string; html: string }> {
  const target = document.createElement('div'); document.body.appendChild(target)
  const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
  const row = { reservation_id: 1, reservation_code: 'CS1', status: 'confirmed', rental_start: d(0), rental_end: d(0), rental_days: 0, pickup_method: 'visit', return_method: 'visit', pickup_time: '12:00', return_time: '21:30', user_id: 'u', customer_name: 'a', customer_email: 'a@a', customer_phone: '010', membership_grade: 'NONE', credit_score: 50, product_id: 'p', product_name: 'n', product_code: 'c', product_category: 'CAMERA', product_image_url: null, order_id: 5, order_key: 'k', order_amount: 100, discount_amount: 0, coupon_discount_amount: 0, total_amount: 100, selected_points: 0, order_delivery_fee: 0, tax_amount: 0 }
  const app = mount(Gantt, { target, props: { initial: { from: d(-30), to: d(30), rows: [row] }, cmsRole } as never })
  flushSync()
  ;(target.querySelector('.gantt-bar') as HTMLElement).click()
  flushSync(); await new Promise(r => setTimeout(r, 200)); flushSync()
  const out = { text: target.textContent ?? '', html: target.innerHTML }
  unmount(app); target.remove()
  return out
}

describe.skipIf(!process.env.CS_COMPONENT_TEST)('홈 간트 모달 — 무인보관함 배정정보', () => {
  it('매니저: 제목·입력칸·수령/반납 콤보·배정 확정 버튼이 나온다', async () => {
    const { text, html } = await openPanel('manager')
    expect(text).toContain('무인보관함 배정정보')
    expect(html).toContain('무인함 번호 입력')
    expect(text).toContain('배정 확정')
    expect(text).toContain('시범 발송')
  })
  it('슈퍼관리자도 동일', async () => {
    expect((await openPanel('superadmin')).text).toContain('무인보관함 배정정보')
  })
  it('파트너·권한값 없음: 숨김(비밀번호 보호)', async () => {
    expect((await openPanel('partner')).text).not.toContain('무인보관함 배정정보')
    expect((await openPanel(null)).text).not.toContain('무인보관함 배정정보')
  })
})
