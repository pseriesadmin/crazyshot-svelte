// GET /api/cms/products/search-suggestions?q=&limit=&activeOnly=&category=&excludeId=
// POST /api/cms/products/search-suggestions  { product_id, search_term, context }
//
// CMS 상품 검색 제안 API — 하이브리드: ilike OR(4필드) 1차 + 동의어확장 2차 + MiniSearch 자연어 폴백
//
// 설계 원칙 (nlsearch.md §2, TASK.md §H·§I 핵심제약):
//   1차: productSearchOrFilter() ilike(name/brand/description/product_caption 4필드) — 항상 우선
//        H-2: 초성 쿼리(isChosungQuery) 시 name_chosung/brand_chosung 생성컬럼으로 전환
//        H-1: category 파라미터 지정 시 ilike + MiniSearch 결과를 해당 카테고리로 필터
//   2차 (동의어확장, H-3): 약한 매칭 시 confirmed 동의어로 확장해 ilike 재조회
//        (§E-2 패턴 포팅 — /api/search/products/+server.ts와 동일 로직)
//   3차 (폴백): getProductSearchIndex() MiniSearch — 여전히 약할 때만 보강
//              keywords/components/specs/content_blocks 텍스트도 검색 대상에 포함됨
//        초성 쿼리는 MiniSearch/동의어 확장 스킵 (인덱스에 초성 컬럼 없음)
//   dedupe: product id 기준 중복 제거 (ilike 결과 우선 유지)
//   필터: parent_product_id IS NULL + deleted_at IS NULL (부모·미삭제 상품만)
//         is_active 필터는 activeOnly=true 파라미터로만 적용 (CMS 검색은 기본적으로 비활성 상품도 표시)
//
// POST: 관리자 검색→선택 확인 신호 저장 (§I 학습파이프라인)
//   record_admin_search_confirmation RPC 호출 (SECURITY DEFINER, service_role 전용)
//
// 인증: CMS 세션 필수 (getCmsRoleForAction — 파트너 포함 모든 CMS 역할 허용)

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { productSearchOrFilter, resolveProductSearchMatchLabel } from '$lib/utils/similarNameSuggest'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { isChosungQuery } from '$lib/server/searchEngine/core/koreanTokenizer'
import { loadSynonymGroups } from '$lib/server/synonymLearning'
import { expandQueryWithConfirmedSynonyms } from '$lib/server/searchEngine/core/synonymExpander'
import type { RequestHandler } from './$types'
import type { SimilarNameItem } from '$lib/types/cms-similar-name'

// ilike 결과 "약한 매칭" 기준 — 이 건수 이하면 동의어확장 + 자연어 폴백 보강 실행
// (nlsearch.md §2, /api/search/products/+server.ts와 동일 임계값)
const WEAK_MATCH_THRESHOLD = 3

