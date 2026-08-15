// POST /api/cms/synonyms/backfill-cross-lingual — 이중언어 병기 패턴 백필 (§D-1)
// manager 이상 전용. products·chat_messages·cs_records 전체를 순회하며
// extractBilingualPairs로 후보를 찾아 synonym_group_members에 등록합니다.
// fire-and-forget이 아닌 동기 처리 — 결과 통계를 응답에 포함합니다.

import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import type { RequestHandler } from './$types'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { extractBilingualPairs } from '$lib/server/searchEngine/core/crossLingualPatternExtractor'
import { SYNONYM_PROMOTE_THRESHOLD } from '$lib/server/synonymLearning'

const BATCH_SIZE = 500

/**
 * 단일 텍스트에서 이중언어 쌍을 추출하고 DB에 등록. 등록된 쌍 수를 반환.
 *
 * 내부에서 Supabase 클라이언트를 직접 생성합니다.
 * 이렇게 하면 ReturnType<typeof createClient>의 제네릭 불일치 없이
 * 정확한 런타임 타입(SupabaseClient<any>)을 사용할 수 있습니다.
 */
async function registerPairsFromText(text: string): Promise<number> {
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const pairs = extractBilingualPairs(text)
  let registered = 0
  for (const { hangul, latin } of pairs) {
    const { data: groupId, error: groupErr } = await admin.rpc('find_or_create_synonym_group', {
      p_canonical_term: hangul,
    })
    if (groupErr || !groupId) continue

    // weight=2: 각 term을 2회 upsert (cross_lingual_pattern)
    for (const term of [hangul, latin]) {
      for (let i = 0; i < 2; i++) {
        await admin.rpc('upsert_synonym_member', {
          p_group_id: groupId,
          p_term: term,
          p_threshold: SYNONYM_PROMOTE_THRESHOLD,
          p_source: 'cross_lingual_pattern',
        })
      }
    }
    registered++
  }
  return registered
}

export const POST: RequestHandler = async ({ locals }) => {
  // manager 이상 게이트 (getCmsRoleForAction + hasSettingsAccess — security-auth.md)
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '인증 필요' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한 없음' }, { status: 403 })
  if (!hasSettingsAccess(cmsRole)) {
    return json({ error: '매니저 이상만 실행할 수 있습니다.' }, { status: 403 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  let processedProducts = 0
  let processedMessages = 0
  let processedCsRecords = 0
  let pairsRegistered = 0
  const startedAt = Date.now()
  const MAX_DURATION_MS = 250_000 // 250초 (Vercel 300초 함수 타임아웃 여유)

  function isTimedOut(): boolean {
    return Date.now() - startedAt > MAX_DURATION_MS
  }

  // ── 1. 상품(부모, is_active=true) ─────────────────────────────────────────
  type ProductRow = { name: string; brand: string | null; product_caption: string | null }
  let productOffset = 0
  while (!isTimedOut()) {
    const { data: products, error } = await admin
      .from('products')
      .select('name, brand, product_caption')
      .is('parent_product_id', null)
      .eq('is_active', true)
      .is('deleted_at', null)
      .range(productOffset, productOffset + BATCH_SIZE - 1)
    if (error || !products || products.length === 0) break

    for (const p of products as ProductRow[]) {
      const text = [p.name, p.brand, p.product_caption].filter(Boolean).join(' ')
      pairsRegistered += await registerPairsFromText(text)
      processedProducts++
    }
    if (products.length < BATCH_SIZE) break
    productOffset += BATCH_SIZE
  }

  // ── 2. 채팅 메시지 (최근 1000건 — 무제한 스캔 방지) ──────────────────────
  if (!isTimedOut()) {
    type MsgRow = { content: string | null }
    let msgOffset = 0
    const MSG_LIMIT = 1000
    while (!isTimedOut() && msgOffset < MSG_LIMIT) {
      const { data: messages, error } = await admin
        .from('chat_messages')
        .select('content')
        .not('content', 'is', null)
        .order('created_at', { ascending: false })
        .range(msgOffset, msgOffset + BATCH_SIZE - 1)
      if (error || !messages || messages.length === 0) break

      for (const m of messages as MsgRow[]) {
        if (m.content) {
          pairsRegistered += await registerPairsFromText(m.content)
          processedMessages++
        }
      }
      if (messages.length < BATCH_SIZE) break
      msgOffset += BATCH_SIZE
    }
  }

  // ── 3. CS 상담기록 summary ────────────────────────────────────────────────
  if (!isTimedOut()) {
    type CsRow = { summary: string | null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: csRecords, error } = await (admin as any)
      .from('cs_records')
      .select('summary')
      .not('summary', 'is', null)
    if (!error && csRecords) {
      for (const r of csRecords as CsRow[]) {
        if (r.summary) {
          pairsRegistered += await registerPairsFromText(r.summary)
          processedCsRecords++
        }
      }
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  const timedOut = isTimedOut()

  return json({
    ok: true,
    processedProducts,
    processedMessages,
    processedCsRecords,
    pairsRegistered,
    elapsed_s: elapsed,
    timed_out: timedOut,
    message: timedOut
      ? `타임아웃(${elapsed}초). 일부만 처리됨. BATCH_SIZE(현재 ${BATCH_SIZE})를 줄이거나 재실행하세요.`
      : `완료(${elapsed}초). 상품 ${processedProducts}개, 메시지 ${processedMessages}개, CS기록 ${processedCsRecords}개 처리. 등록/갱신 후보 쌍 ${pairsRegistered}건.`,
  })
}
