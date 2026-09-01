// GET /api/search/products?q=&category=&page=&limit=
// 통합 검색 API — 하이브리드: search_products RPC (FTS + trgm + AI CTR 부스트) + MiniSearch 자연어 폴백
// RLS: products 공개 읽기, search_logs INSERT는 SECURITY DEFINER RPC 내부 처리
//
// 2026-08-06 하이브리드 구조:
//   1차: search_products RPC (CTR 랭킹·search_logs 학습자산 보존) — 항상 우선
//   2차 (폴백): MiniSearch 자연어 검색 — RPC 결과 0건 또는 약한 매칭일 때만 보강
//              keywords/product_caption/content_blocks 텍스트도 검색 대상에 포함
//   dedupe: product id 기준 중복 제거 (RPC 결과 우선 유지)
//
// 세션 조회: event.locals.safeGetSession() 사용 — 쿠키 기반 인증 (anon 클라이언트 .auth.getSession()은
//   항상 null 반환 → 로그인 사용자 CTR 개인화 학습이 죽는 버그 FIX-2 수정, 2026-08-06)
//
// G-3 (2026-08-07): RPC 응답에 search_log_id 포함 — 클라이언트에서 클릭 시 record_search_click RPC 호출에 사용
//
// L-1 (2026-08-09): §J 학습루프 빈틈 수정 — RPC 0건 반환 시 search_log_id 후속 조회
//   search_products RPC는 q.length >= 2 이면 결과가 0건이어도 search_logs에 INSERT한다(migration 203).
//   그러나 RETURN QUERY row-set이 비어 search_log_id 컬럼을 실어 나를 행이 없으므로 TS 레이어는
//   undefined를 받아 null로 응답한다. 이것이 MiniSearch 폴백 발동 조건(0건)과 정확히 겹쳐
//   가장 도움이 될 폴백 결과의 클릭이 §J 학습 데이터(product_search_stats)에 쌓이지 못하는 맹점.
//   수정: service_role로 방금 생성된 로그를 후속 조회해 searchLogId를 채운다.

import { json, error as httpError } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { supabase } from '$lib/services/supabase'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { loadSynonymGroups } from '$lib/server/synonymLearning'
import { expandQueryWithConfirmedSynonyms } from '$lib/server/searchEngine/core/synonymExpander'
import { getWishedProductIds } from '$lib/server/getWishedProductIds'
import { getPriceMinForProducts } from '$lib/server/getPriceMinForProducts'
import type { RequestHandler } from './$types'

// RPC 결과 "약한 매칭" 기준 — 이 건수 이하면 자연어 폴백 보강 실행
const WEAK_MATCH_THRESHOLD = 3