// ── GET: 상품 검색 제안 ────────────────────────────────────────────────────────
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
  // H-1: 카테고리 필터 (선택) — 지정 시 ilike/MiniSearch 결과를 해당 카테고리로 제한
  const category  = url.searchParams.get('category') || null

  // 빈 쿼리는 빈 배열 반환 (디바운스 이전 호출 방어)
  if (!q) {
    return json([])
  }

  // H-2: 초성 쿼리 감지 — 전부 자음(ㄱ-ㅎ)으로만 이뤄진 검색어
  const isChosung = isChosungQuery(q)

  // admin 클라이언트 — products RLS를 우회해 비활성 상품도 조회 가능하게 (CMS 전용)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 1차: ilike 검색 ──────────────────────────────────────────────────────────
  // H-2: 초성 쿼리 시 name_chosung·brand_chosung 생성컬럼, 일반 시 4필드 OR
  // L1 QA Fix: image_urls(썸네일), slug(상품 링크) 추가
  let ilikeQ = admin
    .from('products')
    .select('id, name, brand, category, product_code, description, product_caption, image_urls, slug')

  if (isChosung) {
    // H-2: 초성 생성컬럼 사용 (Migration 354에서 추가된 name_chosung·brand_chosung)
    ilikeQ = ilikeQ.or(`name_chosung.ilike.%${q}%,brand_chosung.ilike.%${q}%`)
  } else {
    ilikeQ = ilikeQ.or(productSearchOrFilter(q))
  }

  ilikeQ = ilikeQ
    .is('deleted_at', null)
    .is('parent_product_id', null)
    .order('name')
    .limit(limit)

  // H-1: category 필터
  if (category) ilikeQ = ilikeQ.eq('category', category)
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
    // L1 QA Fix: 이미지·슬러그 추가 (@ 멘션 product_link 썸네일용)
    image_urls: string[] | null
    slug: string | null
  }

  const ilikeRows = (ilikeData ?? []) as ProductRow[]

  // L1 QA Fix: 확장 아이템 타입 (image_url·slug 포함)
  type ExtendedItem = SimilarNameItem & { image_url: string | null; slug: string | null }

  // ilike 결과를 SimilarNameItem 형태로 변환 (match_label 포함)
  // H-2 초성: match_label에 '초성' 표시
  const matchLabelForChosung = '초성 매칭'
  const ilikeItems: ExtendedItem[] = ilikeRows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    product_code: row.product_code,
    match_label: isChosung ? matchLabelForChosung : resolveProductSearchMatchLabel(row, q),
    // L1: Cloudinary public_id = image_urls[0], slug = URL에 사용될 슬러그
    image_url: (row.image_urls as string[] | null)?.[0] ?? null,
    slug: row.slug ?? null,
  }))

  // ilike 결과가 충분하면 자연어 폴백 없이 반환
  const shouldFallback = ilikeRows.length <= WEAK_MATCH_THRESHOLD

  let finalItems: ExtendedItem[] = [...ilikeItems]

  if (shouldFallback) {
    // 초성 쿼리는 동의어확장·MiniSearch 스킵 (인덱스·동의어 테이블에 초성 컬럼 없음)
    if (!isChosung) {
      const seenIds = new Set(ilikeItems.map((r) => r.id))

      // ── 2차: H-3 동의어 확장 (§E-2 패턴 포팅) ─────────────────────────────
      let expandedTerms: string[] = []
      try {
        const synonymGroups = await loadSynonymGroups()
        expandedTerms = expandQueryWithConfirmedSynonyms(q, synonymGroups)

        for (const expandedQ of expandedTerms) {
          if (finalItems.length >= limit) break

          let expQ = admin
            .from('products')
            .select('id, name, brand, category, product_code, description, product_caption, image_urls, slug')
            .or(productSearchOrFilter(expandedQ))
            .is('deleted_at', null)
            .is('parent_product_id', null)
            .order('name')
            .limit(limit)

          if (category) expQ = expQ.eq('category', category)
          if (activeOnly) expQ = expQ.eq('is_active', true)
          if (excludeId) expQ = expQ.neq('id', excludeId)

          const { data: expData } = await expQ
          for (const row of (expData ?? []) as ProductRow[]) {
            if (!seenIds.has(row.id)) {
              seenIds.add(row.id)
              finalItems.push({
                id: row.id,
                name: row.name,
                brand: row.brand ?? null,
                category: row.category ?? null,
                product_code: row.product_code ?? null,
                match_label: `동의어(${expandedQ})`,
                image_url: (row.image_urls as string[] | null)?.[0] ?? null,
                slug: row.slug ?? null,
              })
            }
          }
        }
      } catch {
        // 동의어 확장 실패 시 현재 결과 유지 — 서비스 중단 없음
      }

      // ── 3차: MiniSearch 자연어 폴백 (여전히 부족하면) ─────────────────────
      // (getProductSearchIndex는 is_active=true·deleted_at IS NULL·parent_product_id IS NULL 필터 내장)
      if (finalItems.length < limit) {
        try {
          const index = await getProductSearchIndex()

          // 원래 쿼리 + 확장어 전부 MiniSearch에서 검색 (§E-2 패턴과 동일)
          for (const qItem of [q, ...expandedTerms]) {
            if (finalItems.length >= limit) break

            const naturalResults = index.search(qItem, {
              fuzzy: 0.2,
              prefix: true,
              limit: limit * 2, // dedupe 여유분 확보
            })

            for (const r of naturalResults) {
              if (finalItems.length >= limit) break
              if (seenIds.has(r.document.id)) continue
              // H-1: MiniSearch 결과도 category 필터 적용
              if (category && r.document['category'] !== category) continue
              seenIds.add(r.document.id)
              finalItems.push({
                id: r.document.id,
                name: String(r.document['name'] ?? ''),
                brand: (r.document['brand'] as string | null) || null,
                category: (r.document['category'] as string | null) || null,
                product_code: null, // productSearchIndex storeFields에 product_code 없음 → null
                match_label: '키워드·상세', // NLSearch 폴백 전용 레이블
                // MiniSearch 인덱스에는 image_urls·slug 미포함 → null
                image_url: null,
                slug: null,
              })
            }
          }
        } catch (e) {
          // 자연어 폴백 실패 시 현재까지 병합된 결과만 반환 (서비스 중단 방지)
          console.error('[cms/products/search-suggestions] 자연어 폴백 오류:', e)
        }
      }
    }

    finalItems = finalItems.slice(0, limit)
  }

  // L1 QA Fix: 24시간 가격 조회 및 병합 (@ 멘션 product_link 가격 표시용)
  if (finalItems.length > 0) {
    const finalIds = finalItems.map((r) => r.id)
    const { data: priceData } = await admin
      .from('price_rules')
      .select('product_id, price')
      .in('product_id', finalIds)
      .eq('duration_type', '24h')
      .is('deleted_at', null)
      .eq('is_active', true)

    type PriceRow = { product_id: string; price: number }
    const priceMap = new Map<string, number>(
      (priceData ?? []).map((pr) => [(pr as PriceRow).product_id, (pr as PriceRow).price])
    )

    return json(finalItems.map((item) => ({
      ...item,
      price_24h: priceMap.get(item.id) ?? null,
    })))
  }

  return json(finalItems)
}

// ── POST: 관리자 검색→상품 선택 확인 신호 저장 (§I 학습파이프라인) ──────────
// fire-and-forget 패턴 — 모달의 onProductSelect()에서 await 없이 호출됨
// record_admin_search_confirmation RPC: UPSERT + 임계값(3회) 도달 시 즉시 'confirmed' 승격
export const POST: RequestHandler = async ({ request, locals }) => {
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 401 })

  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '세션 없음' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청 본문' }, { status: 400 })
  }

  const { product_id, search_term, context } = body
  if (!product_id || !search_term) {
    return json({ error: 'product_id, search_term 필수' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { error: rpcError } = await admin.rpc('record_admin_search_confirmation', {
    p_product_id:  String(product_id),
    p_search_term: String(search_term),
    p_admin_id:    session.user.id,
    p_context:     String(context ?? 'cms'),
  })

  if (rpcError) return json({ error: rpcError.message }, { status: 500 })
  return json({ ok: true })
}
