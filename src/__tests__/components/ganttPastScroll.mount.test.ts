// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * CMS 홈 간트 — 과거로 계속 스크롤하면 청크가 이어서 로드되고 지난 달 예약 막대가 그려진다 (2026-11-27)
 * 실행: CS_COMPONENT_TEST=1 npx vitest run --config vitest.component.config.ts src/__tests__/components/ganttPastScroll.mount.test.ts
 */
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }))
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/cms') } }))
vi.mock('$app/stores', () => ({ page: { subscribe: () => () => {} } }))
;(Element.prototype as unknown as { animate: unknown }).animate = () => ({ cancel() {}, finish() {}, onfinish: null, currentTime: 0 })

const today = '2026-11-27'
const add = (s: string, n: number): string => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const mk = (id: number, start: string, end: string, status: string) => ({ reservation_id: id, reservation_code: `CS${id}`, status, rental_start: start, rental_end: end, rental_days: 1, pickup_method: 'visit', return_method: 'visit', pickup_time: '10:00', return_time: '18:00', user_id: 'u', customer_name: 'a', customer_email: 'a@a', customer_phone: '010', membership_grade: 'NONE', credit_score: 50, product_id: 'p', product_name: 'n', product_code: 'c', product_category: 'CAMERA', product_image_url: null, order_id: id, order_key: 'k', order_amount: 1, discount_amount: 0, coupon_discount_amount: 0, total_amount: 1, selected_points: 0, order_delivery_fee: 0, tax_amount: 0 })
// 7~10월 한가운데 예약 하나씩(종료 상태) — 서버는 요청 구간과 겹치는 것만 돌려준다
const ALL = [mk(1, '2026-07-10', '2026-07-11', 'completed'), mk(2, '2026-08-20', '2026-08-21', 'completed'), mk(3, '2026-09-15', '2026-09-16', 'returned'), mk(4, '2026-10-12', '2026-10-13', 'completed')]
const calls: string[] = []
globalThis.fetch = vi.fn(async (url: string) => {
  const u = new URL(url, 'http://x'); const from = u.searchParams.get('from') ?? '', to = u.searchParams.get('to') ?? ''
  calls.push(`${from}~${to}`)
  return { ok: true, json: async () => ({ rows: ALL.filter((r) => r.rental_end >= from && r.rental_start <= to) }) }
}) as never

const { default: Gantt } = await import('$lib/components/cms/dashboard/CmsDashboardGantt.svelte')

