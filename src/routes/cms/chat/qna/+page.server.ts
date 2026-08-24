// /cms/chat/qna — 빠른답변(QnA) 관리 화면 서버
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { redirect, fail } from '@sveltejs/kit'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad, Actions } from './$types'

// §D-2: 동의어 후보 테이블 타입 (cross_lingual_pattern + query_reformulation)
export interface SynonymCandidateRow {
  id: string
  term: string
  source: string
  status: string
  occurrence_count: number
  created_at: string
  last_observed_at: string | null
  canonical_term: string
  group_id: string
}

export interface CannedResponseRow {
  id: string
  title: string
  content: string
  category: string | null
  help_category: string | null
  shortcut: string | null
  match_keywords: string[]
  usage_count: number
  created_at: string
  image_url: string | null
  cta_label: string | null
  cta_url: string | null
}

interface AutoReplySetting {
  id: string
  enabled: boolean
}

export const load: PageServerLoad = async ({ parent, url }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // §D-2: 동의어 후보 목록 조회 (cross_lingual_pattern + query_reformulation)
  type RawCandidateRow = {
    id: string
    term: string
    source: string
    status: string
    occurrence_count: number
    created_at: string
    last_observed_at: string | null
    group_id: string
    synonym_groups: { canonical_term: string } | null
  }

  const [itemsResult, autoReplyResult, candidatesResult] = await Promise.all([
    admin
      .from('canned_responses')
      .select('id, title, content, category, help_category, shortcut, match_keywords, usage_count, created_at, image_url, cta_label, cta_url')
      .order('usage_count', { ascending: false })
      .order('title', { ascending: true }),
    admin
      .from('auto_reply_settings')
      .select('id, enabled')
      .limit(1)
      .maybeSingle(),
    // §D-2: learned, seed 제외 — 관리자 검토 대상만 (cross_lingual_pattern, query_reformulation)
    admin
      .from('synonym_group_members')
      .select('id, term, source, status, occurrence_count, created_at, last_observed_at, group_id, synonym_groups!inner(canonical_term)')
      .in('source', ['cross_lingual_pattern', 'query_reformulation'])
      .order('created_at', { ascending: false })
      .limit(200)
      .returns<RawCandidateRow[]>(),
  ])

  const items = (itemsResult.error ? [] : (itemsResult.data ?? [])) as CannedResponseRow[]
  const selectedId = url.searchParams.get('selected') ?? null
  const selectedItem = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null

  const autoReplySetting = autoReplyResult.data as AutoReplySetting | null

  // §D-2: 동의어 후보 목록 정제
  const rawCandidates = (candidatesResult.error ? [] : (candidatesResult.data ?? [])) as RawCandidateRow[]
  const synonymCandidates: SynonymCandidateRow[] = rawCandidates.map((r) => ({
    id: r.id,
    term: r.term,
    source: r.source,
    status: r.status,
    occurrence_count: r.occurrence_count,
    created_at: r.created_at,
    last_observed_at: r.last_observed_at,
    group_id: r.group_id,
    canonical_term: r.synonym_groups?.canonical_term ?? '',
  }))

  return {
    items,
    selectedId,
    selectedItem,
    autoReplyEnabled: autoReplySetting?.enabled ?? false,
    autoReplySettingId: autoReplySetting?.id ?? null,
    cmsRole,
    synonymCandidates,
  }
}

export const actions: Actions = {
  // manager 이상만 삭제 가능 — 같은 파일의 promoteCandidate/deleteCandidateMember와 역할
  // 경계 통일(CMS 전역 정밀검증 v3 STAGE 1 BOUNDARY-3, migration 331)
  delete: async ({ locals, request }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(401, { error: '인증 필요' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음 (manager 이상 필요)' })

    const formData = await request.formData()
    const id = formData.get('id') as string | null
    if (!id) return fail(400, { error: 'id 필요' })

    // H-01: RPC 경유(migration 331 cms_delete_canned_response) — is_cms_user()가 auth.uid()에
    // 의존하므로 세션 클라이언트(locals.supabase)로 호출해야 함(admin/service_role 클라이언트
    // 호출 시 auth.uid()가 NULL이라 항상 거부됨). database.ts에 신규 RPC 타입이 없어 캐스트
    // 필요(promotion/ad·coupon과 동일 관행, database.ts 재생성 전까지 유지).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_delete_canned_response', { p_id: id })
    if (error) return fail(500, { error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { error: result?.error ?? '삭제 실패' })
    return { success: true }
  },

  // §D-2: 동의어 후보 → confirmed 승급 (manager 이상)
  promoteCandidate: async ({ locals, request }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(401, { error: '인증 필요' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음 (manager 이상 필요)' })

    const formData = await request.formData()
    const id = formData.get('id') as string | null
    if (!id) return fail(400, { error: 'id 필요' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_promote_synonym_candidate', { p_id: id })
    if (error) return fail(500, { error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { error: result?.error ?? '승급 실패' })
    return { success: true }
  },

  // §D-2: 동의어 후보 삭제 (manager 이상)
  deleteCandidateMember: async ({ locals, request }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(401, { error: '인증 필요' })
    if (!hasSettingsAccess(cmsRole)) return fail(403, { error: '권한 없음 (manager 이상 필요)' })

    const formData = await request.formData()
    const id = formData.get('id') as string | null
    if (!id) return fail(400, { error: 'id 필요' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = locals.supabase as unknown as any
    const { data, error } = await db.rpc('cms_delete_synonym_candidate', { p_id: id })
    if (error) return fail(500, { error: error.message })
    const result = data as { ok: boolean; error?: string } | null
    if (!result?.ok) return fail(400, { error: result?.error ?? '삭제 실패' })
    return { success: true }
  },
}
