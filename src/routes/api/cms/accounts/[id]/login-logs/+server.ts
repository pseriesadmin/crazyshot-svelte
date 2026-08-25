// GET /api/cms/accounts/[id]/login-logs — 계정 접속로그 조회 (페이지네이션)
// Stage 6: AccountDetailPanel "접속로그" 탭 데이터 공급
//
// 권한 정책:
//   - 본인(viewerUserId === params.id) 또는 manager+ → 허용
//   - partner가 타인 로그 조회 → 403
// (canViewLoginLogs 순수 함수로 판정 — loginLogsAccessCheck.ts TDD GREEN 확인)
//
// "CMS 브라우저 auth 패턴": cms_login_logs에 RLS 정책이 없으므로 브라우저 RLS 경로 대신
// service_role 경유 이 +server.ts에서만 접근한다.

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { canViewLoginLogs } from '$lib/server/loginLogsAccessCheck'
import type { RequestHandler } from './$types'

const PAGE_SIZE = 20

export interface LoginLogRow {
  id: string
  email: string
  cms_role: string | null
  ip_address: string | null
  user_agent: string | null
  logged_in_at: string
}

export interface LoginLogsResponse {
  logs: LoginLogRow[]
  total: number
  page: number
  totalPages: number
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
  // 1. CMS 세션 확인
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '인증이 필요합니다.' }, { status: 401 })

  // 2. 세션에서 현재 사용자 ID 조회
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증이 필요합니다.' }, { status: 401 })

  const targetUserId = params.id
  if (!targetUserId) return json({ error: '잘못된 요청입니다.' }, { status: 400 })

  // 3. 접속로그 조회 권한 판정
  if (!canViewLoginLogs(cmsRole, session.user.id, targetUserId)) {
    return json({ error: '자신의 접속로그만 조회할 수 있습니다.' }, { status: 403 })
  }

  // 4. 페이지네이션 파라미터
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // 5. service_role로 조회
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error, count } = await admin
    .from('cms_login_logs')
    .select('id, email, cms_role, ip_address, user_agent, logged_in_at', { count: 'exact' })
    .eq('user_id', targetUserId)
    .order('logged_in_at', { ascending: false })
    .range(from, to)

  if (error) return json({ error: error.message }, { status: 500 })

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const response: LoginLogsResponse = {
    logs: (data ?? []) as LoginLogRow[],
    total,
    page,
    totalPages,
  }

  return json(response)
}
