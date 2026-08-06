// GET /api/cms/customers/[userId]/summary — 고객 기본정보 요약 (채팅 상담창 헤더 표시용)
// user_profiles 단건 조회 — get_customer_list(페이지네이션 목록 RPC)와 별개의 경량 단건 조회

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

export interface CustomerSummary {
  user_id: string
  email: string | null
  member_code: string | null
  membership_grade: string | null
  credit_score: number | null
  blacklisted: boolean
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })
  // 크레이지스코어·블랙리스트 등 민감정보 포함 — 파트너는 조회 불가(매니저 이상만)
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('user_profiles')
    .select('id, email, member_code, membership_grade, credit_score, blacklisted')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })
  if (!data) return json({ error: '고객 정보를 찾을 수 없습니다.' }, { status: 404 })

  const row = data as {
    id: string
    email: string | null
    member_code: string | null
    membership_grade: string | null
    credit_score: number | null
    blacklisted: boolean | null
  }

  const summary: CustomerSummary = {
    user_id: row.id,
    email: row.email,
    member_code: row.member_code,
    membership_grade: row.membership_grade,
    credit_score: row.credit_score,
    blacklisted: row.blacklisted ?? false,
  }

  return json(summary)
}
