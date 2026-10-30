// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import TimePickerGrid from '$lib/components/common/TimePickerGrid.svelte'

/** 당일 수령일에 이미 지난 시각을 고르지 못하게 하는 disabledBefore — 실행: npm run test:component (2026-10-30) */
let cmp: Record<string, unknown> | null = null
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
})

function render(props: { onselect: (t: string) => void; disabledBefore?: string | null; disabledAfter?: string | null; value?: string }) {
  cmp = mount(TimePickerGrid, { target: document.body, props })
  flushSync()
  return document.body
}
const btn = (body: HTMLElement, t: string) => Array.from(body.querySelectorAll<HTMLButtonElement>('button.time-row')).find((b) => b.textContent === t)!

describe('TimePickerGrid disabledBefore', () => {
  it('지정하지 않으면 24시간 48개 슬롯이 모두 선택 가능하다(기존 동작)', () => {
    const body = render({ onselect: () => {} })
    const buttons = body.querySelectorAll<HTMLButtonElement>('button.time-row')
    expect(buttons).toHaveLength(48)
    expect(Array.from(buttons).some((b) => b.disabled)).toBe(false)
  })

  it('"15:03" 이전 슬롯은 비활성, 15:00까지 포함하고 15:30부터 활성', () => {
    const body = render({ onselect: () => {}, disabledBefore: '15:03' })
    expect(btn(body, '00:00').disabled).toBe(true)
    expect(btn(body, '15:00').disabled).toBe(true)
    expect(btn(body, '15:30').disabled).toBe(false)
    expect(btn(body, '23:30').disabled).toBe(false)
    expect(btn(body, '15:00').classList.contains('time-row-past')).toBe(true)
  })

  it('비활성 슬롯을 눌러도 onselect 가 호출되지 않고, 활성 슬롯은 호출된다', () => {
    const onselect = vi.fn()
    const body = render({ onselect, disabledBefore: '15:03' })
    btn(body, '09:00').click()
    expect(onselect).not.toHaveBeenCalled()
    btn(body, '16:00').click()
    expect(onselect).toHaveBeenCalledWith('16:00')
  })

  it('null 이면 제한 없음(오늘이 아닌 날짜)', () => {
    const body = render({ onselect: () => {}, disabledBefore: null })
    expect(Array.from(body.querySelectorAll<HTMLButtonElement>('button.time-row')).some((b) => b.disabled)).toBe(false)
  })

  it('disabledAfter 를 주면 그 시각 초과 슬롯이 비활성(퀵 수령 22:00 / 퀵 반납 09:30)', () => {
    const body = render({ onselect: () => {}, disabledBefore: '12:00', disabledAfter: '22:00' })
    expect(btn(body, '11:30').disabled).toBe(true)
    expect(btn(body, '12:00').disabled).toBe(false)
    expect(btn(body, '22:00').disabled).toBe(false)
    expect(btn(body, '22:30').disabled).toBe(true)
    expect(btn(body, '23:30').disabled).toBe(true)
  })

  it('퀵 반납(09:00~09:30)이면 두 슬롯만 활성이다', () => {
    const body = render({ onselect: () => {}, disabledBefore: '09:00', disabledAfter: '09:30' })
    const enabled = Array.from(body.querySelectorAll<HTMLButtonElement>('button.time-row')).filter((b) => !b.disabled).map((b) => b.textContent)
    expect(enabled).toEqual(['09:00', '09:30'])
  })

  it('"24:00" 이면 하루 전체가 비활성(그 날 선택 가능한 시각 없음)', () => {
    const body = render({ onselect: () => {}, disabledBefore: '24:00' })
    expect(Array.from(body.querySelectorAll<HTMLButtonElement>('button.time-row')).every((b) => b.disabled)).toBe(true)
  })
})
