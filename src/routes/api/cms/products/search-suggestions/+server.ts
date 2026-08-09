// GET /api/cms/products/search-suggestions?q=&limit=&activeOnly=
// CMS 상품 검색 제안 API — 하이브리드: ilike OR(4필드) 1차 + MiniSearch 자연어 폴백
//
// 설계 원칙 (nlsearch.md §2, TASK.md §K 핵심제약):
//   1차: productSearchOrFilter() ilike(name/brand/description/product_caption 4필드) — 항상 우선
//   2차 (폴백): getProductSearchIndex() MiniSearch — ilike 결과 WEAK_MATCH_THRESHOLD(3건) 이하일 때만 보강
//              keywords/components/specs/content_blocks 텍스트도 검색 대상에 포함됨
//   dedupe: product id 기준 중복 제거 (ilike 결과 우선 유지)
//   필터: parent_product_id IS NULL + deleted_at IS NULL (부모·미삭제 상품만)
//         is_active 필터는 activeOnly=true 파라미터로만 적용 (CMS 검색은 기본적으로 비활성 상품도 표시)
//
// 인증: CMS 세션 필수 (getCmsRoleForAction — 파트너 포함 모든 CMS 역할 허용)

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { productSearchOrFilter, resolveProductSearchMatchLabel } from '$lib/utils/similarNameSuggest'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import type { RequestHandler } from './$types'
import type { SimilarNameItem } from '$lib/types/cms-similar-name'

// ilike 결과 "약한 매칭" 기준 — 이 건수 이하면 자연어 폴백 보강 실행
// (nlsearch.md §2, /api/search/products/+server.ts와 동일 임계값)
const WEAK_MATCH_THRESHOLD = 3

export const GET: RequestHandler = async ({ url, locals }) => {
  // CMS 인증: 파트너 포함 모든 CMS 역할 허용 (security-auth.md getCmsRoleForAction 패턴)
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const q         = (url.searchParams.get('q') ?? '').trim()
  const limit     = Math.min(20, Math.max(1, parseInt(url.searchParams.get('limit') ?? '8')))
  const activeOnly = url.searchParams.get('activeOnly') === 'true'
  const excludeId  = url.searchParams.get('excludeId') || null

  // 빈 쿼리는 빈 배열 반환 (디바운스 이전 호출 방어)
  if (!q) {
    return json([])
  }

  // admin 클라이언트 — products RLS를 우회해 비활성 상품도 조회 가능하게 (CMS 전용)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 1차: ilike 4필드 OR 검색 (기존 productSearchOrFilter 로직 그대로) ────────
  let ilikeQ = admin
    .from('products')
    .select('id, name, brand, category, product_code, description, product_caption')
    .or(productSearchOrFilter(q))
    .is('deleted_at', null)
    .is('parent_product_id', null)
    .order('name')
    .limit(limit)

  if (activeOnly) ilikeQ = ilikeQ.eq('is_active', true)
  if (excludeId)  ilikeQ = ilikeQ.neq('id', excludeId)

  const { data: ilikeData, error: ilikeError } = await ilikeQ

  if (ilikeError) {
    return json({ error: ilikeError.message }, { status: 500 })
  }

  type ProductRow = {
    id: string
    name: string
    brand: string | null
    category: string | null
    product_code: string | null
    description: string | null
    product_caption: string | null
  }

  const ilikeRows = (ilikeData ?? []) as ProductRow[]

  // ilike 결과를 SimilarNameItem 형태로 변환 (match_label 포함)
  const ilikeItems: SimilarNameItem[] = ilikeRows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    product_code: row.product_code,
    match_label: resolveProductSearchMatchLabel(row, q),
  }))

  // ilike 결과가 충분하면 자연어 폴백 없이 반환
  const shouldFallback = ilikeRows.length <= WEAK_MATCH_THRESHOLD

  if (!shouldFallback) {
    return json(ilikeItems)
  }

  // ── 2차: MiniSearch 자연어 폴백 (ilike 결과 약할 때만 보강) ───────────────────
  // (getProductSearchIndex는 is_active=true·deleted_at IS NULL·parent_product_id IS NULL 필터 내장)
  try {
    const index = await getProductSearchIndex()
    const naturalResults = index.search(q, {
      fuzzy: 0.2,
      prefix: true,
      limit: limit * 2, // dedupe 여유분 확보
    })

    if (naturalResults.length === 0) {
      return json(ilikeItems)
    }

    // ilike 결과 id 집합 (dedupe 기준)
    const ilikeIdSet = new Set(ilikeRows.map((r) => r.id))

    // ilike 결과에 없는 자연어 결과만 추가 (ilike 우선 원칙)
    const fallbackItems: SimilarNameItem[] = naturalResults
      .filter((r) => !ilikeIdSet.has(r.document.id))
      .map((r) => ({
        id: r.document.id,
        name: String(r.document['name'] ?? ''),
        brand: (r.document['brand'] as string | null) || null,
        category: (r.document['category'] as string | null) || null,
        product_code: null, // productSearchIndex storeFields에 product_code 없음 → null
        match_label: '키워드·상세', // NLSearch 폴백 전용 레이블 (keywords/specs/components 매칭)
      }))

    // 병합: ilike 결과 먼저, 자연어 폴백 뒤에 추가
    const merged = [...ilikeItems, ...fallbackItems].slice(0, limit)

    return json(merged)
  } catch (e) {
    // 자연어 폴백 실패 시 ilike 결과만 반환 (서비스 중단 방지)
    console.error('[cms/products/search-suggestions] 자연어 폴백 오류:', e)
    return json(ilikeItems)
  }
}
