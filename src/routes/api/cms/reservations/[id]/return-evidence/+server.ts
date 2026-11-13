import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { RETURN_EVIDENCE_BUCKET } from '$lib/server/returnSubmission'
import { RETURN_MEDIA_ITEMS, mediaItemLabel } from '$lib/utils/returnNotice'
import { loadReturnInspectionItems, loadReturnPhotoItems } from '$lib/server/returnInspectionItems'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { listMissingReturnRecords } from '$lib/server/inspection'

// 고객 반납 제출 내용 조회(조회 전용) — RentalDetailPanel '검수' 탭이 사용(Migration #722, 2026-10-17).
// 사진·영상은 비공개 버킷(return-evidence)이라 클릭 시점에 만료가 짧은 서명 URL을 서버가 만들어 내려준다(공개 URL 없음).
// 무인함 비밀번호는 관리자 전용 정보다(고객 화면에는 내려가지 않는다).
const SIGNED_URL_TTL_SEC = 600

interface IssueRow {
  id: number
  reservation_id: number
  issue_types: string[]
  detail: string | null
  media: { path: string; kind: 'photo' | 'video' }[] | null
  created_at: string
  resolved_at: string | null
  resolution_note: string | null
  assigned_admin: string | null
  claim_kinds: string[] | null
  claim_amount: number | null
  claim_status: string | null
  claim_items: { kind: string; amount: number }[] | null
}

// 같은 주문(장바구니 1건)에 속한 예약 id 전체(자기 포함) — 주문이 없으면 자기 하나
async function orderReservationIds(admin: SupabaseClient, reservationId: number): Promise<number[]> {
  const { data: oiRow } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (oiRow as { order_id?: number | null } | null)?.order_id
  if (orderId == null) return [reservationId]
  const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
  const mapped = ((sibs ?? []) as { reservation_id: number | null }[]).map((x) => x.reservation_id).filter((v): v is number => v != null)
  return mapped.length > 0 ? mapped : [reservationId]
}

async function loadInspection(admin: SupabaseClient, reservationId: number) {
  const { data: rr, error: rrErr } = await admin
    .from('rental_reservations')
    .select('status, inspection_status, inspected_at, has_prior_issue')
    .eq('id', reservationId)
    .maybeSingle()
  if (rrErr || !rr) return null
  const r = rr as { status: string; inspection_status: string | null; inspected_at: string | null; has_prior_issue: boolean | null }

  // 같은 주문의 예약들의 이슈를 함께 보여준다(검수는 주문 단위로 처리됨)
  let ids: number[] = [reservationId]
  const { data: oiRow } = await admin.from('order_items').select('order_id').eq('reservation_id', reservationId).maybeSingle()
  const orderId = (oiRow as { order_id?: number | null } | null)?.order_id
  if (orderId != null) {
    const { data: sibs } = await admin.from('order_items').select('reservation_id').eq('order_id', orderId)
    const mapped = ((sibs ?? []) as { reservation_id: number | null }[]).map((x) => x.reservation_id).filter((v): v is number => v != null)
    if (mapped.length > 0) ids = mapped
  }

  const { data: issueRows } = await admin
    .from('reservation_inspection_issues')
    .select('id, reservation_id, issue_types, detail, media, created_at, resolved_at, resolution_note, assigned_admin, claim_kinds, claim_amount, claim_status, claim_items')
    .in('reservation_id', ids)
    .order('created_at', { ascending: false })
  const issues = (issueRows ?? []) as IssueRow[]

  // 고객 사전 접수 증빙(3단계, Migration #728) — 같은 주문 예약들의 제출 내용
  const { data: reportRows } = await admin
    .from('reservation_issue_reports')
    .select('id, status, issue_types, detail, media, submitted_at, expires_at, created_at')
    .in('reservation_id', ids)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
  const reports = (reportRows ?? []) as {
    id: number; status: string; issue_types: string[] | null; detail: string | null
    media: { path: string; kind: 'photo' | 'video' }[] | null
    submitted_at: string | null; expires_at: string; created_at: string
  }[]

  // 이슈 담당자(= 등록한 관리자) 이름 — 이슈에 기록된 담당자만 조회한다. 이름이 없으면 이메일
  const adminIds = [...new Set(issues.map((i) => i.assigned_admin).filter((v): v is string => !!v))]
  const staffName = new Map<string, string>()
  if (adminIds.length > 0) {
    const { data: staffRows } = await admin.from('user_profiles').select('id, full_name, email').in('id', adminIds)
    for (const u of (staffRows ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      staffName.set(u.id, u.full_name?.trim() || u.email || '이름 없음')
    }
  }

  const paths = [
    ...issues.flatMap((i) => (i.media ?? []).map((m) => m.path)),
    ...reports.flatMap((rp) => (rp.media ?? []).map((m) => m.path)),
  ]
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SEC)
    for (const e of signed ?? []) if (e.path && e.signedUrl) urlByPath.set(e.path, e.signedUrl)
  }

  return {
    reservation_status: r.status,
    status: r.inspection_status,
    inspected_at: r.inspected_at,
    has_prior_issue: !!r.has_prior_issue,
    prior_reports: reports.map((rp) => ({
      id: rp.id,
      status: rp.status,
      types: rp.issue_types ?? [],
      detail: rp.detail,
      submitted_at: rp.submitted_at,
      expires_at: rp.expires_at,
      media: (rp.media ?? []).map((m) => ({ kind: m.kind, url: urlByPath.get(m.path) ?? null })),
    })),
    issues: issues.map((i) => ({
      id: i.id,
      assignee_name: i.assigned_admin ? (staffName.get(i.assigned_admin) ?? null) : null,
      types: i.issue_types,
      detail: i.detail,
      created_at: i.created_at,
      resolved_at: i.resolved_at,
      resolution_note: i.resolution_note,
      claim_kinds: i.claim_kinds ?? null,
      claim_amount: i.claim_amount ?? null,
      claim_status: i.claim_status ?? null,
      claim_items: i.claim_items ?? null,
      media: (i.media ?? []).map((m) => ({ kind: m.kind, url: urlByPath.get(m.path) ?? null })),
    })),
  }
}

