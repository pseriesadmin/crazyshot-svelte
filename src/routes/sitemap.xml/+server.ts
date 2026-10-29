// GET /sitemap.xml (2026-10-28) — 검색·AI 검색용 사이트맵: 고정 공개 페이지 + 노출 중인 부모 상품.
// 상품 조회는 검색 색인과 같은 조건(부모·활성·옵션전용 아님·삭제 안 됨)이고, 실패해도 고정 페이지는 내려준다(fail-soft).
// 공개 조회만 쓰므로 anon 클라이언트를 사용한다(products RLS가 부모+활성+미삭제만 노출).

import { supabase } from '$lib/services/supabase'
import { STATIC_SITEMAP_PATHS, buildSitemapXml, type SitemapEntry } from '$lib/utils/seoMeta'
import type { RequestHandler } from './$types'

const PRODUCT_LIMIT = 5000

export const GET: RequestHandler = async () => {
  const entries: SitemapEntry[] = STATIC_SITEMAP_PATHS.map((path) => ({ path }))

  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, slug, updated_at')
      .is('parent_product_id', null)
      .eq('is_active', true)
      .eq('option_only', false)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(PRODUCT_LIMIT)
    if (!error) {
      for (const row of (data ?? []) as { id: string; slug: string | null; updated_at: string | null }[]) {
        entries.push({ path: `/products/${row.slug ?? row.id}`, lastmod: row.updated_at })
      }
    } else {
      console.error('[sitemap] 상품 조회 실패:', error.message)
    }
  } catch (e) {
    console.error('[sitemap] 상품 조회 오류:', e instanceof Error ? e.message : String(e))
  }

  return new Response(buildSitemapXml(entries), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
