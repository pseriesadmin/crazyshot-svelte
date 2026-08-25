import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { requireAccountMutationAccess, requireNotLastSuperadmin } from '$lib/server/requireTrueSuperadmin'
import { insertCmsAdminAuditLog } from '$lib/server/cmsAdminAuditLog'
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
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

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

function makeAdmin(): SupabaseClient | null {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(getSupabaseUrl(), key)
}

export const actions: Actions = {
  // ── 이름 수정 (Stage 4 신규) ──────────────────────────
  updateName: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const fullName = (form.get('full_name') as string | null)?.trim() ?? ''
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })
    if (!fullName) return fail(400, { error: '이름을 입력해주세요.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

    const { error } = await admin.rpc('cms_update_admin_name', {
      p_user_id: userId,
      p_full_name: fullName,
    })
    if (error) return fail(500, { error: error.message })

    const { session } = await locals.safeGetSession()
    await insertCmsAdminAuditLog(admin, {
      actorId: session?.user.id ?? null,
      actionType: 'name_change',
      targetUserId: userId,
      afterValue: { full_name: fullName },
    })

    return { success: true }
  },

  // ── 휴대번호 수정 ────────────────────────────────────
  updatePhone: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const phone = (form.get('phone') as string | null)?.trim() ?? ''
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과(EC-1과 동일 클래스)
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

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

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const cmsRole = (form.get('cms_role') as string | null)?.trim()
    if (!userId || !cmsRole) return fail(400, { error: '잘못된 요청입니다.' })
    if (!['manager', 'partner'].includes(cmsRole)) return fail(400, { error: '유효하지 않은 권한입니다.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과(EC-1)
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

    // 마지막 남은 마스터(superadmin) 강등 차단(Q4 확정, EC-3)
    const lastMasterErr = await requireNotLastSuperadmin(admin, userId)
    if (lastMasterErr) return fail(403, { error: lastMasterErr })

    const { error } = await admin.rpc('cms_update_admin_role', {
      p_user_id: userId,
      p_cms_role: cmsRole,
    })
    if (error) return fail(500, { error: error.message })

    const { session } = await locals.safeGetSession()
    await insertCmsAdminAuditLog(admin, {
      actorId: session?.user.id ?? null,
      actionType: 'role_change',
      targetUserId: userId,
      afterValue: { cms_role: cmsRole },
    })

    return { success: true }
  },

  // ── 중복허용 토글 ────────────────────────────────────
  toggleConcurrent: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const current = form.get('current') === 'true'
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과(EC-1)
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

    const { error } = await admin.rpc('cms_toggle_concurrent_login', {
      p_user_id: userId,
      p_current: current,
    })
    if (error) return fail(500, { error: error.message })

    const { session } = await locals.safeGetSession()
    await insertCmsAdminAuditLog(admin, {
      actorId: session?.user.id ?? null,
      actionType: 'concurrent_login_change',
      targetUserId: userId,
      beforeValue: { cms_allow_concurrent_login: current },
      afterValue: { cms_allow_concurrent_login: !current },
    })

    return { success: true }
  },

  // ── 세션제한 토글 (null ↔ 24h) ───────────────────────
  toggleSession: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const hasLimit = form.get('has_limit') === 'true'
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과(EC-1)
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

    const { error } = await admin.rpc('cms_toggle_session_limit', {
      p_user_id: userId,
      p_has_limit: hasLimit,
    })
    if (error) return fail(500, { error: error.message })

    const { session } = await locals.safeGetSession()
    await insertCmsAdminAuditLog(admin, {
      actorId: session?.user.id ?? null,
      actionType: 'session_limit_change',
      targetUserId: userId,
      afterValue: { has_limit: hasLimit },
    })

    return { success: true }
  },

  // ── 중지/사용 토글 ────────────────────────────────────
  toggleSuspend: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    const isSuspended = form.get('is_suspended') === 'true'
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과(EC-2)
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

    const { error } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: isSuspended ? 'none' : 'infinite',
    })
    if (error) return fail(500, { error: error.message })

    const { session } = await locals.safeGetSession()
    await insertCmsAdminAuditLog(admin, {
      actorId: session?.user.id ?? null,
      actionType: 'suspend',
      targetUserId: userId,
      beforeValue: { is_suspended: isSuspended },
      afterValue: { is_suspended: !isSuspended },
    })

    return { success: true }
  },

  // ── 삭제 ─────────────────────────────────────────────
  delete: async ({ request, locals }) => {
    const admin = makeAdmin()
    if (!admin) return fail(500, { error: '서버 설정 오류입니다.' })

    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증이 필요합니다.' })

    const form = await request.formData()
    const userId = (form.get('user_id') as string | null)?.trim()
    if (!userId) return fail(400, { error: '잘못된 요청입니다.' })
    if (userId === session.user.id) return fail(400, { error: '본인 계정은 삭제할 수 없습니다.' })

    // 대상 계정이 superadmin이면 호출자도 실제 superadmin이어야 통과(EC-2)
    const accessErr = await requireAccountMutationAccess(locals, admin, userId)
    if (accessErr) return fail(403, { error: accessErr })

    // 마지막 남은 마스터(superadmin) 삭제 차단(Q4 확정, EC-3)
    const lastMasterErr = await requireNotLastSuperadmin(admin, userId)
    if (lastMasterErr) return fail(403, { error: lastMasterErr })

    // auth.users 먼저 삭제 (실패 시 user_profiles 상태 변경 없이 롤백)
    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId)
    if (deleteErr) return fail(500, { error: deleteErr.message || 'auth 삭제 실패' })

    // auth 삭제 성공 후 user_profiles 정리 (FK ON DELETE SET NULL이므로 admin_invite_tokens는 자동 처리)
    await admin.from('user_profiles').delete().eq('id', userId)

    await insertCmsAdminAuditLog(admin, {
      actorId: session.user.id,
      actionType: 'delete',
      targetUserId: userId,
    })

    return { success: true }
  },
}
