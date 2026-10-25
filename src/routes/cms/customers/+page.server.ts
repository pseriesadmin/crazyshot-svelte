import { fail, redirect } from '@sveltejs/kit'
import { describeDeletionBlockers } from '$lib/utils/accountDeletion'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasMenuAccess } from '$lib/constants/cmsMenus'
import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'
import type { Actions, PageServerLoad } from './$types'

export interface CustomerRow {
  user_id: string
  email: string
  phone: string | null
  name: string | null
  member_code: string | null
  member_type: string | null
  membership_grade: string
  credit_score: number
  rental_count: number
  late_return_count: number
  damage_count: number
  points: number
  blacklisted: boolean
  blacklist_reason: string | null
  is_student: boolean
  is_foreign: boolean
  identity_type: string[] | null
  identity_doc_url: string[] | null
  identity_verified_at: string | null
  identity_approved_at: string | null
  foreign_doc_url: string | null
  foreign_doc_urls: string[] | null
  foreign_type: string[] | null
  foreign_stay_type: string | null
  foreign_verified_at: string | null
  foreign_approved_at: string | null
  password_set: boolean
  created_at: string
  total_count: number
  cms_role: string | null
  birth_date: string | null
  withdrawal_status: string
  withdrawal_requested_at: string | null
  withdrawal_purge_at: string | null
  legacy_imported_at: string | null
  legacy_claimed_at: string | null
  legacy_source: string | null
  legacy_signup_at: string | null
  legacy_purchase_count: number | null
  /** 회원 가입 이력 없는 관리대상(managed_persons) 행 여부 — Migration #686 */
  is_managed_person: boolean
  /** 사전 등록 관리대상과 가입 정보가 일치한 회원의 대조 결과 — Migration #708(없으면 null) */
  managed_match?: ManagedMatch | null
}

export interface ManagedMatch {
  status: 'pending' | 'confirmed' | 'dismissed'
  basis: 'phone' | 'email'
  matched_at: string
  person_name: string | null
  person_phone: string | null
  person_reason: string | null
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole, menuPermissionOverrides } = await parent()
  // 고객목록(customers.list) 열람은 파트너도 계정별 권한설정으로 허용될 수 있다 —
  // hasSettingsAccess(manager+) 단독 판정 대신 hasMenuAccess(role+오버라이드)로 통일해
  // +layout.server.ts의 GNB/라우트 가드와 동일 기준을 유지한다. 블랙리스트·회원정보수정·
  // 점수조정·포인트지급·삭제 등 나머지 액션은 여전히 아래 actions에서 hasSettingsAccess로
  // 별도 보호된다(파트너는 목록 열람만 가능, 편집·삭제는 그대로 차단).
  if (!hasMenuAccess(cmsRole ?? '', menuPermissionOverrides, 'customers.list')) {
    throw redirect(303, '/cms?notice=access_denied')
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return {
      customers: [] as CustomerRow[], totalCount: 0, search: '', classifications: [] as string[], bl: null, page: 1,
      selected: null as string | null, selectedCustomer: null as CustomerRow | null, tab: null as string | null,
      managedMatchPending: 0,
    }
  }

  const search   = url.searchParams.get('search') ?? ''
  // 인증분류(일반/학생/구독) 다중선택 필터 — 콤마 구분(예: ?classification=student,subscriber)
  // (2026-09-01 재구성 — membership_grade는 고객등급이 아니라 구독상품 티어였음, Stephen 확인)
  const classifications = (url.searchParams.get('classification') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const bl       = url.searchParams.get('bl')         // 'true' | 'false' | null
  const page     = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const selected = url.searchParams.get('selected')   // 딥링크 대상 user_id — /cms/subscriptions 구독자현황 탭에서 연결
  const tab      = url.searchParams.get('tab')        // 딥링크 시 열어둘 탭(예: 'subscription')

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const [{ data, error }, selectedResult] = await Promise.all([
    admin.rpc('get_customer_list', {
      p_search:           search || null,
      p_blacklisted:      bl === 'true' ? true : bl === 'false' ? false : null,
      p_page:             page,
      p_limit:            30,
      p_classifications:  classifications.length > 0 ? classifications : null,
    }),
    // 딥링크 대상이 현재 페이지/필터 밖에 있을 수 있으므로 검색·페이지네이션과 무관하게 별도 조회
    selected
      ? admin.rpc('get_customer_list', { p_page: 1, p_limit: 1, p_user_id: selected })
      : Promise.resolve({ data: null, error: null }),
  ])

  if (error) {
    console.error('[customers/load] get_customer_list error:', error)
    return {
      customers: [] as CustomerRow[], totalCount: 0, search, classifications, bl, page,
      selected, selectedCustomer: null as CustomerRow | null, tab, managedMatchPending: 0,
    }
  }

  const rows = (data ?? []) as CustomerRow[]
  const totalCount = rows[0]?.total_count ?? 0
  const selectedCustomer = ((selectedResult.data as CustomerRow[] | null)?.[0]) ?? null

  // 사전 등록 관리대상과의 가입 정보 일치 표시(Migration #708) — 조회 실패해도 목록은 그대로 보여준다(fail-soft)
  let managedMatchPending = 0
  try {
    const ids = [...rows.map((r) => r.user_id), ...(selectedCustomer ? [selectedCustomer.user_id] : [])]
    const [flagsRes, countRes] = await Promise.all([
      ids.length > 0 ? admin.rpc('cms_get_managed_match_flags', { p_user_ids: ids }) : Promise.resolve({ data: [], error: null }),
      admin.rpc('cms_managed_match_pending_count'),
    ])
    const flagMap = new Map<string, ManagedMatch>()
    for (const f of (flagsRes.data ?? []) as Array<ManagedMatch & { user_id: string }>) {
      flagMap.set(f.user_id, {
        status: f.status, basis: f.basis, matched_at: f.matched_at,
        person_name: f.person_name, person_phone: f.person_phone, person_reason: f.person_reason,
      })
    }
    for (const r of rows) r.managed_match = flagMap.get(r.user_id) ?? null
    if (selectedCustomer) selectedCustomer.managed_match = flagMap.get(selectedCustomer.user_id) ?? null
    managedMatchPending = typeof countRes.data === 'number' ? countRes.data : 0
  } catch (e) {
    console.error('[customers/load] managed match flags error:', e)
  }

  return { customers: rows, totalCount, search, classifications, bl, page, selected, selectedCustomer, tab, managedMatchPending }
}

