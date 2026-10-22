import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { RETURN_EVIDENCE_BUCKET } from '$lib/server/returnSubmission'
import { RETURN_CHECKLIST_ITEMS, RETURN_MEDIA_ITEMS, mediaItemLabel } from '$lib/utils/returnNotice'

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
    .select('id, reservation_id, issue_types, detail, media, created_at, resolved_at, resolution_note, assigned_admin')
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
      media: (i.media ?? []).map((m) => ({ kind: m.kind, url: urlByPath.get(m.path) ?? null })),
    })),
  }
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

  const { data: sub, error: subErr } = await admin
    .from('reservation_return_submissions')
    .select('id, method, checklist, locker_number, locker_password, submitted_at')
    .eq('reservation_id', reservationId)
    .maybeSingle()
  if (subErr) return json({ error: subErr.message }, { status: 500 })
  if (!sub) return json({ submission: null, groups: [], inspection })

  const s = sub as {
    id: number
    method: string
    checklist: string[] | null
    locker_number: string | null
    locker_password: string | null
    submitted_at: string
  }

  const { data: media, error: mediaErr } = await admin
    .from('reservation_return_media')
    .select('id, item_key, storage_path, kind, sort_order')
    .eq('submission_id', s.id)
    .order('sort_order', { ascending: true })
  if (mediaErr) return json({ error: mediaErr.message }, { status: 500 })

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
  const method = s.method === 'courier' || s.method === 'quick' || s.method === 'locker' ? s.method : null
  const order = method ? RETURN_MEDIA_ITEMS[method].map((i) => i.key) : []
  const keys = [...new Set([...order, ...rows.map((r) => r.item_key)])].filter((k) => rows.some((r) => r.item_key === k))
  const groups = keys.map((k) => ({
    item_key: k,
    label: mediaItemLabel(k),
    items: rows
      .filter((r) => r.item_key === k)
      .map((r) => ({ id: r.id, kind: r.kind, url: urlByPath.get(r.storage_path) ?? null })),
  }))

  const checked = new Set(s.checklist ?? [])
  return json({
    submission: {
      method: s.method,
      submitted_at: s.submitted_at,
      checklist: method === 'courier'
        ? RETURN_CHECKLIST_ITEMS.map((i) => ({ key: i.key, label: i.label, checked: checked.has(i.key) }))
        : [],
      locker_number: s.locker_number,
      // 비밀번호는 기존 CMS 무인함 배정정보와 같이 manager 이상에게만 내려준다(partner는 마스킹 안내)
      locker_password: hasSettingsAccess(cmsRole) ? s.locker_password : null,
      locker_password_hidden: !hasSettingsAccess(cmsRole) && !!s.locker_password,
    },
    groups,
    inspection,
  })
}
