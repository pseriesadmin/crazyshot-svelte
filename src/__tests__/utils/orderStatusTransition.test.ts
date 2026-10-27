import { describe, it, expect } from 'vitest'
import { planOrderTransition, summarizeOrderTransition, ORDER_LIFECYCLE_TARGETS } from '../../lib/utils/orderStatusTransition'

/**
 * ④ 주문 단위 단일 처리 버튼 — 대상 선정 규칙 (2026-10-27, Stephen 확정 "기본값대로 진행")
 * 한 주문(예약코드 1개)의 상품들을 하단 버튼 하나로 다음 단계로 처리한다.
 *  OT-1  같은 상태의 상품 전부가 대상이다 (택배 출고 처리 = confirmed → shipped)
 *  OT-2  상태가 섞여 있으면 "가장 덜 진행된 단계"의 상품만 대상 — 더 진행된 상품은 건드리지 않는다
 *  OT-3  취소·만료·완료·파손·신청대기 등 대여 진행 상태가 아닌 상품은 계산에서 제외한다
 *  OT-4  요청한 다음 단계가 그 상태의 다음 단계가 아니면 대상이 없다(화면과 어긋난 요청 방어)
 *  OT-5  방문 수령은 confirmed → in_use 로 건너뛴다(nextStatus 규칙 재사용)
 *  OT-6  허용 대상 단계는 shipped·in_use·return_requested·returned 뿐이다(완료·취소·확정은 이 경로로 못 한다)
 */

const u = (id: number, status: string, pickup = 'delivery', ret = 'delivery') => ({ id, status, pickup_method: pickup, return_method: ret })

describe('planOrderTransition', () => {
  it('OT-1: 같은 상태의 상품 전부가 대상', () => {
    const plan = planOrderTransition([u(1, 'confirmed'), u(2, 'confirmed')], 'shipped')
    expect(plan.orderStatus).toBe('confirmed')
    expect(plan.targetIds).toEqual([1, 2])
    expect(plan.skippedIds).toEqual([])
  })

  it('OT-2: 섞인 상태는 가장 덜 진행된 단계만 대상, 나머지는 건너뜀', () => {
    const plan = planOrderTransition([u(1, 'confirmed'), u(2, 'shipped')], 'shipped')
    expect(plan.orderStatus).toBe('confirmed')
    expect(plan.targetIds).toEqual([1])
    expect(plan.skippedIds).toEqual([2])
  })

  it('OT-3: 진행 상태가 아닌 상품은 제외', () => {
    const plan = planOrderTransition([u(1, 'cancelled'), u(2, 'confirmed'), u(3, 'expired'), u(4, 'completed'), u(5, 'hold')], 'shipped')
    expect(plan.targetIds).toEqual([2])
    expect(plan.skippedIds).toEqual([])
  })

  it('OT-4: 요청 단계가 다음 단계가 아니면 대상 없음', () => {
    expect(planOrderTransition([u(1, 'confirmed')], 'in_use').targetIds).toEqual([])
    expect(planOrderTransition([u(1, 'shipped')], 'shipped').targetIds).toEqual([])
    expect(planOrderTransition([], 'shipped').targetIds).toEqual([])
  })

  it('OT-5: 방문 수령은 confirmed → in_use', () => {
    expect(planOrderTransition([u(1, 'confirmed', 'visit', 'visit')], 'in_use').targetIds).toEqual([1])
    expect(planOrderTransition([u(1, 'confirmed', 'visit', 'visit')], 'shipped').targetIds).toEqual([])
  })

  it('OT-5b: in_use → 반납 접수(return_requested) / 방문 반납은 returned', () => {
    expect(planOrderTransition([u(1, 'in_use'), u(2, 'in_use')], 'return_requested').targetIds).toEqual([1, 2])
    expect(planOrderTransition([u(1, 'in_use', 'visit', 'visit')], 'returned').targetIds).toEqual([1])
    expect(planOrderTransition([u(1, 'return_requested')], 'returned').targetIds).toEqual([1])
  })

  it('OT-6: 허용 대상 단계 목록', () => {
    expect([...ORDER_LIFECYCLE_TARGETS]).toEqual(['shipped', 'in_use', 'return_requested', 'returned'])
  })
})

/**
 *  OS-1  전부 성공(상품 1개): 기존과 같은 문구
 *  OS-2  전부 성공(여러 개): 처리된 상품 수를 알린다
 *  OS-3  더 진행돼 건너뛴 상품이 있으면 그 수를 알린다
 *  OS-4  일부 실패: 경고이고 실패한 상품 이름·사유를 알린다
 */
describe('summarizeOrderTransition', () => {
  const names = new Map<number, string>([[1, 'Sony FX3'], [2, 'Manfrotto 055']])
  const nameOf = (id: number) => names.get(id) ?? `#${id}`

  it('OS-1: 상품 1개 성공', () => {
    expect(summarizeOrderTransition({ processed: [1] }, nameOf)).toEqual({ level: 'success', text: '상태가 변경되었습니다.' })
  })

  it('OS-2: 여러 개 성공', () => {
    expect(summarizeOrderTransition({ processed: [1, 2] }, nameOf)).toEqual({ level: 'success', text: '2개 상품의 상태가 변경되었습니다.' })
  })

  it('OS-3: 건너뜀 안내', () => {
    const r = summarizeOrderTransition({ processed: [1], skipped: [2] }, nameOf)
    expect(r.level).toBe('success')
    expect(r.text).toContain('이미 더 진행된 1개 상품은 그대로 두었습니다')
  })

  it('OS-4: 일부 실패는 경고 + 이름·사유', () => {
    const r = summarizeOrderTransition({ processed: [1], failed: [{ id: 2, message: '허용되지 않은 상태 전환입니다.' }] }, nameOf)
    expect(r.level).toBe('warning')
    expect(r.text).toContain('1개 상품은 처리됐지만')
    expect(r.text).toContain('Manfrotto 055')
    expect(r.text).toContain('허용되지 않은 상태 전환입니다.')
  })
})
