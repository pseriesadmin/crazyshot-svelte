// collect.ts — AI 조력 생성기 입력 수집(서버 전용): 검수 완료 빠른답변 + 상품 색인 용어 + 마스킹한 최근 고객 질문
// 고객 원문은 이 함수 안에서 마스킹된 뒤에만 반환되고, 어디에도 저장하지 않는다.
import type { CannedResponseForMatch } from '$lib/server/matchCannedResponse'
import type { AdminClient } from '../shared'
import type { AssistInput } from './infer'
import { isSafeToSend, maskPersonalInfo } from './mask'

const QUESTION_LIMIT = 80
const QUESTION_DAYS = 30

export interface CollectedAssist { input: AssistInput; faqsForMatch: CannedResponseForMatch[] }

export async function collectAssistInput(admin: AdminClient): Promise<CollectedAssist> {
  const sinceIso = new Date(Date.now() - QUESTION_DAYS * 24 * 3600_000).toISOString()
  const [canned, products, cands] = await Promise.all([
    admin.from('canned_responses').select('id, title, content, category, shortcut, match_keywords, usage_count').eq('pending_review', false).limit(300),
    admin.from('products').select('name, brand').is('parent_product_id', null).eq('is_active', true).is('deleted_at', null).limit(400),
    admin.from('chat_reply_candidates').select('customer_message').gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(QUESTION_LIMIT * 2),
  ])
  if (canned.error) throw new Error(canned.error.message)
  type Row = { id: string; title: string | null; content: string | null; category: string | null; shortcut: string | null; match_keywords: string[] | null; usage_count: number | null }
  const faqsForMatch: CannedResponseForMatch[] = ((canned.data ?? []) as Row[]).map((r) => ({
    id: r.id, title: r.title ?? '', content: r.content ?? '', category: r.category, shortcut: r.shortcut, match_keywords: r.match_keywords ?? [], usage_count: r.usage_count ?? 0,
  }))
  const terms = new Set<string>()
  for (const p of (products.data ?? []) as { name: string | null; brand: string | null }[]) {
    for (const w of `${p.brand ?? ''} ${p.name ?? ''}`.split(/\s+/)) if (w.length >= 2 && w.length <= 20) terms.add(w)
  }
  const questions = ((cands.data ?? []) as { customer_message: string | null }[])
    .map((c) => maskPersonalInfo(c.customer_message ?? '').slice(0, 120))
    .filter((q) => q.length >= 4 && isSafeToSend(q))
    .slice(0, QUESTION_LIMIT)
  return {
    faqsForMatch,
    input: {
      faqs: faqsForMatch.map((f) => ({ id: f.id.slice(0, 8), title: f.title, content: f.content, keywords: f.match_keywords })),
      productTerms: [...terms].slice(0, 120),
      questions,
    },
  }
}
