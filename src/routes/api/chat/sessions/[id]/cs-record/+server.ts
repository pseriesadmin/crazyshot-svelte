// GET    /api/chat/sessions/[id]/cs-record — 세션의 상담 메모 목록 조회(최신순). 호환용 record = 가장 최신 1건
// POST   /api/chat/sessions/[id]/cs-record — 상담 메모 1건 추가(단문 100자 이내, 항상 새 행 INSERT — 2026-10-17 '무한 등록' 목록화)
// DELETE /api/chat/sessions/[id]/cs-record — 세션의 상담 메모 전체 삭제, ?id=<메모 id>가 있으면 그 1건만 삭제
// 기존 패턴 참조: /api/chat/sessions/[id]/close/+server.ts (service_role + cms_role 확인)

import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import type { RequestHandler } from './$types'
import type { CsRecordStatus } from '$lib/types/chat'
import { registerCrossLingualCandidates } from '$lib/server/crossLingualSynonymScan'
import { checkCsMemo } from '$lib/utils/csMemo'

function getAdminClient() {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return null
  return createClient(getSupabaseUrl(), serviceRoleKey)
}

// ── GET: 세션의 상담 메모 목록 조회 ──────────────────────────
export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
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

  // 메모 목록 — 최신 등록순(created_at DESC). 한 세션에 쌓이는 단문 메모라 상한만 넉넉히 둔다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('cs_records')
    .select('id, session_id, user_id, category, status, summary, admin_note, created_by, created_at, updated_at')
    .eq('session_id', params.id)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{ created_by?: string | null }>
  // 등록 관리자 아이디(이메일 앞부분) — created_by(uuid)를 user_profiles에서 한 번에 조회해 붙인다(고객에게는 노출하지 않는 서버 전용 조인)
  const ids = [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))]
  const labelById = new Map<string, string>()
  if (ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: admins } = await (admin as any).from('user_profiles').select('id, email').in('id', ids)
    for (const a of (admins ?? []) as Array<{ id: string; email: string | null }>) {
      if (a.email) labelById.set(a.id, a.email.split('@')[0])
    }
  }
  const records = rows.map((r) => ({ ...r, created_by_label: r.created_by ? (labelById.get(r.created_by) ?? null) : null }))
  return json({ records, record: records[0] ?? null })
}

// ── POST: 상담 메모 1건 추가 (summary + status) ──────────────────────
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
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
  const status = (body?.status as CsRecordStatus | undefined) ?? 'in_progress'

  // 단문 메모 검증(100자·줄바꿈 합침) — 화면 제한과 별개로 서버가 최종 집행한다
  const checked = checkCsMemo(body?.summary)
  if (!checked.ok) return json({ error: checked.error }, { status: 400 })
  const summary = checked.text

  // 세션에서 user_id 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chatSession } = await (admin as any)
    .from('chat_sessions')
    .select('user_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!chatSession) return json({ error: '세션을 찾을 수 없습니다.' }, { status: 404 })
  const sessionUserId = (chatSession as { user_id: string }).user_id

  // 항상 새 행으로 추가한다(이전 메모를 덮어쓰지 않는다 — 메모 목록)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (admin as any)
    .from('cs_records')
    .insert({
      session_id: params.id,
      user_id: sessionUserId,
      summary,
      status,
      created_by: session.user.id,
    })
    .select()
    .single() as { data: unknown; error: unknown }

  const err = result.error as { message?: string } | null
  if (err) return json({ error: err.message }, { status: 500 })

  // §C-4: CS 상담 요약 이중언어 병기 패턴 학습 훅 (fire-and-forget)
  registerCrossLingualCandidates(summary).catch(() => {})

  // 방금 등록한 메모에도 등록 관리자 아이디를 붙여 돌려준다(목록 맨 위에 바로 표시)
  const email = session.user.email ?? null
  return json({ record: { ...(result.data as Record<string, unknown>), created_by_label: email ? email.split('@')[0] : null } })
}

// ── DELETE: 세션의 CS 기록 전체 삭제 ──────────────────────────────
export const DELETE: RequestHandler = async ({ params, locals, url }) => {
  const denied = await requireMenuAccessApi(locals, 'consulting.chat')
  if (denied) return denied
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

  // ?id= 가 있으면 그 세션의 메모 1건만(다른 세션 메모는 id가 같아도 지워지지 않게 session_id도 함께 조건), 없으면 세션 전체
  const memoId = url.searchParams.get('id')
  // ?id= 가 있는데 값이 비었으면 "전체 삭제"로 오해하지 않도록 거절
  if (url.searchParams.has('id') && !memoId) return json({ error: '삭제할 메모 id가 비어 있습니다.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let del = (admin as any).from('cs_records').delete().eq('session_id', params.id)
  if (memoId) del = del.eq('id', memoId)
  const { error } = await del

  if (error) return json({ error: error.message }, { status: 500 })

  return json({ ok: true })
}
