import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { Actions, PageServerLoad } from './$types'
import type { SupabaseClient } from '@supabase/supabase-js'

interface ProfileRow {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  cms_role: string | null
  cms_allow_concurrent_login: boolean
  cms_session_timeout_hours: number | null
}

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (cmsRole !== 'superadmin') throw redirect(303, '/cms')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { accounts: [] as AccountRow[] }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const [profilesRes, authRes] = await Promise.all([
    admin
      .from('user_profiles')
      .select('id, full_name, email, phone, cms_role, cms_allow_concurrent_login, cms_session_timeout_hours')
      .not('cms_role', 'is', null)
      .order('created_at', { ascending: true }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  const profiles = (profilesRes.data as ProfileRow[]) ?? []

  const bannedMap: Record<string, boolean> = {}
  for (const u of authRes.data?.users ?? []) {
    bannedMap[u.id] = !!u.banned_until && new Date(u.banned_until) > new Date()
  }

  const accounts: AccountRow[] = profiles.map((p, i) => ({
    no: i + 1,
    id: p.id,
    name: p.full_name ?? '',
    email: p.email,
    phone: p.phone ?? '',
    cms_role: p.cms_role ?? '',
    cms_allow_concurrent_login: p.cms_allow_concurrent_login,
    cms_session_timeout_hours: p.cms_session_timeout_hours,
    is_suspended: bannedMap[p.id] ?? false,
  }))

  return { accounts }
}

export interface AccountRow {
  no: number
  id: string
  name: string
  email: string
  phone: string
  cms_role: string
  cms_allow_concurrent_login: boolean
  cms_session_timeout_hours: number | null
  is_suspended: boolean
}

// ── 공통: superadmin 권한 확인 ──────────────────────────
async function requireSuperadmin(
  locals: App.Locals,
  admin: SupabaseClient
): Promise<string | null> {
  const { session } = await locals.safeGetSession()
  if (!session) return '인증이 필요합니다.'

  const { data } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()
  const p = data as { cms_role: string | null } | null
  if (p?.cms_role !== 'superadmin') return '권한이 없습니다.'
  return null
}

function makeAdmin(): SupabaseClient | null {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(getSupabaseUrl(), key)
}

export const actions: Actions = {
  // ── 휴대번호 수정 ────────────────────────────────────
  updatePhone: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })
    const err = await requireSuperadmin(locals, admin)
    if (err) return fail(403, { error: err })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const phone = (form.get('phone') as string | null)?.trim() ?? ''
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    const { error } = await admin.rpc('cms_update_admin_phone', {
      p_user_id: userId,
      p_phone: phone,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ── 접근권한 수정 ────────────────────────────────────
  updateRole: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })
    const err = await requireSuperadmin(locals, admin)
    if (err) return fail(403, { error: err })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const cmsRole = (form.get('cms_role') as string | null)?.trim()
    if (!userId || !cmsRole) return fail(400, { error: '잘못된 요청입니다.' })
    if (!['manager', 'partner'].includes(cmsRole)) return fail(400, { error: '유효하지 않은 권한입니다.' })

    const { error } = await admin.rpc('cms_update_admin_role', {
      p_user_id: userId,
      p_cms_role: cmsRole,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ── 중복허용 토글 ────────────────────────────────────
  toggleConcurrent: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })
    const err = await requireSuperadmin(locals, admin)
    if (err) return fail(403, { error: err })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const current = form.get('current') === 'true'
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    const { error } = await admin.rpc('cms_toggle_concurrent_login', {
      p_user_id: userId,
      p_current: current,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ── 세션제한 토글 (null ↔ 24h) ───────────────────────
  toggleSession: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })
    const err = await requireSuperadmin(locals, admin)
    if (err) return fail(403, { error: err })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const hasLimit = form.get('has_limit') === 'true'
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    const { error } = await admin.rpc('cms_toggle_session_limit', {
      p_user_id: userId,
      p_has_limit: hasLimit,
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ── 중지/사용 토글 ────────────────────────────────────
  toggleSuspend: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })
    const err = await requireSuperadmin(locals, admin)
    if (err) return fail(403, { error: err })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const isSuspended = form.get('is_suspended') === 'true'
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: isSuspended ? 'none' : 'infinite',
    })
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },

  // ── 삭제 ─────────────────────────────────────────────
  delete: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증이 필요합니다.' })

    const err = await requireSuperadmin(locals, admin)
    if (err) return fail(403, { error: err })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })
    if (userId === session.user.id) return fail(400, { error: '본인 계정은 삭제할 수 없습니다.' })

    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) return fail(500, { error: error.message })
    return { success: true }
  },
}
