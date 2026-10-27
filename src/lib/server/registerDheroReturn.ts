// src/lib/server/registerDheroReturn.ts
// 반납 접수(대여중 → 반납중) 시 두발히어로 반품 접수 — 공용 fail-soft 헬퍼 (2026-10-23)
//
// 배경: 반품 접수(registerReturn)는 관리자 상태변경 액션 updateStatus 가 return_requested 로 전환할 때만 호출됐다.
// 고객 반납정보 제출(return-submit)·관리자 대리 등록(return-entries)은 update_reservation_status RPC 를 직접 호출해
// 이 트리거를 우회했으므로(배송대여 예약에서 반품 접수·반납 배송완료 자동 전환이 일어나지 않던 구멍), 두 경로가 전환 성공 직후 이 헬퍼를 호출한다.
//
// 규칙(updateStatus 의 return_requested 분기와 동일):
//   - 반납방식이 is_dhero_integration(두발히어로 연동 대상, DB 플래그 — 리터럴 비교 금지)이고 운송장(tracking_number)이 있을 때만 호출
//   - 이미 반품 접수(dhero_return_book_id)가 있으면 중복 접수하지 않는다(재제출·재시도 방어)
//   - 어떤 오류도 throw 하지 않는다 — 결과(outcome)로 돌려주고 호출자는 제출·등록 자체를 성공 처리한다
//   - H-01: DB 쓰기는 update_reservation_dhero_shipment RPC 경유

import { getReservationForDhero } from '$lib/server/getReservationForDhero'
import { isDheroIntegrationMethod } from '$lib/server/isDheroIntegrationMethod'
import { registerReturn, DHERO_STATUS_LABEL, DheroApiError } from '$lib/server/dhero'
import { listSameBookReservationIds } from '$lib/server/dheroOrderUnits'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = { from: (table: string) => any; rpc: (...args: any[]) => any }

/** 두발히어로 응답 대기 상한(ms) — 고객 제출 요청이 외부 API 지연으로 길어지지 않게 한다(dhero fetch 자체에는 제한 시간이 없음) */
export const DHERO_RETURN_TIMEOUT_MS = 8000

class DheroTimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DheroTimeoutError('timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

export type DheroReturnOutcome = 'registered' | 'skipped' | 'failed'

export interface DheroReturnResult {
  outcome: DheroReturnOutcome
  /** failed 일 때 관리자에게 보여줄 사유 */
  message?: string
}

/**
 * 같은 주문·같은 접수번호의 형제 예약 중 이미 반품 접수된 건이 있으면 그 반품번호를 반환한다.
 * 형제가 없거나 아직 아무도 접수하지 않았거나 조회 중 오류가 나면 null 을 반환한다(fail-soft).
 *
 * 단일 예약(형제 없음)에서 admin.from 을 호출하지 않도록 others.length === 0 을 먼저 확인한다.
 */
async function findSiblingReturnBookId(
  admin: AnySupabaseClient,
  reservationId: number,
  trackingNumber: string,
): Promise<string | null> {
  try {
    const sibIds = await listSameBookReservationIds(admin, reservationId, trackingNumber)
    const others = sibIds.filter((id) => id !== reservationId)
    if (others.length === 0) return null
    const { data, error: sibErr } = (await admin
      .from('rental_reservations')
      .select('dhero_return_book_id')
      .in('id', others)
      .not('dhero_return_book_id', 'is', null)
      .limit(1)
      .maybeSingle()) as { data: { dhero_return_book_id: string } | null; error: { message: string } | null }
    if (sibErr) return null  // fail-soft: 조회 오류 시 기존 단독 접수 흐름으로 이어짐
    return data?.dhero_return_book_id ?? null
  } catch {
    return null
  }
}

export async function registerDheroReturn(
  admin: AnySupabaseClient,
  reservationId: number,
): Promise<DheroReturnResult> {
  try {
    const res = await getReservationForDhero(admin, reservationId)
    if (!res) return { outcome: 'skipped' }

    const isDheroOn = await isDheroIntegrationMethod(admin, res.returnMethod)
    if (!isDheroOn || !res.trackingNumber) return { outcome: 'skipped' }
    if (res.dheroReturnBookId) return { outcome: 'skipped' }

    // 형제 단위 중복 방어 — 같은 주문·같은 접수번호의 형제가 이미 반품 접수됐으면
    // 두발히어로 API 를 다시 호출하지 않고 형제 반품번호를 저장한다.
    const siblingReturnBookId = await findSiblingReturnBookId(admin, reservationId, res.trackingNumber)
    if (siblingReturnBookId !== null) {
      // 현재 저장된 dhero 값(크론이 갱신한 상태·코드·동그룹·메타)을 그대로 전달한다.
      // RPC 는 p_status·p_status_code·p_dong_group·p_meta 를 COALESCE 없이 덮어쓰므로
      // null/{} 를 넘기면 기존 값이 지워진다(supabase/migrations/*343* 53~64행 참조).
      const { error: siblingErr } = await admin.rpc('update_reservation_dhero_shipment', {
        p_reservation_id:  reservationId,
        p_tracking_number: res.trackingNumber,
        p_courier_code:    '두발히어로',
        p_status:          res.dheroStatus ?? (DHERO_STATUS_LABEL[0] ?? '반품접수'),
        p_status_code:     res.dheroStatusCode ?? 0,
        p_dong_group:      res.dheroDongGroup ?? null,
        p_meta:            res.dheroMeta ?? {},
        p_return_book_id:  siblingReturnBookId,
      })
      if (siblingErr) {
        console.error(
          `[registerDheroReturn] 형제 반품번호 저장 실패 (id=${reservationId}, bookId=${siblingReturnBookId}):`,
          (siblingErr as { message: string }).message,
        )
        return {
          outcome: 'failed',
          message: `두발히어로에는 반품이 접수됐지만(${siblingReturnBookId}) 이 예약에 저장하지 못했습니다. 예약 상세에서 확인 후 수동으로 등록해 주세요.`,
        }
      }
      return { outcome: 'registered' }
    }

    let returnRes: Awaited<ReturnType<typeof registerReturn>>
    try {
      returnRes = await withTimeout(registerReturn(res.trackingNumber), DHERO_RETURN_TIMEOUT_MS)
    } catch (e) {
      if (e instanceof DheroTimeoutError) {
        console.error(`[registerDheroReturn] 두발히어로 응답 지연(${DHERO_RETURN_TIMEOUT_MS}ms 초과) (id=${reservationId})`)
        return {
          outcome: 'failed',
          message: '두발히어로 응답이 지연돼 반품 접수 여부를 확인하지 못했습니다. 예약 상세에서 두발히어로 상태를 확인한 뒤 필요하면 수동으로 등록해 주세요.',
        }
      }
      const message = e instanceof DheroApiError
        ? `두발히어로 반품 접수에 실패했습니다: ${e.message}`
        : '두발히어로 반품 접수에 실패했습니다.'
      console.error(`[registerDheroReturn] 반품 접수 실패 (id=${reservationId}):`, e instanceof Error ? e.message : e)
      return { outcome: 'failed', message }
    }

    // 안내서: 반품 접수 응답은 { bookId, orderIdFromCorp, reason, success } — HTTP 2xx 여도 success=false 일 수 있다(reason 에 사유)
    if (returnRes.success === false) {
      const reason = typeof returnRes.reason === 'string' && returnRes.reason ? `: ${returnRes.reason}` : ''
      console.error(`[registerDheroReturn] 반품 접수 거절(success=false) (id=${reservationId})${reason}`)
      return { outcome: 'failed', message: `두발히어로가 반품 접수를 받아들이지 않았습니다${reason}` }
    }

    const { error } = await admin.rpc('update_reservation_dhero_shipment', {
      p_reservation_id:  reservationId,
      p_tracking_number: res.trackingNumber,
      p_courier_code:    '두발히어로',
      p_status:          DHERO_STATUS_LABEL[0] ?? '반품접수',
      p_status_code:     0,
      p_dong_group:      returnRes.dongGroup ?? null,
      p_meta:            returnRes as Record<string, unknown>,
      p_return_book_id:  returnRes.bookId,
    })
    if (error) {
      console.error(`[registerDheroReturn] 접수 후 저장 실패 (id=${reservationId}, bookId=${returnRes.bookId}):`, error.message)
      return {
        outcome: 'failed',
        message: `두발히어로에는 반품 접수됐지만(${returnRes.bookId}) 시스템 저장에 실패했습니다. 예약 상세에서 두발히어로 상태를 새로고침해 주세요.`,
      }
    }
    return { outcome: 'registered' }
  } catch (e) {
    console.error(`[registerDheroReturn] 외부 fail-soft (id=${reservationId}):`, e instanceof Error ? e.message : e)
    return { outcome: 'failed', message: '두발히어로 반품 접수 처리 중 오류가 발생했습니다.' }
  }
}
