import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 계약서 결제(서명 후 토스 결제) 서버 사전등록 헬퍼 (2026-10-04, CRITICAL)
 *
 * 문제: 계약서 결제 경로는 토스 orderId(`CSHOT-${Date.now()}`)와 위젯 금액을 클라이언트가 정했다.
 * 해결: 결제창을 열기 직전 서버(pay-start)가 ① 서명 완료·hold·주문 존재를 확인하고 ② 청구금액을
 * 서버 저장 orders.final_amount로 돌려주며 ③ 주문에 묶인 토스 orderId를 발급한다. pay-result는 승인 전에
 * 그 orderId가 이 주문의 것인지 확인한다(다른 주문/임의 문자열로 승인 요청 불가).
 */

export type ContractPayLoad =
  | { ok: true; orderId: number; reservationId: number; userId: string | null; finalAmount: number; selectedPoints: number; orderName: string }
  | { ok: false; code: ContractPayErrorCode; status: number }

export type ContractPayErrorCode =
  | 'INVALID_TOKEN' | 'NOT_SIGNED' | 'NO_RESERVATION' | 'RESERVATION_NOT_ACTIVE' | 'NO_ORDER' | 'AMOUNT_UNKNOWN' | 'NOT_PAYABLE'

/** 계약 토큰 → 결제 대상 주문 확인 (읽기 전용) */
export async function loadContractPayOrder(admin: SupabaseClient, token: string): Promise<ContractPayLoad> {
  const { data: signing } = await admin
    .from('contract_signings')
    .select('contract_id, signed_at')
    .eq('token', token)
    .maybeSingle()
  const s = signing as { contract_id: string | null; signed_at: string | null } | null
  if (!s?.contract_id) return { ok: false, code: 'INVALID_TOKEN', status: 404 }
  if (!s.signed_at) return { ok: false, code: 'NOT_SIGNED', status: 400 }

  const { data: contract } = await admin.from('contracts').select('reservation_id').eq('id', s.contract_id).maybeSingle()
  const reservationId = (contract as { reservation_id: number | null } | null)?.reservation_id
  if (!reservationId) return { ok: false, code: 'NO_RESERVATION', status: 404 }

  const { data: reservation } = await admin.from('rental_reservations').select('status, user_id').eq('id', reservationId).maybeSingle()
  const rv = reservation as { status: string; user_id: string | null } | null
  if (rv?.status !== 'hold') {
    return { ok: false, code: 'RESERVATION_NOT_ACTIVE', status: 409 }
  }

  const { data: item } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (item as { order_id: number | null } | null)?.order_id
  if (!orderId) return { ok: false, code: 'NO_ORDER', status: 409 }

  const { data: order } = await admin.from('orders').select('final_amount, selected_points').eq('id', orderId).maybeSingle()
  const finalAmount = Number((order as { final_amount: number | string | null } | null)?.final_amount ?? NaN)
  const selectedPoints = Math.max(0, Math.trunc(Number((order as { selected_points: number | null } | null)?.selected_points ?? 0)) || 0)
  if (!Number.isFinite(finalAmount)) return { ok: false, code: 'AMOUNT_UNKNOWN', status: 500 }
  if (finalAmount <= 0) return { ok: false, code: 'NOT_PAYABLE', status: 400 }

  return { ok: true, orderId, reservationId, userId: rv.user_id, finalAmount, selectedPoints, orderName: '크레이지샷 장비 대여' }
}

/** 주문에 묶인 토스 orderId 발급 — 토스 규칙(6~64자, 영문·숫자·-·_) 준수 */
export function buildContractTossOrderId(orderId: number): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `CSHOT-${orderId}-${Date.now().toString(36)}${rand}`
}

/**
 * pay-result가 승인 전에 확인하는 토스 orderId 형식: `CSHOT-{내부주문id}-{영숫자}` — 이 주문의 것이어야 한다.
 * (구 클라이언트 생성 형식 `CSHOT-{13자리 타임스탬프}`는 배포 직후 제거 — Stephen 지시 2026-10-04. 배포 시점에 이미
 *  결제창을 연 고객은 결제가 거부되므로 처음부터 다시 진행해야 한다. 금액은 결제 전이라 청구되지 않는다.)
 */
export function isAcceptedContractTossOrderId(tossOrderId: string, orderId: number): boolean {
  const prefix = `CSHOT-${orderId}-`
  return tossOrderId.startsWith(prefix) && /^[A-Za-z0-9]{6,40}$/.test(tossOrderId.slice(prefix.length))
}
