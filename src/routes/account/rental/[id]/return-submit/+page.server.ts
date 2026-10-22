/**
 * /account/rental/[id]/return-submit — 고객 반납 제출 화면 (Migration #722, 2026-10-17)
 *
 * 반납 방식별 안내 알림(택배 [반납요청] · 무인함 [무인함 반납완료] · 퀵 [반납 진행중])의 착지 화면.
 * 택배: 사진 + 장비 확인 체크리스트 / 무인함: 사진 + 무인함 번호·비밀번호 / 퀵: 진행 확인만.
 * 보안: 세션 필수 + user_id 소유권. 방문·방식 미지정 예약은 제출 대상이 아니다(안내만).
 */
import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { PageServerLoad } from './$types'
import { loadReturnInspectionItems, loadReturnPhotoItems, customerChecklistOf, customerPhotoOf } from '$lib/server/returnInspectionItems'
import { RETURN_CHECKLIST_ITEMS, RETURN_MEDIA_ITEMS } from '$lib/utils/returnNotice'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { RETURN_SUBMIT_STATUSES } from '$lib/server/returnSubmission'
import { toReturnSubmitMethod, type ReturnSubmitMethod } from '$lib/utils/returnNotice'
import { loadReturnMissionPoints } from '$lib/server/awardReturnRegisterMissionPoints'

export interface RentalForReturnSubmit {
  id: number
  status: string
  reservation_code: string | null
  start_date: string | null
  end_date: string | null
  return_time: string | null
  return_method: string | null
  product_name: string | null
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, `/auth/login?redirect=${encodeURIComponent(url.pathname)}`)

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) throw redirect(303, '/account/rental')

  const { data: reservation, error: resErr } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, reservation_code, start_date, end_date, return_time, return_method, product_id, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()
  if (resErr || !reservation) throw redirect(303, '/account/rental')

  const r = reservation as Record<string, unknown>
  // 자식 재고의 이름은 부모 값을 따른다(자식 재고 부모 참조 전환)
  await applyParentFieldsToRowProducts([r], ['name'])
  const product = (r.products as { name: string } | null) ?? null

  const rental: RentalForReturnSubmit = {
    id: r.id as number,
    status: r.status as string,
    reservation_code: r.reservation_code as string | null,
    start_date: r.start_date as string | null,
    end_date: r.end_date as string | null,
    return_time: r.return_time as string | null,
    return_method: r.return_method as string | null,
    product_name: product?.name ?? null,
  }

  // 소개 화면 배경(폴라로이드)용 대여 상품 이미지 — 같은 주문의 상품들(없으면 이 예약 하나), 부모 값 우선, 최대 5장
  let mateIds: number[] = [reservationId]
  const { data: myItem } = await locals.supabase.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (myItem as { order_id: number } | null)?.order_id ?? null
  if (orderId) {
    const { data: items } = await locals.supabase.from('order_items').select('reservation_id').eq('order_id', orderId)
    const ids = ((items ?? []) as Array<{ reservation_id: number | null }>).map((x) => x.reservation_id).filter((x): x is number => typeof x === 'number')
    if (ids.length > 0) mateIds = ids
  }
  const { data: mates } = await locals.supabase
    .from('rental_reservations')
    .select('id, products!rental_reservations_product_id_fkey(image_urls, parent_product_id)')
    .in('id', mateIds)
    .eq('user_id', session.user.id)
  // 타입 가드로 행만 추려 쓴다(as unknown as 캐스팅 금지 — core-rules)
  const isRow = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
  const mateRows: Record<string, unknown>[] = Array.isArray(mates) ? mates.filter(isRow) : []
  await applyParentFieldsToRowProducts(mateRows, ['image_urls'])
  const productImages: string[] = []
  for (const m of mateRows) {
    const imgs = (m.products as { image_urls?: unknown } | null)?.image_urls
    const first = Array.isArray(imgs) ? imgs.find((u): u is string => typeof u === 'string' && u.length > 0) : undefined
    if (first && !productImages.includes(first)) productImages.push(first)
    if (productImages.length >= 5) break
  }

  const method: ReturnSubmitMethod | null = toReturnSubmitMethod(rental.return_method)
  const canSubmit = method !== null && RETURN_SUBMIT_STATUSES.has(rental.status)

  // 이미 제출했는지 — 제출 테이블은 RLS 정책이 없어 서버(서비스 롤)로만 읽는다. 사진 자체는 고객 화면에 내려보내지 않고 장수만 안내한다.
  let submittedAt: string | null = null
  let mediaCount = 0
  let checklistItems: { key: string; label: string }[] = RETURN_CHECKLIST_ITEMS
  let missionPoints: number | null = null
  let courierPhotoItems: { key: string; label: string }[] = RETURN_MEDIA_ITEMS.courier
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (serviceRoleKey) {
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    // 체크리스트 = CMS '검수 항목 등록'의 고객검수 ON 항목(조회 실패 시 기본 4종)
    checklistItems = customerChecklistOf((await loadReturnInspectionItems(admin)).active)
    courierPhotoItems = customerPhotoOf((await loadReturnPhotoItems(admin)).active)
    // 반납등록 미션 포인트(CMS 포인트 규칙 — 켜져 있고 0보다 클 때만 값, 아니면 null → 화면에서 포인트 문구 숨김)
    missionPoints = await loadReturnMissionPoints(admin)
    const { data: sub } = await admin
      .from('reservation_return_submissions')
      .select('id, submitted_at')
      .eq('reservation_id', reservationId)
      .maybeSingle()
    const s = sub as { id: number; submitted_at: string } | null
    if (s) {
      submittedAt = s.submitted_at
      const { count } = await admin
        .from('reservation_return_media')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', s.id)
      mediaCount = count ?? 0
    }
  }

  // 한 번 등록한 예약은 다시 들어올 수 없다(재등록 불가, 2026-10-22 Stephen 지시) — 목록으로 돌려보낸다
  if (submittedAt) throw redirect(303, '/account/rental')

  return { rental, method, canSubmit, submittedAt, mediaCount, checklistItems, courierPhotoItems, missionPoints, productImages }
}
