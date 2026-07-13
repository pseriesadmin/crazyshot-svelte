// GET /api/search/products?q=&category=&page=&limit=
// 통합 검색 API — search_products RPC 경유 (FTS + trgm + AI CTR 부스트)
// anon 클라이언트 사용 (공개 검색) — service_role 불필요
// RLS: products 공개 읽기, search_logs INSERT는 SECURITY DEFINER RPC 내부 처리

import { json, error as httpError } from '@sveltejs/kit'
import { supabase } from '$lib/services/supabase'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const q        = (url.searchParams.get('q') ?? '').trim()
  const category = url.searchParams.get('category') || null
  const page     = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit    = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20')))

  const { data: { session } } = await supabase.auth.getSession()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('search_products', {
    p_query:      q.length >= 1 ? q : null,
    p_category:   category,
    p_page:       page,
    p_limit:      limit,
    p_session_id: session?.user?.id ?? null,
    p_user_id:    session?.user?.id ?? null,
  })

  if (error) return httpError(500, error.message)
  return json({ results: data ?? [], query: q, page, limit })
}