describe.skipIf(!process.env.CS_COMPONENT_TEST)('간트 과거 스크롤', () => {
  it('왼쪽 끝으로 반복 스크롤하면 7월까지 청크가 이어서 로드되고 막대가 생긴다', async () => {
    const target = document.createElement('div'); document.body.appendChild(target)
    ;(globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame = (cb) => { cb(); return 0 }
    const app = mount(Gantt, { target, props: { initial: { from: add(today, -3), to: add(today, 10), rows: [] }, cmsRole: 'manager' } as never })
    flushSync()
    const el = target.querySelector('.gantt-scroll') as HTMLElement
    for (let i = 0; i < 14; i++) {
      el.scrollLeft = 0
      el.dispatchEvent(new Event('scroll'))
      await new Promise((r) => setTimeout(r, 30)); flushSync()
    }
    const months = Array.from(target.querySelectorAll('.gantt-month-row *')).map((n) => n.textContent?.trim()).filter(Boolean)
    const bars = Array.from(target.querySelectorAll('.gantt-bar')).map((b) => b.getAttribute('data-reservation-code'))
    unmount(app); target.remove()
    console.log('calls', calls.length, calls[0], calls[calls.length - 1], '| months', months.join(','), '| bars', bars.join(','))
    expect(calls.length).toBeGreaterThanOrEqual(9)
    expect(bars).toEqual(expect.arrayContaining(['CS1', 'CS2', 'CS3', 'CS4']))
  })

  it('이미 지난 예약 막대는 회색 톤, 연체(미반납)는 회색이어도 빨간 연체 표시 유지, 오늘 이후는 상태 색 그대로', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [mk(11, ymd(-2), ymd(-1), 'completed'), mk(12, ymd(-2), ymd(-1), 'confirmed'), mk(13, ymd(1), ymd(2), 'confirmed')]
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const bar = (code: string): HTMLElement => Array.from(target.querySelectorAll<HTMLElement>('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code) as HTMLElement
    const GRAY = 'rgba(102, 102, 102, 0.1)'
    expect(bar('CS11').getAttribute('style')).toContain(GRAY)
    expect(bar('CS12').getAttribute('style')).toContain(GRAY)           // 지난 + 미반납 = 회색 + 연체 표시
    expect(bar('CS12').classList.contains('gantt-bar-overdue')).toBe(true)
    expect(bar('CS11').classList.contains('gantt-bar-overdue')).toBe(false)
    expect(bar('CS13').getAttribute('style')).toContain('rgba(16, 185, 129, 0.12)') // 앞으로 올 예약은 계약완료 초록 그대로
    unmount(app); target.remove()
  })

  it('레인 배치: 겹치지 않는 예약은 한 줄, 겹치면 다른 줄 — 좌측 목록·정렬 선택은 없고 막대에 상품명·고객·상태가 2줄로 나온다', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [mk(21, ymd(1), ymd(2), 'confirmed'), mk(22, ymd(4), ymd(5), 'in_use'), mk(23, ymd(2), ymd(3), 'confirmed')]
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const rowOf = (code: string): Element => Array.from(target.querySelectorAll('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code)!.closest('.gantt-row')!
    expect(rowOf('CS21')).toBe(rowOf('CS22'))      // 겹치지 않음 → 같은 줄
    expect(rowOf('CS21')).not.toBe(rowOf('CS23'))  // 하루 겹침 → 다른 줄
    expect(target.querySelector('.gantt-sort-select')).toBeNull()
    expect(target.querySelector('.gantt-label-col')).toBeNull()
    const first = Array.from(target.querySelectorAll('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === 'CS21')!
    expect(first.querySelector('.gantt-bar-product')?.textContent).toBe('n')
    expect(first.querySelector('.gantt-bar-badge')?.textContent).toBe('계약완료') // 2일(192px) 막대: 왼쪽 상태 배지
    expect(first.querySelector('.gantt-bar-sub')?.textContent).toBe('a')
    expect(first.getAttribute('title')).toContain('CS21')
    // 줄 수는 최소 줄(8) 이상으로 채워진다
    expect(target.querySelectorAll('.gantt-row').length).toBeGreaterThanOrEqual(8)
    unmount(app); target.remove()
  })

  it('오늘 컬럼은 일반 컬럼의 2배 너비 — 오늘 이후 막대는 그만큼 밀리고, 오늘 하루 막대는 2배로 넓어진다', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    // 불러온 구간: 오늘-3 ~ 오늘+10 → 오늘은 4번째 칸(인덱스 3)
    const rows = [mk(31, ymd(-1), ymd(-1), 'completed'), mk(32, ymd(0), ymd(0), 'confirmed'), mk(33, ymd(1), ymd(1), 'confirmed')]
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const style = (code: string): string => Array.from(target.querySelectorAll<HTMLElement>('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code)!.getAttribute('style') ?? ''
    expect(style('CS31')).toContain('left: 204px')   // 오늘 이전: 그대로 (2칸 × 100 + 4)
    expect(style('CS31')).toContain('width: 92px')
    expect(style('CS32')).toContain('left: 304px')   // 오늘 칸 시작 (3칸 × 100 + 4)
    expect(style('CS32')).toContain('width: 192px')  // 오늘 하루 = 2배(200 - 8)
    expect(style('CS33')).toContain('left: 504px')   // 오늘 다음 날: 오늘 칸이 넓어진 만큼 밀림 (4칸 × 100 + 100 + 4)
    expect(target.querySelector<HTMLElement>('.gantt-day-header.gantt-today')!.getAttribute('style')).toContain('width: 200px')
    expect(target.querySelector<HTMLElement>('.gantt-today-col')!.getAttribute('style')).toContain('width: 200px')
    expect(target.querySelector<HTMLElement>('.gantt-grid-track')!.getAttribute('style')).toContain('min-width: 1500px') // 14칸 × 100 + 오늘 추가 100
    unmount(app); target.remove()
  })

  it('진행·대기·예정 막대에만 입체감 표시(gantt-bar-live), 지난·종료·취소 막대는 평평하다', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [
      mk(41, ymd(0), ymd(1), 'in_use'), mk(42, ymd(2), ymd(3), 'hold'), mk(43, ymd(4), ymd(5), 'confirmed'),   // 진행·대기·예정
      mk(44, ymd(-2), ymd(-1), 'completed'), mk(45, ymd(-2), ymd(-1), 'confirmed'), mk(46, ymd(1), ymd(2), 'returned'), // 종료·연체·일찍 반납
    ]
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const live = (code: string): boolean => Array.from(target.querySelectorAll<HTMLElement>('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code)!.classList.contains('gantt-bar-live')
    expect([41, 42, 43].map((i) => live(`CS${i}`))).toEqual([true, true, true])
    expect([44, 45, 46].map((i) => live(`CS${i}`))).toEqual([false, false, false])
    unmount(app); target.remove()
  })

  it('폭이 넓은 막대(오늘 칸 등)는 왼쪽에 상태 배지를 먼저 두고 둘째 줄은 고객명만, 좁은 막대는 배지 없이 "고객 · 상태"', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [mk(51, ymd(0), ymd(0), 'confirmed'), mk(52, ymd(2), ymd(2), 'confirmed'), mk(53, ymd(3), ymd(5), 'in_use')]
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const bar = (code: string): HTMLElement => Array.from(target.querySelectorAll<HTMLElement>('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code)!
    const wide = bar('CS51')   // 오늘 하루 = 192px
    expect(wide.querySelector('.gantt-bar-badge')?.textContent).toBe('계약완료')
    expect(wide.firstElementChild?.classList.contains('gantt-bar-badge')).toBe(true)   // 배지가 가장 먼저(왼쪽)
    expect(wide.querySelector('.gantt-bar-sub')?.textContent).toBe('a')
    const narrow = bar('CS52') // 하루 = 92px
    expect(narrow.querySelector('.gantt-bar-badge')).toBeNull()
    expect(narrow.querySelector('.gantt-bar-sub')?.textContent).toBe('a · 계약완료')
    const multi = bar('CS53')  // 3일 = 292px
    expect(multi.querySelector('.gantt-bar-badge')?.textContent).toBe('대여중')
    unmount(app); target.remove()
  })

  it('상세 카드가 열린 막대만 선택 표시(gantt-bar-selected·aria-current)가 붙고, 다른 막대를 누르면 옮겨간다', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [mk(61, ymd(1), ymd(2), 'confirmed'), mk(62, ymd(4), ymd(5), 'in_use')]
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ rows: [], siblings: [], options: [], bundles: [], payment: null, steps: [], units: [], locker_password: null }) })) as never
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const bar = (code: string): HTMLElement => Array.from(target.querySelectorAll<HTMLElement>('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code)!
    expect(target.querySelectorAll('.gantt-bar-selected').length).toBe(0)
    bar('CS61').click(); flushSync(); await new Promise((r) => setTimeout(r, 50)); flushSync()
    expect(bar('CS61').classList.contains('gantt-bar-selected')).toBe(true)
    expect(bar('CS61').getAttribute('aria-current')).toBe('true')
    expect(bar('CS62').classList.contains('gantt-bar-selected')).toBe(false)
    bar('CS62').click(); flushSync(); await new Promise((r) => setTimeout(r, 50)); flushSync()
    expect(bar('CS62').classList.contains('gantt-bar-selected')).toBe(true)
    expect(bar('CS61').classList.contains('gantt-bar-selected')).toBe(false)
    expect(target.querySelectorAll('.gantt-bar-selected').length).toBe(1)
    unmount(app); target.remove()
  })

  it('월 헤더는 월마다 라벨 하나씩(월 칸 안 sticky 라벨)이고 칸 폭은 그 달 일수 기준이다', async () => {
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: '2026-11-24', to: '2026-12-07', rows: [] }, cmsRole: 'manager' } as never })
    flushSync()
    const heads = Array.from(target.querySelectorAll<HTMLElement>('.gantt-month-header'))
    expect(heads.map((h) => h.querySelector('.gantt-month-label')?.textContent)).toEqual(['2026년 11월', '2026년 12월'])
    expect(heads.length).toBe(2)
    unmount(app); target.remove()
  })

  it('월 헤더 오른쪽 상태별 보기 드롭다운(SuggestPicker): 고른 상태의 막대만 남고, 전체 보기·연체 보기도 동작한다', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [mk(71, ymd(1), ymd(2), 'hold'), mk(72, ymd(1), ymd(2), 'confirmed'), mk(73, ymd(1), ymd(2), 'in_use'), mk(74, ymd(-2), ymd(-1), 'in_use'), mk(75, ymd(-2), ymd(-1), 'completed')]
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const codes = (): string[] => Array.from(target.querySelectorAll('.gantt-bar')).map((b) => b.getAttribute('data-reservation-code') ?? '').sort()
    const pick = async (label: string): Promise<void> => {
      const input = target.querySelector<HTMLInputElement>('#gantt-status-filter')!
      input.dispatchEvent(new FocusEvent('focus')); flushSync()
      const item = Array.from(target.querySelectorAll<HTMLElement>('.suggest-picker-item')).find((b) => b.textContent?.trim() === label)!
      item.click(); flushSync()
    }
    expect(target.querySelector('.gantt-month-row #gantt-status-filter')).not.toBeNull()   // 월 헤더 행 안에 있다
    expect(codes()).toEqual(['CS71', 'CS72', 'CS73', 'CS74', 'CS75'])                       // 기본 = 전체
    await pick('계약완료'); expect(codes()).toEqual(['CS72'])
    await pick('반납 연체'); expect(codes()).toEqual(['CS74'])                               // 종료일 지남 + 미반납
    await pick('완료'); expect(codes()).toEqual(['CS75'])
    await pick('전체 보기'); expect(codes()).toEqual(['CS71', 'CS72', 'CS73', 'CS74', 'CS75'])
    // 걸러내면 줄 배치도 다시 모인다(빈 줄을 만들지 않음)
    await pick('신청대기'); expect(target.querySelectorAll('.gantt-bar').length).toBe(1)
    unmount(app); target.remove()
  })

  it('상태별 보기를 바꿔 열려 있던 예약이 가려지면 상세 카드(선택)도 닫히고, 계속 보이는 예약이면 유지된다', async () => {
    const real = new Date()
    const ymd = (n: number): string => { const d = new Date(real); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const rows = [mk(81, ymd(1), ymd(2), 'confirmed'), mk(82, ymd(4), ymd(5), 'in_use')]
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ rows: [], siblings: [], options: [], bundles: [], payment: null, steps: [], units: [], locker_password: null }) })) as never
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(Gantt, { target, props: { initial: { from: ymd(-3), to: ymd(10), rows }, cmsRole: 'manager' } as never })
    flushSync()
    const pick = (label: string): void => {
      target.querySelector<HTMLInputElement>('#gantt-status-filter')!.dispatchEvent(new FocusEvent('focus')); flushSync()
      Array.from(target.querySelectorAll<HTMLElement>('.suggest-picker-item')).find((b) => b.textContent?.trim() === label)!.click(); flushSync()
    }
    const bar = (code: string): HTMLElement | undefined => Array.from(target.querySelectorAll<HTMLElement>('.gantt-bar')).find((b) => b.getAttribute('data-reservation-code') === code)
    bar('CS81')!.click(); flushSync(); await new Promise((r) => setTimeout(r, 50)); flushSync()
    expect(target.querySelectorAll('.gantt-bar-selected').length).toBe(1)
    pick('계약완료'); await new Promise((r) => setTimeout(r, 30)); flushSync()    // 열린 예약이 그대로 보임 → 유지
    expect(bar('CS81')!.classList.contains('gantt-bar-selected')).toBe(true)
    pick('대여중'); await new Promise((r) => setTimeout(r, 30)); flushSync()      // 열린 예약이 가려짐 → 닫힘
    expect(bar('CS81')).toBeUndefined()
    expect(target.querySelectorAll('.gantt-bar-selected').length).toBe(0)
    pick('전체 보기'); await new Promise((r) => setTimeout(r, 30)); flushSync()
    expect(bar('CS81')!.classList.contains('gantt-bar-selected')).toBe(false)       // 다시 보여도 자동으로 열리지 않음
    unmount(app); target.remove()
  })
})
