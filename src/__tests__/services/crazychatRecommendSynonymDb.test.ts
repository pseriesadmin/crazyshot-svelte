/**
 * TDD: crazychatRecommendSynonymDb.test.ts — 크레이지챗 추천 검색의 동의어 확장 + 관찰 메트릭 (Stage 전용, M-3·M-7)
 * 핵심: 확정 동의어로 연결된 한글 별칭 질문이 영문 상품을 찾고(없으면 못 찾음) / 실제 DB의 확정 그룹을 읽는 경로도 동작하며 /
 *       관찰 모드 기록에 점수·후보 상품 id·사용한 하한·확장 여부가 저장되고 고객에게는 아무것도 가지 않는다.
 * 모든 행은 이 테스트가 만든 합성 데이터이며 스스로 정리한다(기존 Stage 데이터 삭제 금지).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))
import { runCrazychatRecommend, RECOMMEND_MIN_SCORE } from '$lib/server/crazychat/recommend-runner'
import { createRecommendSearcher } from '$lib/server/crazychat/recommend-search'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'
import { invalidateProductSearchCache } from '$lib/server/searchEngine/adapters/productSearchIndex'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.().catch(() => undefined) })

const observeSettings: CrazychatSettings = { ...ALL_OFF, agentEnabled: true, recommend: { enabled: false, observe: true } }
const rand = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 추천 카드가 될 수 있는 Stage 상품(활성 부모·대여용·24h 가격 있음) 중 이름에 영문 단어가 있는 것 하나 */
async function pickLatinProduct(): Promise<{ id: string; latin: string }> {
  const { data, error } = await admin
    .from('products')
    .select('id, name')
    .is('parent_product_id', null).is('deleted_at', null)
    .eq('is_active', true).eq('sale_only', false).eq('option_only', false)
    .order('created_at', { ascending: true })
    .limit(80)
  if (error || !data) throw new Error(`상품 조회 실패: ${error?.message}`)
  const ids = (data as Array<{ id: string }>).map((p) => p.id)
  const { data: prices } = await admin.from('price_rules').select('product_id').in('product_id', ids).eq('duration_type', '24h').eq('is_active', true).is('deleted_at', null).gt('price', 0)
  const priced = new Set((prices ?? []).map((p) => (p as { product_id: string }).product_id))
  for (const p of data as Array<{ id: string; name: string }>) {
    if (!priced.has(p.id)) continue
    const word = p.name.split(/[\s\-_/]+/).find((w) => /^[A-Za-z]{4,}$/.test(w))
    if (word) return { id: p.id, latin: word.toLowerCase() }
  }
  throw new Error('이름에 영문 단어가 있는 Stage 대여 상품이 없습니다')
}

async function setupChat(): Promise<{ userId: string; sessionId: string; messageId: string }> {
  const email = `tdd-crazychat-syn-${rand()}@example.com`
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
  if (error || !data.user) throw new Error(`사용자 생성 실패: ${error?.message}`)
  const userId = data.user.id
  const { data: sess, error: se } = await admin.from('chat_sessions').insert({ user_id: userId, status: 'open', context_type: 'general' }).select('id').single()
  if (se || !sess) throw new Error(`세션 생성 실패: ${se?.message}`)
  const { data: msg, error: me } = await admin.from('chat_messages').insert({ session_id: sess.id, sender_type: 'user', content: '질문', message_type: 'text' }).select('id').single()
  if (me || !msg) throw new Error(`메시지 생성 실패: ${me?.message}`)
  cleanups.push(async () => { await admin.from('chat_sessions').delete().eq('id', sess.id); await admin.auth.admin.deleteUser(userId) })
  return { userId, sessionId: sess.id as string, messageId: msg.id as string }
}

