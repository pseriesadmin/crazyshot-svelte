// POST /api/cms/revoke-doc-approval
// 관리자가 CMS 고객상세패널(CustomerDetailPanel.svelte)의 본인증명 목록 "재등록" 버튼을 누르면
// 해당 증명의 관리자 승인을 취소한다(Stephen 2026-09-26 요청) — 승인 잠금이 풀려 고객 화면
// (ProfileTabContent)에서 그 증명의 "수정·삭제" 버튼이 다시 노출된다(승인 판정 = *_approved_at 이
// 있고 제출시각 이후 — identityApproval.ts와 동일).
// body: { user_id: string, type: 'identity' | 'foreign' }
//
// approve-doc과 동일하게 manager 이상만 가능. 승인 컬럼(NULL 초기화)만 건드리고 파일·등록일은
// 그대로 둔다. upload-doc(재등록 업로드)과 같은 service_role 직접 UPDATE 패턴.
import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인 필요' }, { status: 403 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ ok: false, error: '권한 없음' }, { status: 403 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ ok: false, error: '서버 설정 오류' }, { status: 500 })

  const body = await request.json().catch(() => null) as { user_id?: string; type?: string } | null
  const userId = String(body?.user_id ?? '').trim()
  const type = body?.type === 'foreign' ? 'foreign' : 'identity'
  if (!userId) return json({ ok: false, error: '사용자 ID 필수' }, { status: 400 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const approvedCol = type === 'foreign' ? 'foreign_approved_at' : 'identity_approved_at'

  const { data, error } = await admin
    .from('user_profiles')
    .update({ [approvedCol]: null })
    .eq('user_id', userId)
    .select('user_id')

  if (error) {
    console.error('[cms/revoke-doc-approval] db error:', error.message)
    return json({ ok: false, error: '승인 취소에 실패했습니다.' }, { status: 500 })
  }
  if (!data || data.length === 0) return json({ ok: false, error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  return json({ ok: true })
}
