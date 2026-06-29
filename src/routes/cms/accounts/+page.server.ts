import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')
  return {}
}

export const actions: Actions = {
  createAccount: async ({ request }) => {
    const form = await request.formData()
    const name      = (form.get('name') as string | null)?.trim() ?? ''
    const email     = (form.get('email') as string | null)?.trim() ?? ''
    const phone     = (form.get('phone') as string | null)?.trim() ?? ''
    const cmsRole   = (form.get('cms_role') as string | null) ?? 'manager'
    const concurrent = form.get('cms_allow_concurrent_login') === 'true'
    const timeout    = form.get('cms_session_timeout_hours') === 'true' ? 24 : null

    if (!name || !email || !phone) {
      return fail(400, { error: '이름, 이메일, 휴대번호는 필수입니다.' })
    }
    if (!['manager', 'partner'].includes(cmsRole)) {
      return fail(400, { error: '유효하지 않은 권한입니다.' })
    }

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 설정 오류입니다.' })

    const serviceClient = createClient(getSupabaseUrl(), serviceRoleKey)

    let { data: authData, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name },
    })

    // 이미 auth.users에 존재하지만 CMS 계정이 없는 고아 상태 처리
    if (createErr && createErr.message?.includes('already been registered')) {
      const { data: listData } = await serviceClient.auth.admin.listUsers({ perPage: 1000 })
      const existing = listData?.users.find((u) => u.email === email)
      if (existing) {
        const { data: profileData } = await serviceClient
          .from('user_profiles')
          .select('cms_role')
          .eq('id', existing.id)
          .single()
        // cms_role이 있으면 실제 중복 — 에러 반환
        if (profileData && (profileData as { cms_role: string | null }).cms_role) {
          return fail(400, { error: '이미 등록된 관리자 계정입니다.' })
        }
        // 고아 상태 (auth.users만 있고 cms_role 없음) — 기존 auth 유저 재사용
        authData = { user: existing }
        createErr = null
      }
    }

    if (createErr || !authData?.user) {
      return fail(500, { error: createErr?.message ?? '계정 생성에 실패했습니다.' })
    }

    const userId = authData.user.id

    await serviceClient.rpc('cms_setup_admin_profile', {
      p_user_id: userId,
      p_full_name: name,
      p_phone: phone,
      p_cms_role: cmsRole,
      p_allow_concurrent_login: concurrent,
      p_session_timeout_hours: timeout,
    })

    const { data: token } = await serviceClient.rpc('cms_create_invite_token', {
      p_created_by: userId,
    })

    const inviteLink = token ? `/cms/login?invite=${token}` : null

    return { success: true, inviteLink, email }
  },
}
