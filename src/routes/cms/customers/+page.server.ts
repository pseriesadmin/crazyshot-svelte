import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { Actions, PageServerLoad } from './$types'

export interface CustomerRow {
  user_id: string
  email: string
  phone: string | null
  name: string | null
  member_code: string | null
  member_type: string | null
  membership_grade: 'none' | 'easy' | 'pop' | 'crazy' | 'admin'
  credit_score: number
  rental_count: number
  late_return_count: number
  damage_count: number
  points: number
  blacklisted: boolean
  blacklist_reason: string | null
  is_student: boolean
  is_foreign: boolean
  created_at: string
  total_count: number
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { customers: [] as CustomerRow[], totalCount: 0, search: '', grade: '', bl: null, page: 1 }

  const search = url.searchParams.get('search') ?? ''
  const grade  = url.searchParams.get('grade')  ?? ''
  const bl     = url.searchParams.get('bl')         // 'true' | 'false' | null
  const page   = Math.max(1, Number(url.searchParams.get('page') ?? '1'))

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin.rpc('get_customer_list', {
    p_search:           search || null,
    p_membership_grade: grade  || null,
    p_blacklisted:      bl === 'true' ? true : bl === 'false' ? false : null,
    p_page:             page,
    p_limit:            50,
  })

  if (error) {
    console.error('[customers/load] get_customer_list error:', error)
    return { customers: [] as CustomerRow[], totalCount: 0, search, grade, bl, page }
  }

  const rows = (data ?? []) as CustomerRow[]
  const totalCount = rows[0]?.total_count ?? 0

  return { customers: rows, totalCount, search, grade, bl, page }
}

export const actions: Actions = {
  toggleBlacklist: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { ok: false, error: '서버 설정 오류' })

    // cms_role 확인
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    const { data: profile } = await admin
      .from('user_profiles')
      .select('cms_role')
      .eq('user_id', session.user.id)
      .single()
    if (!hasSettingsAccess(profile?.cms_role ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const form = await request.formData()
    const user_id     = String(form.get('user_id') ?? '')
    const blacklisted = form.get('blacklisted') === 'true'
    const reason      = String(form.get('reason') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })
    if (blacklisted && !reason) return fail(400, { ok: false, error: '블랙리스트 등록 시 사유 필수' })

    const { data } = await admin.rpc('toggle_blacklist', {
      p_user_id:     user_id,
      p_blacklisted: blacklisted,
      p_reason:      reason,
    })

    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '처리 실패' })
    return { ok: true }
  },

  cancelSubscription: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKeyCheck = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKeyCheck) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminCheck = createClient(getSupabaseUrl(), serviceRoleKeyCheck)
    const { data: profileCheck } = await adminCheck.from('user_profiles').select('cms_role').eq('user_id', session.user.id).single()
    if (!hasSettingsAccess(profileCheck?.cms_role ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const form = await request.formData()
    const subscription_id = String(form.get('subscription_id') ?? '')
    const status          = String(form.get('status') ?? '')
    const reason          = String(form.get('reason') ?? '').trim()

    if (!subscription_id) return fail(400, { ok: false, error: '구독 ID 필수' })
    if (!['cancelled', 'paused'].includes(status)) return fail(400, { ok: false, error: '유효하지 않은 상태값' })
    if (!reason) return fail(400, { ok: false, error: '사유 필수' })
    const { data } = await adminCheck.rpc('admin_update_subscription_status', {
      p_subscription_id: subscription_id,
      p_status:          status,
      p_reason:          reason,
    })

    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '처리 실패' })
    return { ok: true }
  },

  adjustScore: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(403, { ok: false, error: '권한 없음' })

    const serviceRoleKeyAdj = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKeyAdj) return fail(500, { ok: false, error: '서버 설정 오류' })
    const adminAdj = createClient(getSupabaseUrl(), serviceRoleKeyAdj)
    const { data: profileAdj } = await adminAdj.from('user_profiles').select('cms_role').eq('user_id', session.user.id).single()
    if (!hasSettingsAccess(profileAdj?.cms_role ?? '')) return fail(403, { ok: false, error: '권한 없음' })

    const form = await request.formData()
    const user_id = String(form.get('user_id') ?? '')
    const delta   = Number(form.get('delta') ?? 0)
    const reason  = String(form.get('reason') ?? '').trim()

    if (!user_id) return fail(400, { ok: false, error: '사용자 ID 필수' })
    if (delta === 0) return fail(400, { ok: false, error: '조정값은 0이 될 수 없습니다' })
    if (!reason) return fail(400, { ok: false, error: '조정 사유 필수' })

    const { data } = await adminAdj.rpc('adjust_credit_score', {
      p_user_id: user_id,
      p_delta:   delta,
      p_reason:  reason,
    })

    const result = data as { ok: boolean; old_score?: number; new_score?: number; error?: string } | null
    if (!result?.ok) return fail(400, { ok: false, error: result?.error ?? '조정 실패' })
    return { ok: true, old_score: result.old_score, new_score: result.new_score }
  },
}
