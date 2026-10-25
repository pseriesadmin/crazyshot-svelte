// GET /api/cms/customers/[id]/retention
// 고객 패널 배지용 — 익명 전환된 계정의 법정 보존 기간 만료 도래 상태(거래 5년·상담 3년). 읽기 전용, 자동 삭제 없음 (Migration #764)
// 권한: 고객목록 메뉴 + manager 이상(거래 기록 정보). 서버 전용 RPC(service_role) 호출.
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import type { RequestHandler } from './$types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'customers.list')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!hasSettingsAccess(cmsRole ?? '')) return json({ error: '권한 없음' }, { status: 403 })

  if (!UUID_RE.test(params.id)) return json({ error: '잘못된 사용자 ID' }, { status: 400 })
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const { data, error } = await admin.rpc('cms_retention_report', { p_user_id: params.id })
  if (error) return json({ error: '조회에 실패했습니다.' }, { status: 500 })
  const row = ((data ?? []) as unknown[])[0] ?? null
  return json({ retention: row })
}
