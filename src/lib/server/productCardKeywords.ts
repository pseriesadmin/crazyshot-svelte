// 고객 화면 상품 카드 노출 키워드 일괄 조회 — 화면에 내려가는 상품 id 묶음으로 1회만 조회한다(N+1 금지).
// 공개 읽기는 products_public_read(노출 중인 부모 상품만) 정책이 막아 준다. 실패해도 화면은 키워드 없이 정상 표시(fail-soft).
import { parseCardKeywords } from '$lib/utils/cardKeywords'

export const MAX_CARD_KEYWORD_PRODUCT_IDS = 200

export type CardKeywordMap = Record<string, string[]>

interface QueryClient {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, ids: string[]) => PromiseLike<{ data: unknown; error: unknown }>
    }
  }
}

export async function loadCardKeywordMap(client: unknown, productIds: Array<string | null | undefined>): Promise<CardKeywordMap> {
  const ids = [...new Set(productIds.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(0, MAX_CARD_KEYWORD_PRODUCT_IDS)
  if (ids.length === 0) return {}
  try {
    const { data, error } = await (client as QueryClient).from('products').select('id, card_keywords').in('id', ids)
    if (error || !Array.isArray(data)) return {}
    const map: CardKeywordMap = {}
    for (const r of data as Array<{ id: string; card_keywords: unknown }>) {
      const kws = parseCardKeywords(r.card_keywords)
      if (kws.length > 0) map[r.id] = kws
    }
    return map
  } catch {
    return {}
  }
}
