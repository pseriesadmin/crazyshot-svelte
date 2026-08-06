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

import { json, error as httpError } from '@sveltejs/kit'
import { supabase } from '$lib/services/supabase'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import type { RequestHandler } from './$types'

// RPC 결과 "약한 매칭" 기준 — 이 건수 이하면 자연어 폴백 보강 실행
const WEAK_MATCH_THRESHOLD = 3

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

  // q가 비어있거나 RPC 결과가 충분하면 자연어 폴백 없이 바로 반환
  const shouldFallback = q.length >= 1 && rpcResults.length <= WEAK_MATCH_THRESHOLD

  if (!shouldFallback) {
    return json({ results: rpcResults, query: q, page, limit })
  }

  // ── 2차: MiniSearch 자연어 폴백 (RPC 결과 약할 때만) ──────────────────────
  try {
    const index = await getProductSearchIndex()
    const naturalResults = index.search(q, {
      fuzzy: 0.2,
      prefix: true,
      limit: limit * 2, // dedupe 여유분 확보
    })

    if (naturalResults.length === 0) {
      return json({ results: rpcResults, query: q, page, limit })
    }

    // RPC 결과 id 집합
    const rpcIdSet = new Set(
      rpcResults.map((r) => String(r['product_id'] ?? r['id'] ?? ''))
    )

    // RPC 결과에 없는 자연어 결과만 추가 (RPC 우선 원칙)
    const fallbackResults: Record<string, unknown>[] = naturalResults
      .filter((r) => !rpcIdSet.has(r.document.id))
      .map((r) => ({
        // RPC 응답 shape에 맞춰 필드 매핑
        product_id: r.document.id,
        id: r.document.id,
        name: r.document['name'],
        brand: r.document['brand'],
        category: r.document['category'],
        slug: r.document['slug'],
        // 자연어 폴백 결과임을 표시 (클라이언트에서 무시 가능)
        _source: 'natural_fallback',
      }))

    // 병합: RPC 결과 먼저, 자연어 폴백 결과를 뒤에 추가
    const merged = [...rpcResults, ...fallbackResults].slice(0, limit)

    return json({ results: merged, query: q, page, limit })
  } catch (e) {
    // 자연어 폴백 실패 시 RPC 결과만 반환 (서비스 중단 방지)
    console.error('[search/products] 자연어 폴백 오류:', e)
    return json({ results: rpcResults, query: q, page, limit })
  }
}
