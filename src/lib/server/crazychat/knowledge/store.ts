// store.ts — 지식 저장소 Supabase 구현(서버 전용, service_role). crazychat_knowledge / crazychat_knowledge_runs (Migration #680)
import type { AdminClient } from '../shared'
import type { KnowledgeLoaders, KnowledgeStore } from './build'
import { resolveParentIds, type FaqDigest, type KnowledgeSource, type ProductDigest, type ReservationDigest, type ReservationRow, type ReviewDigest } from './digest'
import type { KnowledgeSnapshot } from './read'

const fail = (e: { message: string } | null): void => { if (e) throw new Error(e.message) }
const PAGE = 1000
const MAX_RESERVATIONS = 50_000

export function createKnowledgeStore(admin: AdminClient): KnowledgeStore {
  return {
    async getHash(key) {
      const { data, error } = await admin.from('crazychat_knowledge').select('content_hash').eq('source', key).maybeSingle()
      fail(error)
      return data ? (data as { content_hash: string }).content_hash : null
    },
    async upsert(key, v) {
      const row: Record<string, unknown> = { source: key, digest: v.digest, content_hash: v.hash, item_count: v.itemCount, built_at: v.builtAt, build_ms: v.buildMs, updated_at: v.builtAt }
      if (v.changed) row.changed_at = v.builtAt
      const { error } = await admin.from('crazychat_knowledge').upsert(row, { onConflict: 'source' })
      fail(error)
    },
    async recordRun(r) {
      const { error } = await admin.from('crazychat_knowledge_runs').insert({ started_at: r.startedAt, finished_at: r.finishedAt, ok: r.ok, sources: r.sources })
      fail(error)
    },
  }
}

async function paged<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, max: number): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1)
    fail(error)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export function createKnowledgeLoaders(admin: AdminClient): KnowledgeLoaders {
  return {
    faq: () => paged((f, t) => admin.from('canned_responses').select('id, title, category, shortcut, match_keywords, usage_count').eq('pending_review', false).order('created_at').range(f, t), 5000),
    // 검색 색인과 같은 조건(부모·활성·옵션전용 제외·미삭제)
    product: () => paged((f, t) => admin.from('products')
      .select('id, name, brand, category, keywords, product_caption, specifications, components, sale_only')
      .is('parent_product_id', null).eq('is_active', true).eq('option_only', false).is('deleted_at', null).order('created_at').range(f, t), 5000),
    review: () => paged((f, t) => admin.from('product_reviews').select('product_id, title, content').eq('is_public', true).order('created_at').range(f, t), 10_000),
    reservation: async () => {
      const rows = await paged<ReservationRow>((f, t) => admin.from('rental_reservations').select('status, pickup_method, return_method, duration_type, start_date, end_date, created_at, product_id').order('created_at').range(f, t), MAX_RESERVATIONS)
      // 예약의 product_id는 재고 단위(자식)라서 부모 상품 id로 합쳐 인기 집계가 상품 단위가 되게 한다
      const ids = [...new Set(rows.map((r) => (r.product_id === undefined || r.product_id === null ? null : String(r.product_id))).filter((x): x is string => !!x))]
      const parentOf = new Map<string, string | null>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await admin.from('products').select('id, parent_product_id').in('id', ids.slice(i, i + 200))
        fail(error)
        for (const p of (data ?? []) as { id: string; parent_product_id: string | null }[]) parentOf.set(p.id, p.parent_product_id)
      }
      return resolveParentIds(rows, parentOf)
    },
  }
}

/** 에이전트가 쓰는 읽기 입구: 저장된 요약본 4종을 한 번에 읽는다(없으면 null) */
export async function loadKnowledgeSnapshot(admin: AdminClient): Promise<KnowledgeSnapshot & { builtAt: Partial<Record<KnowledgeSource, string>> }> {
  const { data, error } = await admin.from('crazychat_knowledge').select('source, digest, built_at')
  fail(error)
  const snap: KnowledgeSnapshot & { builtAt: Partial<Record<KnowledgeSource, string>> } = { faq: null, product: null, review: null, reservation: null, builtAt: {} }
  for (const r of (data ?? []) as { source: KnowledgeSource; digest: unknown; built_at: string }[]) {
    if (r.source === 'faq') snap.faq = r.digest as FaqDigest
    else if (r.source === 'product') snap.product = r.digest as ProductDigest
    else if (r.source === 'review') snap.review = r.digest as ReviewDigest
    else if (r.source === 'reservation') snap.reservation = r.digest as ReservationDigest
    snap.builtAt[r.source] = r.built_at
  }
  return snap
}