// 방문 반납 관리자 직접 등록 목록(Migration #737) — 등록한 관리자 이름과 서명 URL 을 붙여 내려준다.
// 테이블이 없는 환경(DB 미적용)·조회 오류는 빈 목록(fail-open)으로 둔다 — 고객 제출 조회를 막지 않는다.
async function loadAdminEntries(admin: SupabaseClient, reservationId: number, labelByKey: Map<string, string>) {
  const { data, error } = await admin
    .from('reservation_return_admin_entries')
    .select('id, registered_by, memo, checklist, media, created_at')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  const rows = data as { id: number; registered_by: string | null; memo: string | null; checklist: string[] | null; media: { path: string; kind: 'photo' | 'video' }[] | null; created_at: string }[]

  const ids = [...new Set(rows.map((x) => x.registered_by).filter((v): v is string => !!v))]
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const { data: staff } = await admin.from('user_profiles').select('id, full_name, email').in('id', ids)
    for (const u of (staff ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      names.set(u.id, u.full_name?.trim() || u.email || '이름 없음')
    }
  }
  const paths = rows.flatMap((x) => (x.media ?? []).map((m) => m.path))
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SEC)
    for (const e of signed ?? []) if (e.path && e.signedUrl) urlByPath.set(e.path, e.signedUrl)
  }
  return rows.map((x) => ({
    id: x.id,
    registered_by_name: x.registered_by ? (names.get(x.registered_by) ?? null) : null,
    memo: x.memo,
    checklist: (x.checklist ?? []).map((k) => labelByKey.get(k)).filter((l): l is string => !!l),
    created_at: x.created_at,
    media: (x.media ?? []).map((m) => ({ kind: m.kind, url: urlByPath.get(m.path) ?? null })),
  }))
}

