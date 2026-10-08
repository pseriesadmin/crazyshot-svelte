import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import {
  getProductSearchIndex,
  getLastIndexBuildStats,
  invalidateProductSearchCache,
} from '$lib/server/searchEngine/adapters/productSearchIndex'
import type { RequestHandler } from './$types'

// GET /api/cron/search-index-health — Vercel Cron 전용(매일 03:30 KST = UTC 18:30, vercel.json crons 참고).
// NLSearch 상품 검색 인덱스는 서버 인스턴스 메모리(TTL 60초)에만 존재해 이 cron이 인덱스를 "만들어 저장"할 수는 없다.
// 대신 인덱스를 새로 빌드해 보고, 상태를 숫자만 search_index_snapshots(Migration 671)에 기록해
// 이상 징후(빌드 실패·후기 반영 급감·빌드 시간 급증)를 직전 기록과 비교해 로그로 남긴다.
// ⛔ 응답·로그·기록에 후기 문구·상품명·작성자 정보를 넣지 않는다(숫자와 상태만).

/** 직전 기록 대비 이상 판정 기준 */
const REVIEW_DROP_RATIO = 0.5
const BUILD_TIME_GROWTH_RATIO = 3

interface SnapshotRow {
  indexed_products: number
  reviewed_products: number
  review_rows: number
  weak_products: number
  build_ms: number
  status: 'ok' | 'error'
}

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET
  // CRON_SECRET 미설정 시 무조건 거부(fail-closed) — "시크릿 없으면 전체 허용"은 절대 금지
  if (!cronSecret) return json({ error: '서버 설정 오류(CRON_SECRET 미설정)' }, { status: 401 })

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) return json({ error: '인증 실패' }, { status: 401 })

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })

  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  try {
    // 캐시를 비우고 새로 빌드 — 빌드 통계는 어댑터가 모듈 변수에 기록한다
    invalidateProductSearchCache()
    await getProductSearchIndex()
    const stats = getLastIndexBuildStats()
    if (!stats) {
      console.error('[search-index-health] 빌드 통계 없음')
      return json({ ok: false, error: '빌드 통계를 얻지 못했습니다' })
    }

    const row: SnapshotRow = {
      indexed_products: stats.indexedProducts,
      reviewed_products: stats.reviewedProducts,
      review_rows: stats.reviewRows,
      weak_products: stats.weakProducts,
      build_ms: stats.buildMs,
      status: stats.status,
    }

    // 직전 스냅샷 조회(비교용) — 실패해도 기록은 계속한다
    let previous: SnapshotRow | null = null
    const prevRes = await admin
      .from('search_index_snapshots')
      .select('indexed_products, reviewed_products, review_rows, weak_products, build_ms, status')
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!prevRes.error && prevRes.data) previous = prevRes.data as SnapshotRow

    const { error: insertError } = await admin.from('search_index_snapshots').insert(row)
    if (insertError) {
      console.error('[search-index-health] 스냅샷 기록 실패:', insertError.message)
    }

    // 이상 징후 판정 — 숫자만 로그
    const warnings: string[] = []
    if (row.status === 'error') warnings.push('index_build_failed')
    if (previous && previous.status === 'ok') {
      if (previous.review_rows > 0 && row.review_rows < previous.review_rows * REVIEW_DROP_RATIO) {
        warnings.push('review_rows_dropped')
      }
      if (previous.build_ms > 0 && row.build_ms > previous.build_ms * BUILD_TIME_GROWTH_RATIO) {
        warnings.push('build_time_spiked')
      }
    }
    if (warnings.length > 0) {
      console.error('[search-index-health] 이상 징후:', warnings.join(','), JSON.stringify(row))
    }

    return json({
      ok: row.status === 'ok' && !insertError,
      recorded: !insertError,
      warnings,
      ...row,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[search-index-health]', message)
    // 던지지 않고 JSON으로 반환 — Vercel Cron이 재시도 폭주하지 않도록
    return json({ ok: false, error: message })
  }
}
