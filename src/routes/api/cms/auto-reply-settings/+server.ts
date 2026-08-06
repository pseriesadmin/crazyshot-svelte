// GET/PATCH /api/cms/auto-reply-settings — 자동답변 전역 스위치
// GET  : 전체 CMS 사용자 가능 (파트너 포함)
// PATCH: 매니저 이상만 (hasSettingsAccess)

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

function getAdminClient() {
  return createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
}

export const GET: RequestHandler = async ({ locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('auto_reply_settings')
    .select('id, enabled, updated_at')
    .limit(1)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })

  // 테이블 미적용(마이그레이션 전) 시 기본값 반환
  return json({ enabled: data?.enabled ?? false, id: data?.id ?? null })
}

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  // 자동답변 스위치 조작은 매니저 이상만
  if (!hasSettingsAccess(cmsRole)) {
    return json({ error: '매니저 이상만 자동답변 스위치를 변경할 수 있습니다.' }, { status: 403 })
  }

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const body = await request.json() as { enabled?: boolean }
  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled(boolean) 필수' }, { status: 400 })
  }

  const admin = getAdminClient()

  // 싱글톤 행 조회
  const { data: existing } = await admin
    .from('auto_reply_settings')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (!existing?.id) {
    // 마이그레이션 미적용 — 404 반환(클라이언트가 gracefully 처리)
    return json({ error: '자동답변 설정 테이블이 아직 준비되지 않았습니다.' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('auto_reply_settings')
    .update({
      enabled: body.enabled,
      updated_at: new Date().toISOString(),
      updated_by: session.user.id,
    })
    .eq('id', existing.id)
    .select('id, enabled, updated_at')
    .single()

  if (error) return json({ error: error.message }, { status: 500 })
  return json(data)
}
