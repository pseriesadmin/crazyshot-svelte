import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasMenuAccess } from '$lib/constants/cmsMenus'
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
  foreign_doc_url: string | null
  foreign_doc_urls: string[] | null
  foreign_type: string[] | null
  foreign_stay_type: string | null
  foreign_verified_at: string | null
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
      selected, selectedCustomer: null as CustomerRow | null, tab,
    }
  }

  const rows = (data ?? []) as CustomerRow[]
  const totalCount = rows[0]?.total_count ?? 0
  const selectedCustomer = ((selectedResult.data as CustomerRow[] | null)?.[0]) ?? null

  return { customers: rows, totalCount, search, classifications, bl, page, selected, selectedCustomer, tab }
}

export const actions: Actions = {
  toggleBlacklist: async ({ request, locals }) => {
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

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })

    const { data, error } = await adminClient.rpc('soft_delete_customer', {
      p_user_id:    user_id,
      p_deleted_by: session.user.email ?? session.user.id,
    })

    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? error?.message ?? '삭제 실패' })
    return { ok: true, deleted: true }
  },
}
