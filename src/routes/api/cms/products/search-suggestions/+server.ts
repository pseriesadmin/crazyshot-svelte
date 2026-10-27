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
// 페이지 모드(2026-10-19, Stephen 확정 — 채팅 상품 검색 무한 스크롤): offset 파라미터가 있으면 켜진다.
//   · 후보는 가벼운 칼럼(이미지·슬러그 제외)으로 최대 PAGED_POOL_MAX(500)건만 한 번 읽어 관련도 정렬 → slice(offset, offset+limit)
//   · 화면에 나갈 페이지의 이미지·슬러그·가격만 추가 조회(스크롤마다 무거운 조회가 반복되지 않게)
//   · 같은 검색어의 정렬 결과는 짧게(PAGED_CACHE_TTL_MS) 메모리에 두어 다음 페이지 조회는 후보 재조회 없이 처리
//   · 응답 본문 형태는 그대로(배열) — 다음 페이지 여부는 헤더 x-has-more('1'|'0')로 알린다. offset이 없으면 기존 동작 100% 동일.
//   · 동의어·자연어 보강은 첫 페이지(offset=0)에서만, 약한 매칭(≤3건)일 때만 — 그 경우 총량이 작아 다음 페이지가 없다.
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
import { productSearchOrFilter, productSearchOrFilterForTerms, resolveProductSearchMatchLabel, relevanceTier } from '$lib/utils/similarNameSuggest'
import { findParentIdsByProductCode } from '$lib/server/products/searchByProductCode'
import { findParentIdsByKeyword } from '$lib/server/products/searchByKeyword'
import { findParentIdsByCompactText } from '$lib/server/products/searchByCompactText'
import { getProductSearchIndex } from '$lib/server/searchEngine/adapters/productSearchIndex'
import { isChosungQuery } from '$lib/server/searchEngine/core/koreanTokenizer'
import { loadSynonymGroups } from '$lib/server/synonymLearning'
import { expandQueryByTokens } from '$lib/server/searchEngine/core/synonymExpander'
import type { RequestHandler } from './$types'
import type { SimilarNameItem } from '$lib/types/cms-similar-name'

// ilike 결과 "약한 매칭" 기준 — 이 건수 이하면 동의어확장 + 자연어 폴백 보강 실행
// (nlsearch.md §2, /api/search/products/+server.ts와 동일 임계값)
const WEAK_MATCH_THRESHOLD = 3

// 페이지 모드 상수 — 후보 최대 500건(Stephen 확정), 한 페이지 최대 40건, 정렬 결과 캐시 20초
const PAGED_POOL_MAX = 500
const PAGED_LIMIT_MAX = 40
const PAGED_CACHE_TTL_MS = 20_000
const PAGED_CACHE_MAX_ENTRIES = 40

type PagedRow = {
  id: string; name: string; brand: string | null; category: string | null; product_code: string | null
  description: string | null; product_caption: string | null
}
const pagedCache = new Map<string, { at: number; rows: PagedRow[]; codeMatchIds: string[]; keywordMatchIds: string[] }>()

