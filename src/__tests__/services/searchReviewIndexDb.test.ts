/**
 * TDD: searchReviewIndexDb.test.ts — 상품 후기 색인 합류 실DB 검증 (Stage 전용, L-1 / R-3)
 * 핵심: 공개 후기 단어로 상품이 검색되고 / 비공개 전환·삭제하면 인덱스 재구축 뒤 사라지며 /
 *       검색 결과 객체에 후기 문구가 실려 나가지 않고 / 후기가 상품명 일치보다 앞서지 못하고 /
 *       후기에만 맞는 크레이지챗 추천 질문은 점수 하한 때문에 카드가 나가지 않는다.
 * 모든 행은 이 테스트가 만든 합성 데이터이며 스스로 정리한다(기존 Stage 데이터 삭제 금지).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

vi.mock('$lib/server/push', () => ({ sendPushToUser: vi.fn() }))
import {
  getProductSearchIndex,
  invalidateProductSearchCache,
  getLastIndexBuildStats,
} from '$lib/server/searchEngine/adapters/productSearchIndex'
import { runCrazychatRecommend } from '$lib/server/crazychat/recommend-runner'
import { ALL_OFF, type CrazychatSettings } from '$lib/server/crazychat/settings'

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.().catch(() => undefined)
})

function uniqueToken(): string {
  return `qarev${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** 검색 인덱스 대상(활성 부모, 옵션전용 아님) 상품 n개를 이름이 서로 다른 것으로 고른다 */
async function pickProducts(n: number): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await admin
    .from('products')
    .select('id, name')
    .is('parent_product_id', null)
    .is('deleted_at', null)
    .eq('is_active', true)
    .eq('option_only', false)
    .order('created_at', { ascending: true })
    .limit(40)
  if (error || !data) throw new Error(`상품 조회 실패: ${error?.message}`)
  const seen = new Set<string>()
  const out: Array<{ id: string; name: string }> = []
  for (const p of data as Array<{ id: string; name: string }>) {
    const key = p.name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length === n) break
  }
  if (out.length < n) throw new Error('이름이 서로 다른 Stage 상품이 부족합니다')
  return out
}

async function addReview(productId: string, text: string, isPublic = true): Promise<string> {
  const { data, error } = await admin
    .from('product_reviews')
    .insert({ product_id: productId, user_id: null, author_name: 'QA-후기색인', title: 'QA후기', content: text, is_public: isPublic })
    .select('id')
    .single()
  if (error || !data) throw new Error(`후기 생성 실패: ${error?.message}`)
  const id = data.id as string
  cleanups.push(async () => { await admin.from('product_reviews').delete().eq('id', id) })
  return id
}

async function searchIds(query: string): Promise<string[]> {
  invalidateProductSearchCache()
  const index = await getProductSearchIndex()
  return index.search(query, { fuzzy: 0, prefix: false, limit: 20 }).map((r) => String(r.document.id))
}

const observeSettings: CrazychatSettings = { ...ALL_OFF, agentEnabled: true, recommend: { enabled: false, observe: true } }

