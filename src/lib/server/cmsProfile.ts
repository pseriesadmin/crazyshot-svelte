import type { SupabaseClient } from '@supabase/supabase-js'

export type CmsProfileRow = {
  cms_role: string | null
  name: string | null
}

/**
 * CMS 프로필 조회 — DB 스키마 호환
 * - stage: id = auth.users.id (user_id 컬럼 없음)
 * - v5.46: user_id = auth.users.id, id = 별도 PK
 */
export async function fetchCmsProfileByAuthId(
  admin: SupabaseClient,
  authUserId: string,
): Promise<CmsProfileRow | null> {
  // full_name 컬럼을 name으로 alias — cms/accounts/list/+page.server.ts와 동일 매핑 관례
  const byId = await admin
    .from('user_profiles')
    .select('cms_role, name:full_name')
    .eq('id', authUserId)
    .maybeSingle()

  if (byId.data) return byId.data as CmsProfileRow

  const byUserId = await admin
    .from('user_profiles')
    .select('cms_role, name:full_name')
    .eq('user_id', authUserId)
    .maybeSingle()

  if (byUserId.error?.message?.includes('user_id')) {
    return (byId.data ?? null) as CmsProfileRow | null
  }

  if (byUserId.error || !byUserId.data) return null
  return byUserId.data as CmsProfileRow
}
