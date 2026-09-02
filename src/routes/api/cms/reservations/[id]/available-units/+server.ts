/**
 * GET /api/cms/reservations/[id]/available-units
 *
 * 현재 예약에 배정된 유닛(자식 상품)과 동일 부모를 공유하는 형제 유닛 중
 * 이 예약의 날짜 구간에 비어있는 유닛 목록을 반환한다.
 *
 * 목적: "상품코드(실물 재고단위) 재배정" UI의 선택지 공급 (Stage 4, 확장 기능)
 *
 * 응답: { units: [{ id: string, product_code: string | null }] }
 *   - 현재 배정된 유닛 자신은 제외
 *   - 빈 배열이면 UI가 "재고 없음" 표시 — 별도 에러 처리 없음
 *
 * 가용성 판정 기준 (products.md §5 와 동일):
 *   - is_active = true
 *   - deleted_at IS NULL
 *   - 이 예약의 start_date~end_date 구간과 겹치는 활성 예약 없음
 *     (활성 = status NOT IN ('cancelled','returned','completed','expired'))
 *
 * 이 엔드포인트는 읽기 전용 SELECT만 사용한다 — H-01 "직접 DML 금지" 원칙의
 * INSERT/UPDATE/DELETE에만 해당하며 SELECT는 RPC 경유 의무 없음(core-rules.md).
 *
 * - manager 이상 전용 (getCmsRoleForAction + hasSettingsAccess)
 * - service_role admin 클라이언트 사용 (관리자가 어느 예약이든 조회 가능해야 함)
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ params, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 1. 현재 예약에서 배정된 유닛(자식) product_id + 날짜 조회
  const { data: reservation, error: resErr } = await admin
    .from('rental_reservations')
    .select('product_id, start_date, end_date')
    .eq('id', reservationId)
    .maybeSingle()

  if (resErr) return json({ error: resErr.message }, { status: 500 })
  if (!reservation) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const { product_id: currentUnitId, start_date: startDate, end_date: endDate } = reservation as {
    product_id: string
    start_date: string
    end_date: string
  }

  // 2. 현재 유닛의 parent_product_id 조회
  const { data: currentUnit, error: unitErr } = await admin
    .from('products')
    .select('parent_product_id')
    .eq('id', currentUnitId)
    .maybeSingle()

  if (unitErr) return json({ error: unitErr.message }, { status: 500 })
  if (!currentUnit) return json({ error: '상품 정보를 찾을 수 없습니다.' }, { status: 404 })

  const { parent_product_id: parentProductId } = currentUnit as { parent_product_id: string | null }
  // 부모가 없으면(부모 상품이 직접 배정된 이상 상태) 가용 재고 없음
  if (!parentProductId) return json({ units: [] })

  // 3. 같은 부모의 형제 유닛 중 활성 + 삭제되지 않은 것 조회 (현재 유닛 제외)
  const { data: siblings, error: sibErr } = await admin
    .from('products')
    .select('id, product_code')
    .eq('parent_product_id', parentProductId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .neq('id', currentUnitId)

  if (sibErr) return json({ error: sibErr.message }, { status: 500 })
  if (!siblings || siblings.length === 0) return json({ units: [] })

  type Sibling = { id: string; product_code: string | null }
  const siblingsList = siblings as Sibling[]
  const siblingIds = siblingsList.map(s => s.id)

  // 4. 이 예약의 날짜 구간과 겹치는 활성 예약이 있는 유닛을 제외
  // 겹침 조건: RPC(cms_reassign_reservation_product_code)의 daterange(...,'[]') && 판정과 동일하게
  // 양끝 포함 겹침(sibling.start_date <= endDate AND sibling.end_date >= startDate)을 써야 한다 —
  // 배타적 비교(</>)를 쓰면 경계일(예: 기존 예약 종료일 = 신규 예약 시작일)에 겹치는 유닛을
  // "가용"으로 잘못 표시했다가 실제 재배정 시 RPC가 거부하는 UX 불일치가 생김.
  // 활성 = status NOT IN ('cancelled','returned','completed','expired')
  const { data: busyRows, error: busyErr } = await admin
    .from('rental_reservations')
    .select('product_id')
    .in('product_id', siblingIds)
    .in('status', ['hold', 'pending', 'confirmed', 'shipped', 'in_use', 'return_requested', 'damage_claimed'])
    .lte('start_date', endDate)
    .gte('end_date', startDate)

  if (busyErr) return json({ error: busyErr.message }, { status: 500 })

  const busyIds = new Set((busyRows ?? []).map(r => (r as { product_id: string }).product_id))

  const availableUnits = siblingsList
    .filter(s => !busyIds.has(s.id))
    .map(s => ({ id: s.id, product_code: s.product_code }))

  return json({ units: availableUnits })
}
