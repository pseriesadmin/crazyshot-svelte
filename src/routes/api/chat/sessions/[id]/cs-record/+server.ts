// GET  /api/chat/sessions/[id]/cs-record — 세션의 CS 상담기록 조회
// POST /api/chat/sessions/[id]/cs-record — CS 상담기록 저장(upsert)
// 기존 패턴 참조: /api/chat/sessions/[id]/close/+server.ts (service_role + cms_role 확인)

import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import type { CsRecordStatus } from '$lib/types/chat'
import { registerCrossLingualCandidates } from '$lib/server/crossLingualSynonymScan'

function getAdminClient() {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return null
  return createClient(getSupabaseUrl(), serviceRoleKey)
}

// ── GET: 세션의 가장 최신 CS 기록 조회 ──────────────────────────
export const GET: RequestHandler = async ({ params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const admin = getAdminClient()
  if (!admin) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const p = profile as { cms_role: string | null } | null
  if (!p?.cms_role) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('cs_records')
    .select('id, session_id, user_id, category, status, summary, admin_note, created_at, updated_at')
    .eq('session_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ record: data ?? null })
}

// ── POST: CS 기록 upsert (summary + status) ──────────────────────
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const admin = getAdminClient()
  if (!admin) return json({ error: '서버 설정 오류입니다.' }, { status: 500 })

  const { data: profile } = await admin
    .from('user_profiles')
    .select('cms_role')
    .eq('id', session.user.id)
    .single()

  const p = profile as { cms_role: string | null } | null
  if (!p?.cms_role) return json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const summary = (body?.summary as string | undefined)?.trim() ?? ''
  const status = (body?.status as CsRecordStatus | undefined) ?? 'in_progress'

  if (!summary) return json({ error: 'summary는 필수입니다.' }, { status: 400 })

  // 세션에서 user_id 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chatSession } = await (admin as any)
    .from('chat_sessions')
    .select('user_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!chatSession) return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  const sessionUserId = (chatSession as { user_id: string }).user_id

  // 기존 레코드 확인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from('cs_records')
    .select('id')
    .eq('session_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: { data: unknown; error: unknown }
  if (existing) {
    // UPDATE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await (admin as any)
      .from('cs_records')
      .update({ summary, status, updated_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id)
      .select()
      .single()
  } else {
    // INSERT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = await (admin as any)
      .from('cs_records')
      .insert({
        session_id: params.id,
        user_id: sessionUserId,
        summary,
        status,
      })
      .select()
      .single()
  }

  const err = result.error as { message?: string } | null
  if (err) return json({ error: err.message }, { status: 500 })

  // §C-4: CS 상담 요약 이중언어 병기 패턴 학습 훅 (fire-and-forget)
  registerCrossLingualCandidates(summary).catch(() => {})

  return json({ record: result.data })
}
