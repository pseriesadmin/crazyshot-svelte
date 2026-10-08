import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { runKnowledgeBuild } from '$lib/server/crazychat/knowledge/build'
import { createKnowledgeLoaders, createKnowledgeStore } from '$lib/server/crazychat/knowledge/store'
import type { RequestHandler } from './$types'

// GET /api/cron/crazychat-knowledge — Vercel Cron 전용(매일 03:10 KST = UTC 18:10, vercel.json crons 참고).
// 크레이지챗의 "지식 저장소"를 매일 새벽에 새로 정리한다: 누적 빠른답변 · 검색 색인 상품 · 공개 상품 후기 · 고객 예약(집계 전용).
// 요약본은 crazychat_knowledge(Migration #680)에 재료별 1행으로 저장되고, 에이전트는 loadKnowledgeSnapshot()으로 읽는다.
// ⛔ 고객 식별 정보·후기 원문은 요약본에 넣지 않는다(집계·단어 빈도만). 응답·로그에도 숫자와 상태만 남긴다.

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed) — "시크릿 없으면 전체 허용"은 절대 금지
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  try {
    const result = await runKnowledgeBuild({ loaders: createKnowledgeLoaders(admin), store: createKnowledgeStore(admin), now: () => new Date() })
    if (!result.ok) console.error('[crazychat-knowledge] 일부 재료 실패:', JSON.stringify(result.sources.filter((s) => s.status === 'error').map((s) => ({ source: s.source, error: s.error }))))
    return json(result)
  } catch (err) {
    console.error('[crazychat-knowledge] 정리 작업 실패:', err instanceof Error ? err.message : '알 수 없는 오류')
    return json({ ok: false, error: '정리 작업 실패' }, { status: 500 })
  }
}
