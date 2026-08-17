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
  delete: async ({ locals, request }) => {
    const cmsRole = await getCmsRoleForAction(locals)
    if (!cmsRole) return fail(401, { error: '인증 필요' })

    const formData = await request.formData()
    const id = formData.get('id') as string | null
    if (!id) return fail(400, { error: 'id 필요' })

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await admin.from('canned_responses').delete().eq('id', id)

    if (error) return fail(500, { error: error.message })
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

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await admin
      .from('synonym_group_members')
      .update({ status: 'confirmed' })
      .eq('id', id)

    if (error) return fail(500, { error: error.message })
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

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await admin
      .from('synonym_group_members')
      .delete()
      .eq('id', id)

    if (error) return fail(500, { error: error.message })
    return { success: true }
  },
}