describe.skipIf(!isStage)('상품 후기 색인 — 실DB', () => {
  it('공개 후기의 단어로 상품이 검색되고, 비공개 전환·삭제 뒤에는 사라진다', async () => {
    const [p] = await pickProducts(1)
    const token = uniqueToken()
    const reviewId = await addReview(p.id, `배터리가 정말 오래가요 ${token}`)

    expect(await searchIds(token)).toContain(p.id)

    await admin.from('product_reviews').update({ is_public: false }).eq('id', reviewId)
    expect(await searchIds(token)).not.toContain(p.id)

    await admin.from('product_reviews').update({ is_public: true }).eq('id', reviewId)
    expect(await searchIds(token)).toContain(p.id)

    await admin.from('product_reviews').delete().eq('id', reviewId)
    expect(await searchIds(token)).not.toContain(p.id)
  })

  it('검색 결과 객체에는 후기 문구·작성자 정보가 실려 나가지 않는다', async () => {
    const [p] = await pickProducts(1)
    const token = uniqueToken()
    await addReview(p.id, `조명이 밝아요 ${token}`)

    invalidateProductSearchCache()
    const index = await getProductSearchIndex()
    const hit = index.search(token, { fuzzy: 0, prefix: false, limit: 5 }).find((r) => r.document.id === p.id)
    expect(hit).toBeTruthy()
    // 소비 코드(검색 API·CMS 제안·크레이지챗 추천)가 읽는 것은 저장 필드(storeFields)뿐이다.
    // MiniSearch 내부 매칭 메타데이터(terms·match·queryTerms)는 외부로 나가지 않는다.
    const doc = hit!.document as unknown as Record<string, unknown>
    expect(doc['reviews_text']).toBeUndefined()
    const storedSerialized = JSON.stringify([
      doc.id, doc.name, doc.brand, doc.category, doc.slug, doc.caption, doc.keywords_text,
    ])
    expect(storedSerialized.includes(token)).toBe(false)
    expect(storedSerialized.includes('QA-후기색인')).toBe(false)
    expect(storedSerialized.includes('조명이 밝아요')).toBe(false)
  })

  it('다른 상품의 이름을 베낀 후기가 있어도 상품명이 맞는 상품이 항상 앞선다', async () => {
    const [a, b] = await pickProducts(2)
    await addReview(a.id, `${b.name} ${b.name} ${b.name}`)

    invalidateProductSearchCache()
    const index = await getProductSearchIndex()
    const results = index.search(b.name, { fuzzy: 0.2, prefix: true, limit: 10 })
    expect(results.length).toBeGreaterThan(0)
    expect(String(results[0].document.id)).toBe(b.id)
  })

  it('빌드 통계에 후기 반영 수가 숫자로 기록된다(상품명·후기 문구 없음)', async () => {
    const [p] = await pickProducts(1)
    await addReview(p.id, `통계 확인용 ${uniqueToken()}`)

    invalidateProductSearchCache()
    await getProductSearchIndex()
    const stats = getLastIndexBuildStats()
    expect(stats).not.toBeNull()
    expect(stats?.status).toBe('ok')
    expect(stats?.indexedProducts).toBeGreaterThan(0)
    expect(stats?.reviewedProducts).toBeGreaterThanOrEqual(1)
    expect(stats?.reviewRows).toBeGreaterThanOrEqual(1)
    expect(stats?.buildMs).toBeGreaterThanOrEqual(0)
    expect(Object.keys(stats ?? {}).sort()).toEqual(
      ['builtAt', 'buildMs', 'indexedProducts', 'reviewRows', 'reviewedProducts', 'status', 'weakProducts'].sort(),
    )
  })

  it('후기에만 맞는 추천 질문은 점수 하한 때문에 카드가 나가지 않는다(관찰 모드, 고객에게 발송 없음)', async () => {
    const [p] = await pickProducts(1)
    const token = uniqueToken()
    await addReview(p.id, `${token} ${token} ${token}`)

    const email = `tdd-review-idx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password: 'Test1234!', email_confirm: true })
    if (ue || !u.user) throw new Error(`사용자 생성 실패: ${ue?.message}`)
    const userId = u.user.id
    const { data: sess } = await admin.from('chat_sessions').insert({ user_id: userId, status: 'open', context_type: 'general' }).select('id').single()
    const sessionId = sess?.id as string
    const { data: msg } = await admin.from('chat_messages').insert({ session_id: sessionId, sender_type: 'user', content: '질문', message_type: 'text' }).select('id').single()
    const messageId = msg?.id as string
    cleanups.push(async () => { await admin.from('chat_sessions').delete().eq('id', sessionId); await admin.auth.admin.deleteUser(userId) })

    invalidateProductSearchCache()
    const r = await runCrazychatRecommend(admin, { userId, sessionId, messageId, content: `${token} 추천해 주세요`, adminEngaged: false }, { settings: observeSettings })
    expect(r.handled).toBe(false)
    const { data: sent } = await admin.from('chat_messages').select('id').eq('session_id', sessionId).eq('sender_type', 'ai')
    expect(sent ?? []).toHaveLength(0)
    const { data: obs } = await admin.from('crazychat_query_observations').select('outcome, group_count').eq('message_id', messageId)
    expect(obs).toEqual([{ outcome: 'no_data', group_count: 0 }])
  })
})
