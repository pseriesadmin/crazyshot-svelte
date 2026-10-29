// GET /api/cms/customers/[id]/legacy-info
// CMS 고객 상세 — 이전 서비스 정보(가입 방식·가입일·구매횟수·구매금액·관리자 메모). 이전 회원 인증으로 만들어진 계정만 값이 있다.
// 관리자 메모는 서버 전용 테이블(legacy_member_notes)에 있으므로 이 API 로만 읽는다.
// 권한: 고객목록 메뉴 + manager 이상. 서비스 키는 서버에서만 사용.
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
  const { data: profile } = await admin
    .from('user_profiles')
    .select('legacy_claimed_at, legacy_source, legacy_signup_at, legacy_purchase_count, legacy_purchase_amount')
    .eq('user_id', params.id)
    .maybeSingle()

  const p = profile as {
    legacy_claimed_at: string | null
    legacy_source: string | null
    legacy_signup_at: string | null
    legacy_purchase_count: number | null
    legacy_purchase_amount: number | null
  } | null
  if (!p || !p.legacy_claimed_at) return json({ info: null })

  const { data: notes } = await admin
    .from('legacy_member_notes')
    .select('memo, created_at')
    .eq('user_id', params.id)
    .order('created_at', { ascending: true })

  return json({
    info: {
      legacy_source: p.legacy_source,
      legacy_signup_at: p.legacy_signup_at,
      legacy_purchase_count: p.legacy_purchase_count ?? 0,
      legacy_purchase_amount: p.legacy_purchase_amount ?? 0,
      memos: ((notes ?? []) as { memo: string; created_at: string }[]).map((n) => ({ memo: n.memo, created_at: n.created_at })),
    },
  })
}