// 고객 제출 체크리스트 표시 — 현재 활성 항목 + (삭제됐지만 고객이 체크했던 항목은 그 문구로) 이어 붙인다
function checklistRows(
  active: { key: string; label: string; customerVisible: boolean }[],
  checked: Set<string>,
  labelByKey: Map<string, string>,
) {
  const rows = active.filter((i) => i.customerVisible || checked.has(i.key)).map((i) => ({ key: i.key, label: i.label, checked: checked.has(i.key) }))
  const shown = new Set(rows.map((r) => r.key))
  for (const k of checked) if (!shown.has(k)) rows.push({ key: k, label: labelByKey.get(k) ?? k, checked: true })
  return rows
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: 'Unauthorized' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '잘못된 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 검수 상태·이슈 기록(2단계, Migration #724). 컬럼이 없는 환경(DB 미적용)에서는 null — 화면은 검수 액션을 숨긴다(fail-open).
  const inspection = await loadInspection(admin, reservationId)
  const { active: inspectionActive, labelByKey } = await loadReturnInspectionItems(admin)
  const photoMaster = await loadReturnPhotoItems(admin)
  const admin_entries = await loadAdminEntries(admin, reservationId, labelByKey)
  // 검수 탭 관리자 직접 등록 칩 — 고객검수 여부와 무관한 활성 항목 전체
  const inspection_items = inspectionActive.map((i) => ({ key: i.key, label: i.label, customerVisible: i.customerVisible }))

  // 한 예약의 고객 제출(제출 행 + 사진 묶음) 조회 — 고객 제출은 예약 1건마다 따로 저장된다(같은 주문의 상품이 여러 개면 상품별로 각각 제출).
  // 목록은 주문 1건 = 1행(대표 예약)이라 대표 예약만 읽으면 다른 상품의 제출이 CMS 에 보이지 않았다(2026-11-11) — 같은 주문의 예약 제출을 함께 내려준다.
  const canSeeLockerPassword = hasSettingsAccess(cmsRole)
  async function loadSubmission(rid: number): Promise<{ error: string } | { submission: unknown; groups: unknown[] } | null> {
    const { data: sub, error: subErr } = await admin
      .from('reservation_return_submissions')
      .select('id, method, checklist, locker_number, locker_password, customer_feedback, customer_rating, submitted_at')
      .eq('reservation_id', rid)
      .maybeSingle()
    if (subErr) return { error: subErr.message }
    if (!sub) return null

    const s = sub as {
      id: number
      method: string
      checklist: string[] | null
      locker_number: string | null
      locker_password: string | null
      customer_feedback: string | null
      customer_rating: number | null
      submitted_at: string
    }

    const { data: media, error: mediaErr } = await admin
      .from('reservation_return_media')
      .select('id, item_key, storage_path, kind, sort_order')
      .eq('submission_id', s.id)
      .order('sort_order', { ascending: true })
    if (mediaErr) return { error: mediaErr.message }

    const rows = (media ?? []) as { id: number; item_key: string; storage_path: string; kind: 'photo' | 'video'; sort_order: number }[]
    const urlByPath = new Map<string, string>()
    if (rows.length > 0) {
      const { data: signed } = await admin.storage
        .from(RETURN_EVIDENCE_BUCKET)
        .createSignedUrls(rows.map((r) => r.storage_path), SIGNED_URL_TTL_SEC)
      for (const entry of signed ?? []) {
        if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl)
      }
    }

    // 항목 순서 = 방식별 정의 순서(사진 항목별로 묶어 정렬), 정의에 없는 항목은 뒤에
    // s.method 는 저장된 제출 방식 값('courier'|'quick'|'locker') — 예약의 return_method(epost 등)를 변환하는 toReturnSubmitMethod 를 쓰면 항상 null 이 돼
    // 체크리스트가 비고 사진 순서가 정의 순서를 따르지 않는다(2026-10-19 실테스트 발견·수정)
    const method = s.method === 'courier' || s.method === 'quick' || s.method === 'locker' || s.method === 'visit' ? s.method : null
    const order = method ? (method === 'courier' ? photoMaster.active : RETURN_MEDIA_ITEMS[method]).map((i) => i.key) : []
    const keys = [...new Set([...order, ...rows.map((r) => r.item_key)])].filter((k) => rows.some((r) => r.item_key === k))
    const groups = keys.map((k) => ({
      item_key: k,
      label: photoMaster.labelByKey.get(k) ?? mediaItemLabel(k),
      items: rows
        .filter((r) => r.item_key === k)
        .map((r) => ({ id: r.id, kind: r.kind, url: urlByPath.get(r.storage_path) ?? null })),
    }))

    const checked = new Set(s.checklist ?? [])
    return {
      submission: {
        method: s.method,
        submitted_at: s.submitted_at,
        checklist: method === 'courier'
          ? checklistRows(inspectionActive, checked, labelByKey)
          : [],
        locker_number: s.locker_number,
        // 비밀번호는 기존 CMS 무인함 배정정보와 같이 manager 이상에게만 내려준다(partner는 마스킹 안내)
        locker_password: canSeeLockerPassword ? s.locker_password : null,
        locker_password_hidden: !canSeeLockerPassword && !!s.locker_password,
        // 고객 이용 평가(반납등록 미션 3단계, 100자·선택) — 읽기 전용 표시(Migration #739)
        customer_feedback: s.customer_feedback,
        customer_rating: s.customer_rating,
      },
      groups,
    }
  }

  const own = await loadSubmission(reservationId)
  if (own && 'error' in own) return json({ error: own.error }, { status: 500 })

  // 같은 주문의 다른 상품(예약)의 고객 제출 — 상품 이름과 함께(제출한 상품만)
  const siblingIds = (await orderReservationIds(admin, reservationId)).filter((id) => id !== reservationId)
  const sibling_submissions: { reservation_id: number; product_name: string | null; product_code: string | null; submission: unknown; groups: unknown[] }[] = []
  if (siblingIds.length > 0) {
    const nameById = new Map<number, string | null>()
    const codeById = new Map<number, string | null>() // 품번 = 예약에 배정된 재고(자식)의 품번 — 상품 이름은 부모 값(applyParentFieldsToRowProducts)
    const { data: nameRows } = await admin
      .from('rental_reservations')
      .select('id, product_id, products!rental_reservations_product_id_fkey(name, product_code, parent_product_id)')
      .in('id', siblingIds)
    const nr = Array.isArray(nameRows) ? nameRows : []
    await applyParentFieldsToRowProducts(nr, ['name'])
    for (const r of nr as { id: number; products?: { name?: string | null; product_code?: string | null } | { name?: string | null; product_code?: string | null }[] | null }[]) {
      const prod = Array.isArray(r.products) ? r.products[0] : r.products
      nameById.set(r.id, prod?.name ?? null)
      codeById.set(r.id, prod?.product_code ?? null)
    }
    for (const sid of siblingIds) {
      const sib = await loadSubmission(sid)
      if (!sib) continue
      // 다른 상품 제출 조회 실패는 건너뛴다(fail-soft) — 대표 예약 제출·검수 정보까지 500 으로 막지 않는다(sp3 MINOR-3)
      if ('error' in sib) { console.error('[return-evidence] 같은 주문 다른 상품 제출 조회 실패:', sid, sib.error); continue }
      sibling_submissions.push({ reservation_id: sid, product_name: nameById.get(sid) ?? null, product_code: codeById.get(sid) ?? null, ...sib })
    }
  }

  // 상품별 반납 기록 현황(2026-11-12, Stephen 지시 — 모든 상품이 고객 제출 또는 관리자 대리 등록을 가져야 검수 승인) — 같은 주문의 대여중·반납요청·반납완료 상품
  const order_units: { reservation_id: number; product_name: string | null; status: string; has_record: boolean; exempt: boolean }[] = []
  const unitIds = await orderReservationIds(admin, reservationId)
  const { data: unitRows } = await admin
    .from('rental_reservations')
    .select('id, status, return_record_exempt, product_id, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .in('id', unitIds)
    .in('status', ['in_use', 'return_requested', 'returned'])
  const unitList = Array.isArray(unitRows) ? unitRows : []
  await applyParentFieldsToRowProducts(unitList, ['name'])
  // 조회에 실패하면(null) 상품별 현황을 알 수 없으므로 목록을 비운다 — 모든 상품이 '등록됨'으로 잘못 보이지 않게(승인은 별도로 막힌다)
  const missingList = await listMissingReturnRecords(admin, reservationId)
  const missingIds = new Set(missingList ?? [])
  for (const r of (missingList === null ? [] : unitList) as { id: number; status: string; return_record_exempt?: boolean | null; products?: { name?: string | null } | { name?: string | null }[] | null }[]) {
    const prod = Array.isArray(r.products) ? r.products[0] : r.products
    order_units.push({ reservation_id: r.id, product_name: prod?.name ?? null, status: r.status, has_record: !missingIds.has(r.id), exempt: !!r.return_record_exempt })
  }
  order_units.sort((a, b) => a.reservation_id - b.reservation_id)

  return json({
    submission: own?.submission ?? null,
    groups: own?.groups ?? [],
    order_units,
    sibling_submissions,
    inspection,
    admin_entries,
    inspection_items,
  })
}
