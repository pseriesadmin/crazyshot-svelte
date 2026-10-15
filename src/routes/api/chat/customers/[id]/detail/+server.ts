// GET /api/chat/customers/[id]/detail — 채팅 상담창 고객 상세정보 조회
// GSD-5: P2-1 통합 조회 RPC 호출 + 모든 CMS 역할 공통 열람 권한 (파트너 포함)

import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const GET = async ({ params, locals }: RequestEvent<{ id: string }>) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  const { data, error } = await admin.rpc('get_chat_customer_detail', {
    p_user_id: params.id,
  })

  if (error) return json({ error: error.message }, { status: 500 })

  // 본인증명·외국인증명 승인 상태 판정에 필요한 항목(승인 시각·서류 종류)을 함께 내려준다.
  // get_chat_customer_detail RPC는 등록 파일·등록일만 반환해, 승인 취소·재승인 대기를 화면이 알 수 없었다(2026-10-15). 조회 실패는 무시(기존 응답 유지).
  const detail = data as { profile?: Record<string, unknown> | null } | null
  if (detail?.profile) {
    const { data: docRow } = await admin
      .from('user_profiles')
      .select('identity_approved_at, foreign_approved_at, foreign_type')
      .eq('id', params.id)
      .maybeSingle()
    if (docRow) Object.assign(detail.profile, docRow)
  }

  return json({ detail })
}
