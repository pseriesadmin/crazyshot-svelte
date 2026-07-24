import { fail, redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import type { Actions, PageServerLoad } from './$types'

export interface InquiryRow {
  id:          string
  title:       string
  content:     string
  category:    string
  status:      string
  created_at:  string
  user_id:     string
  user_name:   string
  user_email:  string
  reply_count: number
  replies:     InquiryReply[]
}

export interface InquiryReply {
  id:             string
  response:       string
  is_resolution:  boolean
  created_at:     string
  responder_id:   string
}

const PER_PAGE = 20

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!hasSettingsAccess(cmsRole ?? '')) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    return { posts: [] as InquiryRow[], totalCount: 0, totalPages: 1, page: 1, status: '', search: '' }
  }

  const status = url.searchParams.get('status') ?? ''
  const search = url.searchParams.get('search') ?? ''
  const page   = Math.max(1, Number(url.searchParams.get('page') ?? '1'))

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const { data, error } = await admin.rpc('get_all_cs_posts', {
    p_status: status || null,
    p_search: search || null,
    p_page:   page,
    p_limit:  PER_PAGE,
  })

  if (error) {
    console.error('[cms/inquiry] load error:', error.message)
    return { posts: [] as InquiryRow[], totalCount: 0, totalPages: 1, page, status, search }
  }

  const rows = (data ?? []) as Array<InquiryRow & { total_count?: number }>
  const totalCount = rows[0]?.total_count ?? 0

  return {
    posts:      rows as InquiryRow[],
    totalCount: Number(totalCount),
    totalPages: Math.max(1, Math.ceil(Number(totalCount) / PER_PAGE)),
    page,
    status,
    search,
  }
}

export const actions: Actions = {
  reply: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 오류' })

    const fd = await request.formData()
    const postId      = (fd.get('post_id')       as string | null)?.trim()
    const response    = (fd.get('response')       as string | null)?.trim()
    const isResStr    = fd.get('is_resolution') as string | null
    const isResolution = isResStr === 'true'

    if (!postId || !response) return fail(400, { error: '필수 항목 누락' })

    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    const { error } = await admin.rpc('add_cs_reply', {
      p_post_id:       postId,
      p_responder_id:  session.user.id,
      p_response:      response,
      p_is_resolution: isResolution,
    })

    if (error) return fail(500, { error: '답변 저장 실패: ' + error.message })
    return { ok: true }
  },

  updateStatus: async ({ request, locals }) => {
    const { session } = await locals.safeGetSession()
    if (!session) return fail(401, { error: '인증 필요' })
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(403, { error: '권한 없음' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음' })

    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return fail(500, { error: '서버 오류' })

    const fd = await request.formData()
    const postId = (fd.get('post_id') as string | null)?.trim()
    const status = (fd.get('status')  as string | null)?.trim()

    if (!postId || !status) return fail(400, { error: '필수 항목 누락' })

    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    const { error } = await admin.rpc('update_cs_post_status', {
      p_post_id: postId,
      p_status:  status,
    })

    if (error) return fail(500, { error: '상태 변경 실패: ' + error.message })
    return { ok: true }
  },
}
