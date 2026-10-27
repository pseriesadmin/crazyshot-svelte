/**
 * GET /api/cms/reservations/[id]/request-notes — 고객이 예약신청 때 남긴 요청사항 조회 (CMS 전용, 읽기 전용)
 *
 * 장바구니 "요청 사항" 입력(공동현관 출입번호·경비실 호출 등 안내 문구 포함)은 수령용(pickup_request_note)·
 * 반납용(return_request_note)으로 나뉘어 예약에 저장된다(Migration 476). 과거 단일 요청사항(notes)이 있는 예약도 함께 돌려준다.
 * 수령 공동현관 출입번호(pickup_frontdoor_password, Migration #774)는 별도 전용 칸이라 manager 이상에게만 내려준다(무인보관함 비밀번호와 같은 수준).
 * RentalDetailPanel(/cms/rentals·/cms/reservation 공유)의 대여정보 탭이 lazy-fetch 로 읽어 표시한다.
 *
 * P3-4 (2026-10-27): 같은 주문(listOrderReservationIds)의 모든 예약 요청사항을 합쳐 반환.
 *   - 모든 예약의 값이 동일하면 단일 값(중복 제거)
 *   - 다른 값이 있으면 "상품명A: 값A / 상품명B: 값B" 형식으로 병합
 *   - pickup_frontdoor_password는 요청한 예약(reservationId)의 값만(권한 정책 불변)
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { listOrderReservationIds } from '$lib/server/dheroOrderUnits'
import { resolveParentProductFields } from '$lib/server/products/resolveParentProductFields'
import type { RequestHandler } from './$types'

function cleanNote(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * 주문 내 예약들의 동일 필드 값을 병합.
 * - 모든 값이 동일(null 포함) → 단일 값 반환
 * - 다른 값 있음 → "상품명: 값" 형식으로 / 구분자로 연결
 */
function mergeNoteField(
  rows: { product_name: string; value: string | null }[],
): string | null {
  const nonNull = rows.filter((r) => r.value !== null)
  if (nonNull.length === 0) return null
  const unique = [...new Set(nonNull.map((r) => r.value))]
  if (unique.length === 1) return unique[0] // 모두 같은 값 — 단일 반환
  // 다른 값 — 상품명과 함께 병합
  return nonNull.map((r) => `${r.product_name}: ${r.value}`).join(' / ')
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 주문 내 모든 예약 ID 수집 (fail-soft: 조회 실패 시 단건 처리)
  const siblingIds = await listOrderReservationIds(admin, reservationId)

  // 모든 예약의 요청사항 + product_id 조회
  const { data: rows, error } = await admin
    .from('rental_reservations')
    .select('id, notes, pickup_request_note, return_request_note, product_id')
    .in('id', siblingIds)

  if (error) return json({ error: '요청사항을 불러오지 못했습니다.' }, { status: 500 })
  if (!rows || rows.length === 0) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  // 상품명 조회 — product_id 목록으로 한 번에
  const typedRows = rows as { id: number; notes: unknown; pickup_request_note: unknown; return_request_note: unknown; product_id: string | null }[]
  const productIds = [...new Set(typedRows.map((r) => r.product_id).filter(Boolean))] as string[]
  const productNameMap = new Map<string, string>()
  if (productIds.length > 0) {
    try {
      const { data: rawProducts } = await admin
        .from('products')
        .select('id, name, parent_product_id')
        .in('id', productIds)
      // products.md §2-16: 자식 재고의 name은 부모 상품명으로 대체(부모 우선, 자식 폴백)
      const products = await resolveParentProductFields(
        admin,
        (rawProducts ?? []) as { id: string; name: string | null; parent_product_id: string | null }[],
        ['name'],
      )
      for (const p of products) {
        if (p.name) productNameMap.set(p.id, p.name)
      }
    } catch { /* fail-soft — 상품명 없이 값만 병합 */ }
  }

  // 각 필드 병합
  function toMergeRows(field: 'notes' | 'pickup_request_note' | 'return_request_note') {
    return typedRows.map((r) => ({
      product_name: (r.product_id ? productNameMap.get(r.product_id) : null) ?? '상품',
      value: cleanNote(r[field]),
    }))
  }

  const mergedNotes           = mergeNoteField(toMergeRows('notes'))
  const mergedPickup          = mergeNoteField(toMergeRows('pickup_request_note'))
  const mergedReturn          = mergeNoteField(toMergeRows('return_request_note'))

  // 공동현관 출입번호(Migration #774)는 요청한 예약(reservationId)의 값만 — 권한·정책 불변
  let frontdoor: string | null = null
  if (hasSettingsAccess(cmsRole)) {
    try {
      const { data: fd } = await admin
        .from('rental_reservations')
        .select('pickup_frontdoor_password')
        .eq('id', reservationId)
        .maybeSingle()
      frontdoor = cleanNote((fd as { pickup_frontdoor_password?: unknown } | null)?.pickup_frontdoor_password)
    } catch { /* fail-soft — 출입번호만 비어 보인다 */ }
  }

  return json({
    notes:               mergedNotes,
    pickup_request_note: mergedPickup,
    return_request_note: mergedReturn,
    pickup_frontdoor_password: frontdoor, // manager 이상만(partner 는 null)
  })
}
