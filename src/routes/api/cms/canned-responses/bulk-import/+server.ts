// /api/cms/canned-responses/bulk-import — CSV 상담로그에서 추출한 (고객 질문, 상담원 답변)
// 쌍을 빠른답변으로 일괄 등록. 편집 권한: is_cms_user() (단일 등록 POST /api/cms/canned-responses와
// 동일한 게이트 — 파트너 포함 모든 CMS 사용자)
//
// ⚠️ category·help_category·shortcut·match_keywords는 의도적으로 비워/기본값만 채운다
// (Stephen 확정 — 원본 CSV에는 다른 고객의 개인정보가 섞여 있어, 단축키·매칭키워드를
// 자동으로 채우면 실시간 고객 채팅에서 잘못 자동매칭·자동발송될 위험이 있다). 분류·단축키·
// 매칭키워드는 생성된 항목을 CMS 목록에서 열어 관리자가 직접 검토 후 설정/수정/삭제한다.
//
// ⛔ pending_review=true 필수(Migration #617, 2026-10-02 — sp3-qa-agent 검수로 발견):
// shortcut/match_keywords를 비워도 matchCannedResponse()는 title/content를 항상 함께
// 검색하므로, 이 플래그 없이는 미검토 CSV 원문이 생성 즉시 실시간 고객채팅 자동매칭
// 후보가 될 수 있다(api/chat/message/+server.ts가 pending_review=false만 후보로 조회).
// 관리자가 CannedResponsePanel에서 저장(PATCH)하는 순간 false로 전환된다.
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'

interface BulkImportItem {
  title: string
  content: string
}

const MAX_ITEMS = 1000

export const POST: RequestHandler = async ({ locals, request }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })

  const body = await request.json().catch(() => null) as { items?: unknown } | null
  const rawItems = Array.isArray(body?.items) ? (body!.items as unknown[]) : null

  if (!rawItems || rawItems.length === 0) {
    return json({ error: '등록할 항목이 없습니다.' }, { status: 400 })
  }
  if (rawItems.length > MAX_ITEMS) {
    return json({ error: `한 번에 최대 ${MAX_ITEMS}건까지만 등록할 수 있습니다.` }, { status: 400 })
  }

  const items: BulkImportItem[] = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    const content = typeof r.content === 'string' ? r.content.trim() : ''
    if (!title || !content) continue
    items.push({ title, content })
  }

  if (items.length === 0) {
    return json({ error: '유효한 제목·내용 쌍이 없습니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await admin
    .from('canned_responses')
    .insert(
      items.map((item) => ({
        title: item.title,
        content: item.content,
        category: null,
        help_category: 'etc',
        shortcut: null,
        match_keywords: [],
        pending_review: true,
        created_by: session.user.id,
      })),
    )
    .select('id')

  if (error) {
    return json({ error: error.message }, { status: 500 })
  }

  return json({ created: data?.length ?? 0, ids: (data ?? []).map((r) => r.id as string) }, { status: 201 })
}
