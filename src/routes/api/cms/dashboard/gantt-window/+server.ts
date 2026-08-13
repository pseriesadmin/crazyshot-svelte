import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

// GET /api/cms/dashboard/gantt-window?from=YYYY-MM-DD&to=YYYY-MM-DD
// cms_role 게이트 — 모든 CMS 등급 허용 (대시보드 접근 권한과 동일)
export const GET: RequestHandler = async ({ url, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한이 필요합니다.' }, { status: 403 })

  const from = url.searchParams.get('from')
  const to   = url.searchParams.get('to')
  if (!from || !to) return json({ error: 'from/to 파라미터가 필요합니다.' }, { status: 400 })

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return json({ error: 'from/to는 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: rows, error } = await admin.rpc('get_rental_list', {
    p_status:           null,
    p_search:           null,
    p_date_from:        from,
    p_date_to:          to,
    p_page:             1,
    p_per_page:         200,
    p_exclude_statuses: ['cancelled', 'draft'],
  })

  if (error) return json({ error: error.message }, { status: 500 })
  return json({ rows: rows ?? [] })
}