// L-1: RPC 0건 반환 시 방금 생성된 search_log_id를 후속 조회
// search_logs RLS: anon/authenticated는 본인 행만 SELECT 가능, anonymous(user_id=NULL) 행은 anon 클라이언트로 SELECT 불가
// → service_role 클라이언트로 조회 (productSearchIndex.ts의 admin 클라이언트 패턴 동일)
// 후속 조회 실패(DB 에러·미발견) 시 null 반환 — 검색 자체는 계속 정상 동작
async function fetchRecentSearchLogId(query: string): Promise<string | null> {
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    // 10초 이내 + 동일 검색어 + 가장 최근 생성 → 방금 INSERT된 로그를 특정
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
    const { data } = await admin
      .from('search_logs')
      .select('id')
      .eq('query', query)
      .gte('created_at', tenSecondsAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data?.id as string | undefined) ?? null
  } catch {
    // 후속 조회 실패해도 null 반환 — 상위 레이어가 null 폴백 처리
    return null
  }
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const q        = (url.searchParams.get('q') ?? '').trim()
  const category = url.searchParams.get('category') || null
  const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit    = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20')))

  // security-auth.md 표준 패턴: 쿠키 기반 세션 조회 (로그인 사용자 CTR 개인화용)
  // 비로그인 사용자: session = null → p_user_id = null로 익명 검색 정상 동작
  const { session } = await locals.safeGetSession()

  // ── 1차: search_products RPC (기존 CTR 랭킹 · 학습자산 보존) ──────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rpcData, error } = await (supabase.rpc as any)('search_products', {
    p_query:      q.length >= 1 ? q : null,
    p_category:   category,
    p_page:       page,
    p_limit:      limit,
    p_session_id: session?.user?.id ?? null,
    p_user_id:    session?.user?.id ?? null,
  })

  if (error) return httpError(500, error.message)

  const rpcResults: Record<string, unknown>[] = rpcData ?? []

  // G-3: RPC 응답에서 search_log_id 추출 (migration 203에서 RETURNS TABLE에 추가됨)
  // 모든 결과 행에 동일한 값이 들어있으므로 첫 번째 행에서만 읽음
  let searchLogId = (rpcResults[0]?.['search_log_id'] as string | null) ?? null

  // L-1: RPC 0건 반환 + 검색어 2자 이상 → RPC가 search_logs에 이미 INSERT했으나(migration 203)
  // RETURN QUERY row-set이 비어 search_log_id를 받지 못한 상황.
  // MiniSearch 폴백이 발동하는 바로 그 조건이므로, 폴백 결과 클릭이 §J 학습에 쌓이려면 필수.
  if (searchLogId === null && rpcResults.length === 0 && q.length >= 2) {
    searchLogId = await fetchRecentSearchLogId(q)
  }

  // q가 비어있거나 RPC 결과가 충분하면 자연어 폴백 없이 바로 반환
  const shouldFallback = q.length >= 1 && rpcResults.length <= WEAK_MATCH_THRESHOLD

  if (!shouldFallback) {
    const wishedIds = await getWishedProductIds(
      locals.supabase,
      session?.user?.id,
      rpcResults.map((r) => String(r['product_id'] ?? r['id'] ?? '')),
    )
    const wishedSet = new Set(wishedIds)
    const results = rpcResults.map((r) => ({ ...r, wished: wishedSet.has(String(r['product_id'] ?? r['id'] ?? '')) }))
    return json({ results, query: q, page, limit, search_log_id: searchLogId })
  }

  // ── 2차: 동의어 확장 RPC 재조회 + 3차 MiniSearch 폴백 (약한 매칭 보강 — §E-2) ──
  // synonymGroups가 없거나 빈 배열이면 확장어 없이 기존 동작과 100% 동일합니다.
  const seenIds = new Set(
    rpcResults.map((r) => String(r['product_id'] ?? r['id'] ?? ''))
  )
  let mergedResults = [...rpcResults]

  // 동의어 그룹 1회 로드 — 확장 RPC 재조회 + MiniSearch 폴백 두 곳에서 재사용
  let expandedTerms: string[] = []
  try {
    const synonymGroups = await loadSynonymGroups()
    expandedTerms = expandQueryWithConfirmedSynonyms(q, synonymGroups)

    // 각 확장어로 search_products RPC 재조회 (세션 개인화 학습 제외)
    for (const expandedQ of expandedTerms) {
      if (mergedResults.length >= limit) break

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: expData } = await (supabase.rpc as any)('search_products', {
        p_query:      expandedQ,
        p_category:   category,
        p_page:       1,
        p_limit:      limit,
        p_session_id: null,
        p_user_id:    null,
      })
      const expResults: Record<string, unknown>[] = expData ?? []
      for (const row of expResults) {
        const id = String(row['product_id'] ?? row['id'] ?? '')
        if (!seenIds.has(id)) {
          seenIds.add(id)
          mergedResults.push({ ...row, _source: 'synonym_expansion', _expanded_from: expandedQ })
        }
      }
    }
  } catch {
    // 동의어 확장 실패 시 기존 결과 유지 — 서비스 중단 없음
  }

  // ── 3차: MiniSearch 자연어 폴백 (여전히 부족하면) ─────────────────────────
  try {
    const index = await getProductSearchIndex()

    // 원래 쿼리 + 확장어 전부 MiniSearch에서 검색 (순서 유지)
    for (const qItem of [q, ...expandedTerms]) {
      if (mergedResults.length >= limit) break
      const results = index.search(qItem, {
        fuzzy: 0.2,
        prefix: true,
        limit: limit * 2,
      })
      for (const r of results) {
        if (!seenIds.has(r.document.id)) {
          seenIds.add(r.document.id)
          mergedResults.push({
            product_id: r.document.id,
            id: r.document.id,
            name: r.document['name'],
            brand: r.document['brand'],
            category: r.document['category'],
            slug: r.document['slug'],
            _source: 'natural_fallback',
          })
        }
      }
    }
  } catch {
    // 자연어 폴백 실패 시 현재까지 병합된 결과만 반환 (서비스 중단 방지)
  }

  const finalResults = mergedResults.slice(0, limit)

  // 자연어 폴백(natural_fallback) 결과는 search_products RPC를 거치지 않아 price_min이 없다 —
  // 배치 조회로 채워 넣는다(2026-09-01, 검색결과 가격 0원/누락 버그 수정).
  const missingPriceIds = finalResults
    .filter((r) => r['price_min'] == null)
    .map((r) => String(r['product_id'] ?? r['id'] ?? ''))
  const priceMinMap = await getPriceMinForProducts(locals.supabase, missingPriceIds)

  const wishedIds = await getWishedProductIds(
    locals.supabase,
    session?.user?.id,
    finalResults.map((r) => String(r['product_id'] ?? r['id'] ?? '')),
  )
  const wishedSet = new Set(wishedIds)
  const results = finalResults.map((r) => {
    const id = String(r['product_id'] ?? r['id'] ?? '')
    return {
      ...r,
      price_min: r['price_min'] ?? priceMinMap[id] ?? null,
      wished: wishedSet.has(id),
    }
  })

  return json({ results, query: q, page, limit, search_log_id: searchLogId })
}
