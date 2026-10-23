// CMS 접속 로그(cms_login_logs) 기록 — 공용 (2026-10-24)
// CMS 로그인 화면을 거치지 않고 /cms로 들어온 관리자 세션(사용자 사이트에서 관리자 계정으로 로그인한 경우 등)도 접속 이력이 남도록
// CMS 레이아웃이 호출한다. 기록 실패는 접속을 막지 않는다(fail-soft).
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'

export interface CmsLoginLogEntry {
  userId: string
  email: string
  cmsRole: string
  ipAddress: string
  userAgent: string
}

export async function recordCmsLogin(entry: CmsLoginLogEntry): Promise<void> {
  try {
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) return
    const admin = createClient(getSupabaseUrl(), serviceRoleKey)
    await admin.from('cms_login_logs').insert({
      user_id: entry.userId,
      email: entry.email,
      cms_role: entry.cmsRole,
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
      logged_in_at: new Date().toISOString(),
    })
  } catch {
    console.error('[cms] 접속 로그 기록 실패(접속은 유지)')
  }
}
