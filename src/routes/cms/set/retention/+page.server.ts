// /cms/set/retention — 개인정보·거래 기록 보존 만료 리포트 (2026-10-24, Migration #764)
// 익명 전환된 계정의 거래 기록(5년)·상담 기록(3년) 법정 보존 만료 도래를 보여준다. **자동 삭제는 하지 않는다** — 관리자가 확인하는 용도.
// 권한: 설정 메뉴(manager 이상). 데이터는 서버 전용 RPC(service_role)로만 읽는다.
import { createClient } from '@supabase/supabase-js'
import { redirect } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export interface RetentionRow {
  user_id: string
  member_code: string | null
  purged_at: string | null
  reservation_count: number
  last_txn_at: string | null
  txn_expires_at: string | null
  txn_state: 'due' | 'soon' | 'keep' | null
  last_chat_at: string | null
  chat_expires_at: string | null
  chat_state: 'due' | 'soon' | 'keep' | null
}

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')
  if (!hasSettingsAccess(cmsRole)) throw redirect(303, '/cms?notice=access_denied')

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return { rows: [] as RetentionRow[], loadError: '서버 설정 오류입니다.', anonymizeFailures: 0 }

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const { data, error } = await admin.rpc('cms_retention_report')
  if (error) {
    console.error('[cms/set/retention] 조회 실패:', error.message)
    return { rows: [] as RetentionRow[], loadError: '리포트를 불러오지 못했습니다.', anonymizeFailures: 0 }
  }
  // 최근 3일 안에 익명 전환이 실패한 계정 수 — 실패한 계정은 개인정보가 그대로 남아 있으므로 눈에 띄게 알린다
  const since = new Date(Date.now() - 3 * 86400000).toISOString()
  const { data: failed } = await admin.from('account_deletion_events').select('user_id').eq('event', 'anonymize_failed').gte('created_at', since)
  const anonymizeFailures = new Set((failed ?? []).map((f: { user_id: string }) => f.user_id)).size
  return { rows: (data ?? []) as RetentionRow[], loadError: null as string | null, anonymizeFailures }
}