export const actions: Actions = {
  toggleBlacklist: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { ok: false, error: '서버 설정 오류' })

    const admin = createClient(getSupabaseUrl(), serviceRoleKey)

    const form = await request.formData()
    const user_id     = String(form.get('user_id') ?? '')
    const blacklisted = form.get('blacklisted') === 'true'
    const reason      = String(form.get('reason') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })
    if (blacklisted && !reason) return fail(400, { ok: false, error: '블랙리스트 등록 시 사유 필수' })

    const { data, error } = await admin.rpc('toggle_blacklist', {
      p_user_id:     user_id,
      p_blacklisted: blacklisted,
      p_reason:      reason,
    })

    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '처리 실패' })
    return { ok: true }
  },

  cancelSubscription: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKeyCheck = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKeyCheck) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminCheck = createClient(getSupabaseUrl(), serviceRoleKeyCheck)

    const form = await request.formData()
    const subscription_id = String(form.get('subscription_id') ?? '')
    const status          = String(form.get('status') ?? '')
    const reason          = String(form.get('reason') ?? '').trim()

    if (!subscription_id) return fail(400, { ok: false, error: '구독 ID 필수' })
    if (!['cancelled', 'paused'].includes(status)) return fail(400, { ok: false, error: '유효하지 않은 상태값' })
    if (!reason) return fail(400, { ok: false, error: '사유 필수' })
    const { data, error } = await adminCheck.rpc('admin_update_subscription_status', {
      p_subscription_id: subscription_id,
      p_status:          status,
      p_reason:          reason,
    })

    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '처리 실패' })
    return { ok: true }
  },

  updateCustomerInfo: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKeyUpd = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKeyUpd) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminUpd = createClient(getSupabaseUrl(), serviceRoleKeyUpd)

    const form = await request.formData()
    const user_id     = String(form.get('user_id') ?? '').trim()
    const name        = String(form.get('name') ?? '').trim()
    const email       = String(form.get('email') ?? '').trim()
    const phone       = String(form.get('phone') ?? '').trim()
    const member_type = String(form.get('member_type') ?? '').trim()
    const created_at  = String(form.get('created_at') ?? '').trim()
    const birth_date  = String(form.get('birth_date') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })
    if (!name)    return fail(400, { ok: false, error: '이름 필수' })
    if (!email)   return fail(400, { ok: false, error: '이메일 필수' })

    const createdAtTs = created_at ? new Date(created_at).toISOString() : null

    const { data, error } = await adminUpd.rpc('update_customer_info', {
      p_user_id:     user_id,
      p_name:        name    || null,
      p_email:       email   || null,
      p_phone:       phone   || null,
      p_member_type: member_type || null,
      p_created_at:  createdAtTs,
      p_birth_date:  birth_date || null,
    })

    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '수정 실패' })
    return { ok: true }
  },

  adjustScore: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKeyAdj = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKeyAdj) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminAdj = createClient(getSupabaseUrl(), serviceRoleKeyAdj)

    const form = await request.formData()
    const user_id = String(form.get('user_id') ?? '')
    const delta   = Number(form.get('delta') ?? 0)
    const reason  = String(form.get('reason') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })
    if (delta === 0) return fail(400, { ok: false, error: '조정값은 0이 될 수 없습니다' })
    if (!reason) return fail(400, { ok: false, error: '조정 사유 필수' })

    const { data, error } = await adminAdj.rpc('adjust_credit_score', {
      p_user_id: user_id,
      p_delta:   delta,
      p_reason:  reason,
    })

    const result = data as { ok: boolean; old_score?: number; new_score?: number; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '조정 실패' })
    return { ok: true, old_score: result.old_score, new_score: result.new_score }
  },

  // 포인트이력 탭 "포인트 추가" — 기존 admin_grant_points RPC 재사용(/cms/promotion/point
  // 화면의 grantPoints 액션과 동일 RPC, 신규 로직 없음). p_user_id는 admin_grant_points가
  // user_profiles.id로 직접 매칭하므로 변환 없이 그대로 전달(읽기 경로의 rentals/points
  // +server.ts와 달리 쓰기 경로는 ID 변환이 필요 없음 — 혼동 주의).
  // ⚠️ 이 RPC는 내부에서 auth.uid()로 is_cms_user() 검사 + admin_id 기록을 하므로
  // locals.supabase(사용자 세션 유지)를 그대로 써야 함 — service_role 관리자 클라이언트로
  // 호출하면 auth.uid()가 NULL이 되어 ACCESS_DENIED가 남(promotion/point의 grantPoints
  // 액션과 동일하게 locals.supabase 사용, 이 파일의 adjustScore/deleteCustomer가 쓰는
  // service_role 패턴과는 다름 — RPC마다 내부 인가방식이 다르니 혼동 금지).
  grantCustomerPoints: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!hasSettingsAccess(cmsRole ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const form = await request.formData()
    const user_id = String(form.get('user_id') ?? '').trim()
    // 금액 입력폼 표준(콤마 포함 문자열로 전송됨) — 서버에서 숫자만 추출
    const amount = Number(String(form.get('amount') ?? '').replace(/[^0-9]/g, ''))
    const description = String(form.get('description') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })
    if (!amount || amount <= 0) return fail(400, { ok: false, error: '0보다 큰 금액을 입력하세요.' })
    if (!description) return fail(400, { ok: false, error: '사유(출처) 입력 필수' })

    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('admin_grant_points', {
      p_user_id: user_id,
      p_amount: amount,
      p_type: 'admin_grant',
      p_description: description,
    })

    const result = data as { ok: boolean; error?: string; new_balance?: number } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '등록 실패' })
    return { ok: true, new_balance: result.new_balance }
  },

  deleteCustomer: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })

    // manager / superadmin 전용
    const role = (await getCmsRoleForAction(locals)) ?? ''
    if (!['manager', 'superadmin'].includes(role)) return fail(403, { ok: false, error: '삭제 권한이 없습니다.' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminClient = createClient(getSupabaseUrl(), serviceRoleKey)

    const form = await request.formData()
    const user_id = String(form.get('user_id') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })

    // 2026-10-24: 즉시 삭제(soft_delete_customer) 폐기 — 본인 탈퇴와 같은 흐름(공통 차단 조건 → 30일 유예 → 익명 전환).
    // 관리대상 지정·거래 기록은 그대로 유지되고, 유예 중에는 관리자가 [삭제 취소]로 복구할 수 있다.
    const { data, error } = await adminClient.rpc('cms_request_account_deletion', {
      p_user_id:  user_id,
      p_admin_id: session.user.id,
      p_reason:   reason || null,
    })

    const result = data as { ok: boolean; error?: string; error_code?: string; blockers?: string[]; purge_at?: string } | null
    if (!result?.ok) {
      const detail = result?.error_code === 'not_deletable' ? ` (${describeDeletionBlockers(result.blockers)})` : ''
      return fail(400, { ok: false, error: `${result?.error ?? error?.message ?? '삭제 요청 실패'}${detail}`, blockers: result?.blockers ?? [] })
    }
    return { ok: true, deleted: true, purge_at: result.purge_at }
  },

  // 삭제 유예 중인 고객의 삭제 요청 취소(복구) — 본인 탈퇴 건·관리자 삭제 건 모두 manager 이상이 복구할 수 있다
  restoreCustomerDeletion: async ({ request, locals }) => {
    const denied = await requireMenuAccessAction(locals, 'customers.list')
    if (denied) return denied
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })
    const role = (await getCmsRoleForAction(locals)) ?? ''
    if (!['manager', 'superadmin'].includes(role)) return fail(403, { ok: false, error: '복구 권한이 없습니다.' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminClient = createClient(getSupabaseUrl(), serviceRoleKey)

    const form = await request.formData()
    const user_id = String(form.get('user_id') ?? '').trim()
    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })

    const { data, error } = await adminClient.rpc('cms_restore_account_deletion', { p_user_id: user_id, p_admin_id: session.user.id })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '복구 실패' })
    return { ok: true, restored: true }
  },

  // ── 사전 등록 관리대상과 일치한 가입자 확인 — Migration #708 ───────────────────────────────────
  // decision=confirm: 기존 블랙리스트(관리대상) 지정 경로(toggle_blacklist)로 확정 후 일치 기록을 '확정'으로 닫는다.
  // decision=dismiss: 해당 없음 — 일치 기록만 닫고 계정은 그대로(관리대상 필터에서 빠짐).
  reviewManagedMatch: async ({ request, locals }) => {
    const guard = await guardManagedPersonAction(locals)
    if ('failure' in guard) return guard.failure
    const form = await request.formData()
    const userId   = String(form.get('user_id') ?? '').trim()
    const decision = String(form.get('decision') ?? '').trim()
    if (!userId) return fail(400, { ok: false, error: '대상 ID 필수' })
    if (decision !== 'confirm' && decision !== 'dismiss') return fail(400, { ok: false, error: '처리 구분이 올바르지 않습니다.' })

    if (decision === 'confirm') {
      const { data: flags, error: flagsErr } = await guard.admin.rpc('cms_get_managed_match_flags', { p_user_ids: [userId] })
      if (flagsErr) {
        console.error('[customers/reviewManagedMatch] flags error:', flagsErr.message)
        return fail(500, { ok: false, error: `일치 기록 조회에 실패했습니다: ${flagsErr.message}` })
      }
      const flag = ((flags ?? []) as Array<{ status: string; person_name: string | null; person_reason: string | null }>)[0]
      if (!flag || flag.status !== 'pending') return fail(400, { ok: false, error: '이미 처리됐거나 일치 기록이 없습니다.' })
      const reason = `사전 등록 관리대상 일치${flag.person_name ? `(${flag.person_name})` : ''}${flag.person_reason ? `: ${flag.person_reason}` : ''}`.slice(0, 500)
      const { data: tb, error: tbErr } = await guard.admin.rpc('toggle_blacklist', { p_user_id: userId, p_blacklisted: true, p_reason: reason })
      const tbRes = tb as { ok: boolean; error?: string } | null
      if (!tbRes?.ok) return fail(400, { ok: false, error: tbRes?.error ?? tbErr?.message ?? '관리대상 지정에 실패했습니다.' })
    }

    const { data, error } = await guard.admin.rpc('cms_review_managed_match', {
      p_user_id: userId,
      p_decision: decision === 'confirm' ? 'confirmed' : 'dismissed',
      p_reviewer: guard.userId,
    })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error === 'not_pending' ? '이미 처리된 건입니다.' : (error?.message ?? '처리에 실패했습니다.') })
    return { ok: true, matchReviewed: decision }
  },

  // ── 관리대상(회원 가입 이력 없는 인물) 등록·수정·삭제 — Migration #686 ──────────────────────────
  // 권한: 고객목록 메뉴 + manager 이상(블랙리스트 등록과 같은 등급). RPC는 service_role 전용.
  registerManagedPerson: async ({ request, locals }) => {
    const guard = await guardManagedPersonAction(locals)
    if ('failure' in guard) return guard.failure
    const input = await readManagedPersonForm(request)
    const { data, error } = await guard.admin.rpc('cms_register_managed_person', {
      p_name:       input.name,
      p_phone:      input.phone,
      p_email:      input.email,
      p_birth_date: input.birthDate,
      p_reason:     input.reason,
      p_created_by: guard.userId,
    })
    const result = data as { ok: boolean; id?: string; member_code?: string; error?: string; existing_id?: string } | null
    if (!result?.ok) {
      return fail(400, { ok: false, error: managedPersonErrorMessage(result?.error) ?? error?.message ?? '등록에 실패했습니다.', existingId: result?.existing_id ?? null })
    }
    await rescanManagedMatches(guard.admin)
    return { ok: true, registered: true, id: result.id, member_code: result.member_code }
  },

  updateManagedPerson: async ({ request, locals }) => {
    const guard = await guardManagedPersonAction(locals)
    if ('failure' in guard) return guard.failure
    const input = await readManagedPersonForm(request)
    if (!input.id) return fail(400, { ok: false, error: '대상 ID 필수' })
    const { data, error } = await guard.admin.rpc('cms_update_managed_person', {
      p_id:         input.id,
      p_name:       input.name,
      p_phone:      input.phone,
      p_email:      input.email,
      p_birth_date: input.birthDate,
      p_reason:     input.reason,
    })
    const result = data as { ok: boolean; error?: string; existing_id?: string } | null
    if (!result?.ok) {
      return fail(400, { ok: false, error: managedPersonErrorMessage(result?.error) ?? error?.message ?? '저장에 실패했습니다.', existingId: result?.existing_id ?? null })
    }
    await rescanManagedMatches(guard.admin)
    return { ok: true, updated: true }
  },

  deleteManagedPerson: async ({ request, locals }) => {
    const guard = await guardManagedPersonAction(locals)
    if ('failure' in guard) return guard.failure
    const form = await request.formData()
    const id = String(form.get('id') ?? '').trim()
    if (!id) return fail(400, { ok: false, error: '대상 ID 필수' })
    const { data, error } = await guard.admin.rpc('cms_delete_managed_person', {
      p_id:         id,
      p_deleted_by: guard.userId,
    })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: managedPersonErrorMessage(result?.error) ?? error?.message ?? '삭제에 실패했습니다.' })
    return { ok: true, deleted: true }
  },
}

