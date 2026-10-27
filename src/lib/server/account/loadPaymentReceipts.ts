/**
 * 마이페이지 대여·취소 카드의 '카드영수증 보기' / '카드 취소내역 보기' 노출 정보 (2026-10-26)
 *
 * 서비스 롤 클라이언트로 payment_transactions 를 읽되 사용자 본인 결제(user_id)만 대상으로 하고,
 * 클라이언트로는 extractReceiptInfo 가 골라낸 최소 정보(영수증 주소·취소 여부)만 내려간다 — toss_response 원본 비노출.
 * 한 주문의 결제 행은 대표 예약 1건에만 붙으므로(Migration 378) 직접 매칭이 없으면 order_items 경유 형제 예약으로 찾는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { extractReceiptInfo, isCancelDetailAvailable, type PaymentReceiptInfo, type ReceiptTxRow } from '$lib/utils/paymentReceipt'

export interface CardPaymentInfo extends PaymentReceiptInfo {
  /** 카드 취소내역 상세창을 열 수 있는가(취소·부분취소 결제) */
  cancelDetail: boolean
}

interface TxRow extends ReceiptTxRow {
  reservation_id: number | null
  created_at: string | null
}

const COLS = 'reservation_id, status, total_amount, paid_amount, toss_response, pg_cancelled_at, cancelled_at, cancel_reason, created_at'

const SETTLED = new Set(['done', 'cancelled', 'partial_cancelled'])

/** 결제 재시도로 failed·pending 행이 더 최신이어도 완료·취소된 결제 행을 우선한다(영수증 버튼이 사라지지 않게) */
function latest(rows: TxRow[]): TxRow | null {
  const byNewest = (a: TxRow, b: TxRow) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
  const settled = rows.filter(r => SETTLED.has(r.status ?? ''))
  return [...(settled.length > 0 ? settled : rows)].sort(byNewest)[0] ?? null
}

/** 예약 id(문자열) → 카드 결제 정보. 결제 행이 없는 예약은 맵에 없다. 조회 오류는 빈 맵(fail-soft — 버튼만 숨김) */
export async function loadPaymentReceipts(
  admin: SupabaseClient,
  userId: string,
  reservationIds: Array<string | number>,
): Promise<Map<string, CardPaymentInfo>> {
  const out = new Map<string, CardPaymentInfo>()
  const ids = [...new Set(reservationIds.map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (ids.length === 0) return out

  try {
    const directRes = await admin.from('payment_transactions').select(COLS).eq('user_id', userId).in('reservation_id', ids)
    const direct = ((directRes as { data?: TxRow[] | null } | null)?.data ?? [])
    const byRes = new Map<number, TxRow[]>()
    for (const r of direct) {
      if (r.reservation_id == null) continue
      byRes.set(r.reservation_id, [...(byRes.get(r.reservation_id) ?? []), r])
    }

    // 직접 매칭이 없는 예약 → 같은 주문의 형제 예약에 붙은 결제 행
    const unmatched = ids.filter(id => !byRes.has(id))
    if (unmatched.length > 0) {
      const ownRes = await admin.from('order_items').select('reservation_id, order_id').in('reservation_id', unmatched)
      const own = ((ownRes as { data?: Array<{ reservation_id: number; order_id: number }> | null } | null)?.data ?? [])
      const orderIds = [...new Set(own.map(o => o.order_id))]
      if (orderIds.length > 0) {
        const allRes = await admin.from('order_items').select('reservation_id, order_id').in('order_id', orderIds)
        const all = ((allRes as { data?: Array<{ reservation_id: number | null; order_id: number }> | null } | null)?.data ?? [])
        const siblingIds = [...new Set(all.map(a => a.reservation_id).filter((v): v is number => v != null))]
        const sibTxRes = await admin.from('payment_transactions').select(COLS).eq('user_id', userId).in('reservation_id', siblingIds)
        const sibTx = ((sibTxRes as { data?: TxRow[] | null } | null)?.data ?? [])
        const txByOrder = new Map<number, TxRow[]>()
        for (const a of all) {
          const hit = sibTx.filter(t => t.reservation_id === a.reservation_id)
          if (hit.length) txByOrder.set(a.order_id, [...(txByOrder.get(a.order_id) ?? []), ...hit])
        }
        for (const o of own) {
          const rows = txByOrder.get(o.order_id)
          if (rows?.length) byRes.set(o.reservation_id, rows)
        }
      }
    }

    for (const [resId, rows] of byRes) {
      const tx = latest(rows)
      const info = extractReceiptInfo(tx)
      if (!tx || !info) continue
      out.set(String(resId), { ...info, cancelDetail: isCancelDetailAvailable(tx) })
    }
  } catch {
    // fail-soft — 영수증 조회 실패가 대여·취소 목록 표시를 막지 않는다(버튼만 숨김)
    return new Map()
  }
  return out
}

/** 카드(그룹) 하나에 속한 예약 id 들 중 결제 정보가 있는 첫 번째 — 카드당 영수증 1개 */
export function pickCardPayment(
  memberIds: Array<string | number>,
  payments: Map<string, CardPaymentInfo>,
): CardPaymentInfo | null {
  for (const id of memberIds) {
    const hit = payments.get(String(id))
    if (hit) return hit
  }
  return null
}