// ── GET: 상품 검색 제안 ────────────────────────────────────────────────────────
export const GET: RequestHandler = async ({ url, locals }) => {
  // CMS 인증: 파트너 포함 모든 CMS 역할 허용 (security-auth.md getCmsRoleForAction 패턴)
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) {
    return json({ error: '권한 없음' }, { status: 401 })
  }

  const q         = (url.searchParams.get('q') ?? '').trim()
  // 페이지 모드: offset 파라미터가 있을 때만(없으면 기존 동작 그대로)
  const offsetParam = url.searchParams.get('offset')
  const paged     = offsetParam !== null
  const offset    = paged ? Math.max(0, parseInt(offsetParam ?? '0') || 0) : 0
  const limit     = Math.min(paged ? PAGED_LIMIT_MAX : 20, Math.max(1, parseInt(url.searchParams.get('limit') ?? '8')))
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

  // 동의어 변환어(예: 소니→Sony)도 항상 함께 검색한다 — 일반 검색 결과가 4건 이상이면 아래 폴백이 실행되지 않아
  // 영문 표기 상품이 통째로 빠지던 문제(2026-10-27). 조회 실패 시 원 검색어만 사용.
  let searchTerms: string[] = [q]
  if (q && !isChosung) {
    try {
      const groups = await loadSynonymGroups()
      const expansion = expandQueryByTokens(q, groups)
      searchTerms = [q, ...expansion.whole, ...expansion.tokenVariants]
    } catch (e) {
      console.error('[cms/products/search-suggestions] 동의어 확장 오류:', e)
    }
  }
  const searchOr = productSearchOrFilterForTerms(searchTerms)
  // 동의어 변환어로 맞은 상품은 같은 등급이라도 원 검색어 일치보다 반 등급 뒤
  const tierOf = (row: { name: string; brand: string | null; description: string | null; product_caption: string | null }): number =>
    Math.min(relevanceTier(row, q), ...searchTerms.slice(1).map((t) => relevanceTier(row, t) + 0.5))

  // admin 클라이언트 — products RLS를 우회해 비활성 상품도 조회 가능하게 (CMS 전용)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 페이지 모드(채팅 상품 검색 무한 스크롤) ───────────────────────────────────
  // 후보(최대 500건)를 가벼운 칼럼으로 한 번만 읽어 관련도 정렬한 뒤 offset~offset+limit만 잘라 내려준다.
  // 첫 페이지가 약한 매칭(≤3건)이면 아래 기존 경로(동의어·자연어 보강)로 넘긴다 — 그 경우 총량이 작아 다음 페이지가 없다.
  if (paged) {
    const cacheKey = JSON.stringify([q, category, activeOnly, excludeId])
    const now = Date.now()
    let hit = pagedCache.get(cacheKey)
    if (hit && now - hit.at > PAGED_CACHE_TTL_MS) { pagedCache.delete(cacheKey); hit = undefined }

    if (!hit) {
      let poolCodeIds: string[] = []
      let poolKeywordIds: string[] = []
      let poolQ = admin
        .from('products')
        .select('id, name, brand, category, product_code, description, product_caption')
      if (isChosung) {
        poolQ = poolQ.or(`name_chosung.ilike.%${q}%,brand_chosung.ilike.%${q}%`)
      } else {
        try {
          poolCodeIds = await findParentIdsByProductCode(admin, q)
        } catch (e) {
          console.error('[cms/products/search-suggestions] 품번 검색 오류:', e)
        }
        // 키워드(배열 칼럼)는 ilike로 못 찾으므로 별도 매칭 id를 합친다(실패해도 기본 검색 유지)
        try {
          poolKeywordIds = await findParentIdsByKeyword(admin, q)
        } catch (e) {
          console.error('[cms/products/search-suggestions] 키워드 검색 오류:', e)
        }
        try {
          poolKeywordIds = Array.from(new Set([...poolKeywordIds, ...(await findParentIdsByCompactText(admin, q))]))
        } catch (e) {
          console.error('[cms/products/search-suggestions] 공백 무시 검색 오류:', e)
        }
        const poolExtraIds = Array.from(new Set([...poolCodeIds, ...poolKeywordIds]))
        poolQ = poolQ.or(
          poolExtraIds.length > 0
            ? `${searchOr},id.in.(${poolExtraIds.join(',')})`
            : searchOr
        )
      }
      poolQ = poolQ.is('deleted_at', null).is('parent_product_id', null).order('name').limit(PAGED_POOL_MAX)
      if (category) poolQ = poolQ.eq('category', category)
      if (activeOnly) poolQ = poolQ.eq('is_active', true)
      if (excludeId) poolQ = poolQ.neq('id', excludeId)

      const { data: poolData, error: poolError } = await poolQ
      if (poolError) return json({ error: poolError.message }, { status: 500 })

      const ranked = [...((poolData ?? []) as PagedRow[])].sort((a, b) => {
        const diff = tierOf(a) - tierOf(b)
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ko')
      })
      hit = { at: now, rows: ranked, codeMatchIds: poolCodeIds, keywordMatchIds: poolKeywordIds }
      if (pagedCache.size >= PAGED_CACHE_MAX_ENTRIES) {
        const oldest = pagedCache.keys().next().value
        if (oldest !== undefined) pagedCache.delete(oldest)
      }
      pagedCache.set(cacheKey, hit)
    }

    // 약한 매칭의 첫 페이지는 기존 보강 경로로(아래) — 그 외에는 여기서 끝낸다
    if (offset > 0 || hit.rows.length > WEAK_MATCH_THRESHOLD) {
      const pageRows = hit.rows.slice(offset, offset + limit)
      const hasMore = hit.rows.length > offset + limit
      if (pageRows.length === 0) return json([], { headers: { 'x-has-more': '0' } })

      // 화면에 나가는 페이지의 이미지·슬러그·24시간 가격만 추가 조회(후보 전체가 아니라 최대 limit건)
      const pageIds = pageRows.map((r) => r.id)
      const [{ data: thumbData }, { data: priceData }] = await Promise.all([
        admin.from('products').select('id, image_urls, slug').in('id', pageIds),
        admin.from('price_rules').select('product_id, price').in('product_id', pageIds)
          .eq('duration_type', '24h').is('deleted_at', null).eq('is_active', true),
      ])
      const thumbMap = new Map(((thumbData ?? []) as Array<{ id: string; image_urls: string[] | null; slug: string | null }>).map((r) => [r.id, r]))
      const priceMap = new Map(((priceData ?? []) as Array<{ product_id: string; price: number }>).map((r) => [r.product_id, r.price]))

      const items = pageRows.map((row) => ({
        id: row.id,
        name: row.name,
        brand: row.brand,
        category: row.category,
        product_code: row.product_code,
        match_label: isChosung
          ? '초성 매칭'
          : hit!.codeMatchIds.includes(row.id) && resolveProductSearchMatchLabel(row, q) === '상품'
            ? '품번'
            : hit!.keywordMatchIds.includes(row.id) && resolveProductSearchMatchLabel(row, q) === '상품'
              ? '키워드'
              : resolveProductSearchMatchLabel(row, q),
        image_url: thumbMap.get(row.id)?.image_urls?.[0] ?? null,
        slug: thumbMap.get(row.id)?.slug ?? null,
        price_24h: priceMap.get(row.id) ?? null,
      }))
      return json(items, { headers: { 'x-has-more': hasMore ? '1' : '0' } })
    }
  }

  // ── 1차: ilike 검색 ──────────────────────────────────────────────────────────
  // H-2: 초성 쿼리 시 name_chosung·brand_chosung 생성컬럼, 일반 시 4필드 OR
  // L1 QA Fix: image_urls(썸네일), slug(상품 링크) 추가
  let ilikeQ = admin
    .from('products')
    .select('id, name, brand, category, product_code, description, product_caption, image_urls, slug')
  let codeMatchIds: string[] = []
  let keywordMatchIds: string[] = []

  if (isChosung) {
    // H-2: 초성 생성컬럼 사용 (Migration 354에서 추가된 name_chosung·brand_chosung)
    ilikeQ = ilikeQ.or(`name_chosung.ilike.%${q}%,brand_chosung.ilike.%${q}%`)
  } else {
    // 품번 검색: 부모는 product_code가 없고 '기준 품번'은 code_series 표시값이라 4필드 ilike로는
    // 못 찾는다 — 품번형 검색어(영숫자 5자+)일 때만 그 부모 id를 OR에 합친다(실패해도 기본 검색 유지).
    try {
      codeMatchIds = await findParentIdsByProductCode(admin, q)
    } catch (e) {
      console.error('[cms/products/search-suggestions] 품번 검색 오류:', e)
    }
    // 키워드(배열 칼럼)는 ilike로 못 찾으므로 별도 매칭 id를 합친다(실패해도 기본 검색 유지)
    try {
      keywordMatchIds = await findParentIdsByKeyword(admin, q)
    } catch (e) {
      console.error('[cms/products/search-suggestions] 키워드 검색 오류:', e)
    }
    try {
      keywordMatchIds = Array.from(new Set([...keywordMatchIds, ...(await findParentIdsByCompactText(admin, q))]))
    } catch (e) {
      console.error('[cms/products/search-suggestions] 공백 무시 검색 오류:', e)
    }
    const extraIds = Array.from(new Set([...codeMatchIds, ...keywordMatchIds]))
    ilikeQ = ilikeQ.or(
      extraIds.length > 0
        ? `${searchOr},id.in.(${extraIds.join(',')})`
        : searchOr
    )
  }

  // 정렬을 DB가 아닌 relevanceTier로 다시 매기므로, 후보군은 limit보다 넉넉히 가져와야
  // 진짜 관련도 높은 상품이 후보군 자체에서 빠지는 일이 없다(2026-09-29, 결합상품 검색
  // 자동완성이 8건으로 잘려 패키지 상품에 밀려 안 보이던 결함 — limit 자체도 문제였지만,
  // 정렬 없이 잘랐다는 게 근본 원인이라 여기서 후보군을 확보해 relevanceTier로 재정렬).
  const candidatePoolSize = Math.min(100, Math.max(limit * 5, 50))

  ilikeQ = ilikeQ
    .is('deleted_at', null)
    .is('parent_product_id', null)
    .order('name')
    .limit(candidatePoolSize)

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

  // relevanceTier로 재정렬 후 요청 limit만큼만 최종 노출 — 후보군(candidatePoolSize)은
  // 랭킹 재료일 뿐 화면에 그대로 나가지 않는다.
  const rankedRows = [...ilikeRows].sort((a, b) => {
    const diff = tierOf(a) - tierOf(b)
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ko')
  })
  const limitedRows = rankedRows.slice(0, limit)

  // L1 QA Fix: 확장 아이템 타입 (image_url·slug 포함)
  type ExtendedItem = SimilarNameItem & { image_url: string | null; slug: string | null }

  // ilike 결과를 SimilarNameItem 형태로 변환 (match_label 포함)
  // H-2 초성: match_label에 '초성' 표시
  const matchLabelForChosung = '초성 매칭'
  const ilikeItems: ExtendedItem[] = limitedRows.map((row) => ({
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    product_code: row.product_code,
    match_label: isChosung
      ? matchLabelForChosung
      : codeMatchIds.includes(row.id) && resolveProductSearchMatchLabel(row, q) === '상품'
        ? '품번'
        : keywordMatchIds.includes(row.id) && resolveProductSearchMatchLabel(row, q) === '상품'
          ? '키워드'
          : resolveProductSearchMatchLabel(row, q),
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
      // 단어 단위 치환 변형("소니 카메라" → "Sony 카메라") — MiniSearch에서만 검색(ilike 재조회 없음)
      let tokenVariantTerms: string[] = []
      try {
        const synonymGroups = await loadSynonymGroups()
        const expansion = expandQueryByTokens(q, synonymGroups)
        expandedTerms = expansion.whole
        tokenVariantTerms = expansion.tokenVariants

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

          // 단어 치환 변형을 원문보다 먼저 검색(원문이 limit을 먼저 채워 밀려나는 것 방지). 변형이 없으면 기존 순서 [q, ...확장어]
          for (const qItem of [...tokenVariantTerms, q, ...expandedTerms]) {
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
                // MiniSearch 인덱스에는 image_urls·slug 미포함 → 아래에서 별도 조회해 채움
                image_url: null,
                slug: null,
              })
            }
          }

          // MiniSearch 인덱스 자체에는 image_urls·slug가 없어(storeFields 미포함) 위에서
          // null로 채워졌다 — 이 폴백으로 새로 추가된 항목 id만 모아 단일 조회로 보강한다
          // (2026-09-30, HypePackThemeGroupModal 등 검색 결과 썸네일이 항상 대체 이미지로
          // 뜨던 결함 수정). ilike·동의어 경로는 이미 image_urls를 가져오므로 대상에서 제외.
          const minisearchIds = finalItems
            .filter((it) => it.match_label === '키워드·상세')
            .map((it) => it.id)
          if (minisearchIds.length > 0) {
            const { data: thumbRows } = await admin
              .from('products')
              .select('id, image_urls, slug')
              .in('id', minisearchIds)
            type ThumbRow = { id: string; image_urls: string[] | null; slug: string | null }
            const thumbMap = new Map<string, ThumbRow>(
              ((thumbRows ?? []) as ThumbRow[]).map((r) => [r.id, r])
            )
            finalItems = finalItems.map((item) => {
              if (item.match_label !== '키워드·상세') return item
              const thumb = thumbMap.get(item.id)
              return thumb
                ? { ...item, image_url: thumb.image_urls?.[0] ?? null, slug: thumb.slug ?? null }
                : item
            })
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
    })), paged ? { headers: { 'x-has-more': '0' } } : undefined)
  }

  return json(finalItems, paged ? { headers: { 'x-has-more': '0' } } : undefined)
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