describe.skipIf(!isStage)('크레이지챗 추천 — 동의어 확장 + 관찰 메트릭 (실DB)', () => {
  it('주입한 확정 동의어로 한글 별칭 질문이 영문 상품을 찾고, 동의어가 없으면 찾지 못한다', async () => {
    const p = await pickLatinProduct()
    const alias = `큐에이별칭${rand()}`
    const groups = [{ canonicalTerm: alias, confirmedTerms: [alias, p.latin] }]
    invalidateProductSearchCache()

    const withSyn = await createRecommendSearcher(async () => groups)(admin, alias, [alias])
    expect(withSyn.usedExpansion).toBe(true)
    expect(withSyn.hits.map((h) => h.id)).toContain(p.id)

    const without = await createRecommendSearcher(async () => [])(admin, alias, [alias])
    expect(without.usedExpansion).toBe(false)
    expect(without.hits.map((h) => h.id)).not.toContain(p.id)
  })

  it('여러 단어 질문("별칭 + 일반 단어")도 별칭 단어만 동의어로 바꿔 상품을 찾는다', async () => {
    const p = await pickLatinProduct()
    const alias = `큐에이별칭${rand()}`
    const groups = [{ canonicalTerm: alias, confirmedTerms: [alias, p.latin] }]
    invalidateProductSearchCache()
    const r = await createRecommendSearcher(async () => groups)(admin, `${alias} 카메라`, [alias, '카메라'])
    expect(r.usedExpansion).toBe(true)
    expect(r.hits.map((h) => h.id)).toContain(p.id)
  })

  it('실제 DB의 확정(confirmed) 동의어 그룹을 읽는 기본 경로도 동작하고, 후보(candidate)는 쓰지 않는다', async () => {
    const p = await pickLatinProduct()
    const aliasConfirmed = `큐에이확정${rand()}`
    const aliasCandidate = `큐에이후보${rand()}`
    const { data: g1, error: e1 } = await admin.from('synonym_groups').insert({ canonical_term: aliasConfirmed }).select('id').single()
    const { data: g2, error: e2 } = await admin.from('synonym_groups').insert({ canonical_term: aliasCandidate }).select('id').single()
    if (e1 || e2 || !g1 || !g2) throw new Error(`합성 그룹 생성 실패: ${e1?.message ?? e2?.message}`)
    cleanups.push(async () => { await admin.from('synonym_groups').delete().in('id', [g1.id, g2.id]) })
    const { error: me } = await admin.from('synonym_group_members').insert([
      { group_id: g1.id, term: aliasConfirmed, source: 'learned', status: 'confirmed' },
      { group_id: g1.id, term: p.latin, source: 'learned', status: 'confirmed' },
      { group_id: g2.id, term: aliasCandidate, source: 'learned', status: 'confirmed' },
      { group_id: g2.id, term: p.latin, source: 'learned', status: 'candidate' },
    ])
    if (me) throw new Error(`합성 멤버 생성 실패: ${me.message}`)
    invalidateProductSearchCache()

    // 이 파일 안에서 loadSynonymGroups를 처음 부르는 시점 — 시드 이후라 합성 그룹이 읽힌다
    const searcher = createRecommendSearcher()
    const ok = await searcher(admin, aliasConfirmed, [aliasConfirmed])
    expect(ok.usedExpansion).toBe(true)
    expect(ok.hits.map((h) => h.id)).toContain(p.id)

    // candidate 멤버는 확정 그룹에 포함되지 않아 후보 별칭은 확장되지 않는다
    const cand = await searcher(admin, aliasCandidate, [aliasCandidate])
    expect(cand.hits.map((h) => h.id)).not.toContain(p.id)
  })

  it('관찰 모드: 고객에게는 아무것도 보내지 않고 점수·후보 상품 id·사용한 하한·확장 여부를 기록한다', async () => {
    const p = await pickLatinProduct()
    const alias = `큐에이별칭${rand()}`
    const groups = [{ canonicalTerm: alias, confirmedTerms: [alias, p.latin] }]
    invalidateProductSearchCache()
    const { userId, sessionId, messageId } = await setupChat()

    const r = await runCrazychatRecommend(
      admin,
      { userId, sessionId, messageId, content: `${alias} 추천해 주세요`, adminEngaged: false },
      { settings: observeSettings, searchProducts: createRecommendSearcher(async () => groups) },
    )
    expect(r).toEqual({ handled: false })
    const { data: sent } = await admin.from('chat_messages').select('id').eq('session_id', sessionId).eq('sender_type', 'ai')
    expect(sent ?? []).toHaveLength(0)

    const { data: obs } = await admin.from('crazychat_query_observations')
      .select('mode, intent, outcome, top_score, card_scores, product_ids, min_score_used, expanded')
      .eq('message_id', messageId)
    expect(obs).toHaveLength(1)
    const row = obs![0] as { top_score: number; card_scores: number[]; product_ids: string[]; min_score_used: number; expanded: boolean; mode: string; intent: string }
    expect(row).toMatchObject({ mode: 'observe', intent: 'recommend', expanded: true })
    expect(Number(row.min_score_used)).toBe(RECOMMEND_MIN_SCORE)
    expect(Number(row.top_score)).toBeGreaterThan(0)
    expect(row.card_scores.length).toBeGreaterThanOrEqual(1)
    expect(row.card_scores.length).toBeLessThanOrEqual(3)
    expect(row.product_ids).toContain(p.id)
    // 검색어·고객 문장은 어디에도 저장되지 않는다
    expect(JSON.stringify(row).includes('큐에이')).toBe(false)
  })
})
