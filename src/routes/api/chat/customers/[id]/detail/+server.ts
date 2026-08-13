// GET /api/chat/customers/[id]/detail — 채팅 상담창 고객 상세정보 조회
// GSD-5: P2-1 통합 조회 RPC 호출 + 모든 CMS 역할 공통 열람 권한 (파트너 포함)

import { json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET = async ({ params, locals }: RequestEvent<{ id: string }>) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin.rpc('get_chat_customer_detail', {
    p_user_id: params.id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ detail: data })
}