// ── 관리대상 액션 공통 ────────────────────────────────────────────────────────
const MANAGED_PERSON_ERRORS: Record<string, string> = {
  name_required:   '이름을 입력하세요.',
  name_too_long:   '이름은 100자 이내로 입력하세요.',
  phone_invalid:   '전화번호 형식이 올바르지 않습니다.',
  reason_required: '관리대상 등록 사유를 입력하세요.',
  reason_too_long: '사유는 1000자 이내로 입력하세요.',
  email_invalid:   '이메일 형식이 올바르지 않습니다.',
  duplicate_phone: '이미 관리대상으로 등록된 전화번호입니다.',
  not_found:       '대상을 찾을 수 없습니다.',
}

function managedPersonErrorMessage(code: string | undefined): string | null {
  return code ? (MANAGED_PERSON_ERRORS[code] ?? null) : null
}

async function guardManagedPersonAction(locals: App.Locals) {
  const denied = await requireMenuAccessAction(locals, 'customers.list')
  if (denied) return { failure: denied }
  const { session } = await locals.safeGetSession()
  if (!session) return { failure: fail(403, { ok: false, error: '권한 없음' }) }
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return { failure: fail(403, { ok: false, error: '권한 없음' }) }
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { failure: fail(500, { ok: false, error: '서버 설정 오류' }) }
  return { admin: createClient(getSupabaseUrl(), serviceRoleKey), userId: session.user.id }
}

/** 관리대상 등록·수정 직후 이미 가입한 동일 번호·이메일 회원을 다시 대조한다(Migration #709). 실패해도 등록·수정 결과에는 영향 없음. */
async function rescanManagedMatches(admin: { rpc: (fn: string) => PromiseLike<{ error: { message: string } | null }> }) {
  try {
    const { error } = await admin.rpc('cms_rescan_managed_matches')
    if (error) console.error('[customers] rescan managed matches error:', error.message)
  } catch (e) {
    console.error('[customers] rescan managed matches failed:', e)
  }
}

async function readManagedPersonForm(request: Request) {
  const form = await request.formData()
  const birth = String(form.get('birth_date') ?? '').trim()
  return {
    id:        String(form.get('id') ?? '').trim(),
    name:      String(form.get('name') ?? '').trim(),
    phone:     String(form.get('phone') ?? '').trim(),
    email:     String(form.get('email') ?? '').trim() || null,
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null,
    reason:    String(form.get('reason') ?? '').trim(),
  }
}
