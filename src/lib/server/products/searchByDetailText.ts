import type { SupabaseClient } from '@supabase/supabase-js'
import { extractContentBlocksText, extractJsonbKeyValues } from '$lib/server/searchEngine/adapters/productSearchDocs'

/**
 * CMS 상품목록 상세설명·구성품·사양 검색 (2026-10-27)
 * 이 세 칸(content_blocks·components·specifications)은 JSONB라 PostgREST or(ilike)로 부분일치할 수 없어,
 * 기존에는 검색 결과가 적을 때(3개 이하)만 NLSearch 자연어 보강으로 반영됐다. 키워드·공백무시 검색과 같은 방식으로
 * 부모 상품의 텍스트를 뽑아 서버에서 대소문자 무시 부분일치로 비교하고, 해당 부모 id를 목록 필터에 합친다(DB 변경 없음).
 * 상세설명은 JSON이 커서 검색할 때마다 읽지 않도록 60초 모듈 캐시를 둔다(조회 오류는 캐시하지 않는다).
 */

type DetailRow = { id: string; content_blocks: unknown; components: unknown; specifications: unknown }

/** 한 상품당 비교 텍스트 상한 — 비정상적으로 긴 상세설명이 메모리를 키우지 않게 */
const MAX_TEXT_CHARS = 30_000
/** 이보다 짧은 검색어는 비교하지 않는다(한 글자는 거의 모든 상품에 맞아 의미가 없다) */
const MIN_QUERY_LENGTH = 2
const CACHE_TTL_MS = 60_000
const PAGE = 1000
/** PostgREST id.in.(...) URL 길이 보호 */
const MAX_IDS = 100

/** 상세설명(HTML 제거)·구성품·사양을 한 문자열로 합친다 */
export function detailSearchText(r: Omit<DetailRow, 'id'>): string {
  return [extractContentBlocksText(r.content_blocks), extractJsonbKeyValues(r.components), extractJsonbKeyValues(r.specifications)]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_TEXT_CHARS)
}

/** 행 목록에서 검색어(대소문자 무시, 공백 정리)가 상세설명·구성품·사양에 들어 있는 부모 id */
export function matchParentIdsByDetailText(rows: DetailRow[], q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (needle.length < MIN_QUERY_LENGTH) return []
  const ids: string[] = []
  for (const r of rows) {
    if (detailSearchText(r).toLowerCase().includes(needle)) ids.push(r.id)
  }
  return ids
}

let cache: { rows: DetailRow[]; at: number } | null = null

export function resetDetailTextCache(): void {
  cache = null
}

async function loadRows(admin: SupabaseClient): Promise<DetailRow[] | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows
  const all: DetailRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('products')
      .select('id, content_blocks, components, specifications')
      .is('parent_product_id', null)
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error || !data) return null // 오류는 캐시하지 않고 호출 측이 기본 검색만 쓰게 한다
    all.push(...(data as DetailRow[]))
    if (data.length < PAGE) break
  }
  cache = { rows: all, at: Date.now() }
  return all
}

export async function findParentIdsByDetailText(admin: SupabaseClient, q: string): Promise<string[]> {
  if (q.trim().length < MIN_QUERY_LENGTH) return []
  const rows = await loadRows(admin)
  if (!rows) return []
  return matchParentIdsByDetailText(rows, q).slice(0, MAX_IDS)
}
