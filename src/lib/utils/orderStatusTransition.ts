// src/lib/utils/orderStatusTransition.ts
// ④ 주문 단위 단일 처리 버튼 — 어떤 상품을 처리할지 정하는 규칙 (2026-10-27, Stephen 확정)
//
// 한 주문(예약코드 1개)에 상품이 여러 개여도 패널 하단 버튼 하나로 주문 전체를 다음 단계로 처리한다(상품별 줄은 제거).
// 주문 상태 = 대여 진행 상태인 상품 중 "가장 덜 진행된 단계"(목록 상태 규칙과 같다). 대상 = 그 단계에 있고 요청한 다음 단계로 갈 수 있는 상품 전부.
// 더 진행된 상품은 건드리지 않는다(skippedIds). 취소·만료·완료·파손·신청대기 등은 계산에서 제외한다.
// 상품별 처리는 모바일 QR 스캔(rentalQrTransition)이 계속 맡는다.
import { nextStatus } from '$lib/utils/rentalTransition'

/** 이 경로로 처리할 수 있는 목표 단계 — 완료(검수 승인)·취소·계약완료(서명+결제)는 각자 정해진 경로로만 간다 */
export const ORDER_LIFECYCLE_TARGETS = ['shipped', 'in_use', 'return_requested', 'returned'] as const
export type OrderLifecycleTarget = (typeof ORDER_LIFECYCLE_TARGETS)[number]

const PROGRESS = ['confirmed', 'shipped', 'in_use', 'return_requested', 'returned'] as const

export interface OrderUnit {
  id: number
  status: string
  pickup_method: string | null
  return_method: string | null
}

export interface OrderTransitionPlan {
  /** 진행 상태인 상품 중 가장 덜 진행된 단계(없으면 null) */
  orderStatus: string | null
  targetIds: number[]
  /** 진행 상태이지만 이번에는 건드리지 않는 상품(더 진행됐거나 요청 단계로 갈 수 없음) */
  skippedIds: number[]
}

export function planOrderTransition(units: readonly OrderUnit[], requested: string): OrderTransitionPlan {
  const active = units.filter((x) => (PROGRESS as readonly string[]).includes(x.status))
  if (active.length === 0) return { orderStatus: null, targetIds: [], skippedIds: [] }

  const orderStatus = active.reduce((min, x) => (PROGRESS.indexOf(x.status as (typeof PROGRESS)[number]) < PROGRESS.indexOf(min as (typeof PROGRESS)[number]) ? x.status : min), active[0].status)

  const targetIds: number[] = []
  const skippedIds: number[] = []
  for (const x of [...active].sort((a, b) => a.id - b.id)) {
    if (x.status === orderStatus && nextStatus(x.status, x.pickup_method, x.return_method) === requested) targetIds.push(x.id)
    else skippedIds.push(x.id)
  }
  // 대상이 하나도 없으면 "건너뜀"을 따로 알릴 의미가 없다(요청이 현재 단계와 어긋난 것)
  return { orderStatus, targetIds, skippedIds: targetIds.length === 0 ? [] : skippedIds }
}

/** 주문 단위 처리 결과 안내 문구 — 패널 토스트용. 일부 실패는 경고(성공한 상품은 유지됨), 건너뜀(더 진행된 상품)은 성공 문구에 덧붙인다 */
export function summarizeOrderTransition(
  result: { processed?: number[]; failed?: { id: number; message: string }[]; skipped?: number[] },
  nameOf: (id: number) => string,
): { level: 'success' | 'warning'; text: string } {
  const n = result.processed?.length ?? 0
  const failed = result.failed ?? []
  const skipped = result.skipped?.length ?? 0
  if (failed.length > 0) {
    const names = failed.map((f) => nameOf(f.id)).join(', ')
    return { level: 'warning', text: `${n}개 상품은 처리됐지만 ${names} ${failed.length}개는 처리하지 못했습니다. (${failed[0].message})` }
  }
  const base = n > 1 ? `${n}개 상품의 상태가 변경되었습니다.` : '상태가 변경되었습니다.'
  return { level: 'success', text: skipped > 0 ? `${base} 이미 더 진행된 ${skipped}개 상품은 그대로 두었습니다.` : base }
}
