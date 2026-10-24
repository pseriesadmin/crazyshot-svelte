// GET /api/team-policy — 공통 푸터 '소개 > 팀' 모달이 읽는 '팀 정책' 콘텐츠 (공개, 2026-10-24)
// 저장은 CMS(/cms/set/policy)에서만 한다. 고객 브라우저에 그대로 출력되므로 읽을 때 서버에서 정화한다(저장형 XSS 방어).
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { prepareTeamPolicyForView } from '$lib/server/teamPolicy'

export const GET: RequestHandler = async ({ locals }) => {
  const { data, error } = await locals.supabase.rpc('get_team_policy_settings')
  if (error) {
    console.error('[api/team-policy] 조회 실패:', error.message)
    return json({ ok: false, error: '내용을 불러오지 못했습니다.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
  const raw = (data as { content_blocks?: unknown } | null)?.content_blocks
  return json({ ok: true, blocks: prepareTeamPolicyForView(raw) }, { headers: { 'Cache-Control': 'public, max-age=30' } })
}
