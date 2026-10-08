// build.ts — 지식 저장소 정리 작업 오케스트레이터(서버 전용). 재료 로더와 저장소는 주입해 테스트한다.
// 한 재료가 실패해도 나머지는 계속 만들고, 실패한 재료는 이전 저장분을 그대로 둔다.
import { buildFaqDigest, buildProductDigest, buildReservationDigest, buildReviewDigest, digestHash, type FaqRow, type KnowledgeSource, type ProductRow, type ReservationRow, type ReviewRow } from './digest'

export type { KnowledgeSource }
export const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = ['faq', 'product', 'review', 'reservation']

export interface KnowledgeStore {
  getHash(key: KnowledgeSource): Promise<string | null>
  upsert(key: KnowledgeSource, v: { digest: unknown; hash: string; itemCount: number; builtAt: string; buildMs: number; changed: boolean }): Promise<void>
  recordRun(r: { startedAt: string; finishedAt: string; ok: boolean; sources: SourceResult[] }): Promise<void>
}
export interface KnowledgeLoaders {
  faq(): Promise<FaqRow[]>
  product(): Promise<ProductRow[]>
  review(): Promise<ReviewRow[]>
  reservation(): Promise<ReservationRow[]>
}
export interface SourceResult { source: KnowledgeSource; status: 'updated' | 'unchanged' | 'error'; itemCount: number; buildMs: number; error?: string }
export interface BuildResult { ok: boolean; sources: SourceResult[] }

export async function runKnowledgeBuild(a: { loaders: KnowledgeLoaders; store: KnowledgeStore; now: () => Date }): Promise<BuildResult> {
  const startedAt = a.now().toISOString()
  const sources: SourceResult[] = []
  for (const source of KNOWLEDGE_SOURCES) {
    const t0 = Date.now()
    try {
      let digest: unknown
      let itemCount = 0
      if (source === 'faq') { const rows = await a.loaders.faq(); digest = buildFaqDigest(rows); itemCount = rows.length }
      else if (source === 'product') { const rows = await a.loaders.product(); digest = buildProductDigest(rows); itemCount = rows.length }
      else if (source === 'review') { const rows = await a.loaders.review(); digest = buildReviewDigest(rows); itemCount = rows.length }
      else { const rows = await a.loaders.reservation(); digest = buildReservationDigest(rows, a.now()); itemCount = rows.length }
      const hash = digestHash(digest)
      const prev = await a.store.getHash(source)
      const changed = prev !== hash
      await a.store.upsert(source, { digest, hash, itemCount, builtAt: a.now().toISOString(), buildMs: Date.now() - t0, changed })
      sources.push({ source, status: changed ? 'updated' : 'unchanged', itemCount, buildMs: Date.now() - t0 })
    } catch (e) {
      sources.push({ source, status: 'error', itemCount: 0, buildMs: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 200) : '알 수 없는 오류' })
    }
  }
  const ok = sources.every((s) => s.status !== 'error')
  try { await a.store.recordRun({ startedAt, finishedAt: a.now().toISOString(), ok, sources }) } catch { /* 실행 기록 실패는 작업 결과를 바꾸지 않는다 */ }
  return { ok, sources }
}
