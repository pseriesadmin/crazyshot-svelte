// GET /api/cms/chat/merge-guest/search?q= — 비회원 상담 병합 대상 회원 검색 (2026-11-05, Stephen 지시: 관리자 수동 병합)
// 상담 화면에서 비회원(익명) 세션을 어느 회원 계정에 합칠지 고르기 위한 조회. 이메일·회원코드·이름 부분 일치, 최대 8건.
// 권한: 상담 채팅 메뉴 + 매니저 이상(고객 요약 조회와 같은 기준 — 회원 개인정보 노출). 익명 계정은 프로필 행이 없어 결과에 나오지 않는다.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { sanitizeMemberQuery, MEMBER_SEARCH_MIN } from '$lib/utils/memberSearchQuery'
import type { RequestHandler } from './$types'

const MAX_RESULTS = 8

export interface MergeMemberCandidate {
  id: string
  email: string | null
  full_name: string | null
  member_code: string | null
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '관리자 권한이 필요합니다.' }, { status: 401 })
  if (!hasSettingsAccess(cmsRole)) return json({ error: '권한 없음' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const q = sanitizeMemberQuery(url.searchParams.get('q') ?? '')
  if (q.length < MEMBER_SEARCH_MIN) return json({ members: [] satisfies MergeMemberCandidate[] })

  const admin = createClient(PUBLIC_SUPABASE_URL, serviceRoleKey)
  const { data, error } = await admin
    .from('user_profiles')
    .select('id, email, full_name, member_code')
    .is('deleted_at', null)
    .or(`email.ilike.%${q}%,member_code.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(MAX_RESULTS)

  if (error) {
    console.error('[merge-guest/search] 조회 실패:', error.message)
    return json({ error: '회원 검색에 실패했습니다.' }, { status: 500 })
  }
  return json({ members: (data ?? []) as MergeMemberCandidate[] })
}
