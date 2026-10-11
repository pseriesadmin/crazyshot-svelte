import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import { buildAndStoreSemanticModel } from '$lib/server/searchEngine/adapters/semanticModelStore'
import { invalidateSemanticModelCache } from '$lib/server/searchEngine/adapters/semanticModelCache'
import type { RequestHandler } from './$types'

// GET /api/cron/nlsearch-vectors — Vercel Cron 전용(매일 03:50 KST = UTC 18:50, vercel.json crons 참고).
// 의미 벡터 모델을 다시 만들어 비공개 버킷(nlsearch-models)에 저장한다. 입력(말뭉치) 해시가 직전 모델과 같으면 건너뛴다.
// 실패하면 이전 모델이 그대로 유지된다. ⛔ 응답·로그에는 숫자와 상태만(말뭉치 문구·상품명 없음).
// ?force=1 로 같은 입력이어도 강제 재빌드(수동 점검용, 같은 CRON_SECRET 인증 필요).

export const config = { maxDuration: 300 }

export const GET: RequestHandler = async ({ request, url }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed)
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)
  const outcome = await buildAndStoreSemanticModel(admin, { force: url.searchParams.get('force') === '1' })
  if (outcome.status === 'built') invalidateSemanticModelCache()

  // 그림자 관찰 기록은 90일만 보관 — 실패해도 모델 빌드 결과에는 영향 없음
  let purged: number | null = null
  try {
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { count, error } = await admin.from('nlsearch_shadow_observations').delete({ count: 'exact' }).lt('created_at', cutoff)
    if (!error) purged = count ?? 0
  } catch {
    // 무시
  }
  return json({ ok: outcome.status !== 'failed', ...outcome, shadowPurged: purged })
}
