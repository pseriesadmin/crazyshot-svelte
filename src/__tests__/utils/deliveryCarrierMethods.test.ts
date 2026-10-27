import { describe, it, expect } from 'vitest'
import { carrierVisibleMethods } from '../../lib/utils/deliveryCarrierMethods'

/**
 * 배송송출연동 관리 — 업체 연동 칩에 보여줄 방식 선택 (2026-10-27, Stephen 지시: "B로 줄여서 진행")
 *  CM-1  배송형(is_delivery_type) 방식만 칩으로 보인다 — 방문·퀵·무인보관함처럼 배송업체와 무관한 방식은 숨겨 잘못 켜는 사고를 막는다
 *  CM-2  이미 켜져 있는 방식은 배송형이 아니어도 계속 보인다 — 켜진 채 화면에서 사라져 끌 수 없게 되는 일이 없다
 *  CM-3  원래 순서를 유지하고 원본 배열을 바꾸지 않는다
 *  CM-4  배송형도 켜진 방식도 없으면 빈 목록(화면이 안내 문구를 보여준다)
 */

interface M { id: string; name: string; is_delivery_type: boolean; on: boolean }
const mk = (id: string, is_delivery_type: boolean, on = false): M => ({ id, name: id, is_delivery_type, on })

describe('carrierVisibleMethods', () => {
  it('CM-1: 배송형 방식만 보인다', () => {
    const ms = [mk('visit', false), mk('delivery', true), mk('quick', false), mk('locker', false)]
    expect(carrierVisibleMethods(ms, (m) => m.on).map((m) => m.id)).toEqual(['delivery'])
  })

  it('CM-2: 켜져 있으면 배송형이 아니어도 보인다', () => {
    const ms = [mk('visit', false, true), mk('delivery', true)]
    expect(carrierVisibleMethods(ms, (m) => m.on).map((m) => m.id)).toEqual(['visit', 'delivery'])
  })

  it('CM-3: 순서 유지·원본 불변', () => {
    const ms = [mk('a', true), mk('b', false), mk('c', true)]
    const copy = [...ms]
    expect(carrierVisibleMethods(ms, (m) => m.on).map((m) => m.id)).toEqual(['a', 'c'])
    expect(ms).toEqual(copy)
  })

  it('CM-4: 해당 방식이 없으면 빈 목록', () => {
    expect(carrierVisibleMethods([mk('visit', false)], (m) => m.on)).toEqual([])
    expect(carrierVisibleMethods<M>([], (m) => m.on)).toEqual([])
  })
})
