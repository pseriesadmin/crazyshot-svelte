import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (cmsRole !== 'superadmin') throw redirect(303, '/cms')
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

    const { data: authData, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name },
    })

    if (createErr || !authData.user) {
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
