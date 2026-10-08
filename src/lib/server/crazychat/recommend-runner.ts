// recommend-runner.ts — 크레이지챗 추천형 실행기 (서버 전용)
//
// "카메라 추천해 주세요" 같은 질문이면 상품 검색(기존 자연어 검색 인덱스)으로 대여 상품 최대 3개를 찾아 상품 카드로 보낸다.
//   · 상품·가격·이미지는 DB 검색 결과에서만 가져온다(문장 생성 없음, 고정 안내 문구 + 카드). 판매전용·옵션전용·삭제·비노출 상품은 제외.
//   · 검색어가 비어 있으면(용도·종류를 말하지 않음) 카드 없이 고정 문구로 되묻고, 검색 결과가 없으면 아무것도 보내지 않고 기존 흐름(담당자 안내)으로 넘긴다.
//   · observe 모드는 검색·기록만 하고 고객에게 보내지 않는다. 쓰기는 chat_messages(+세션 갱신)와 crazychat_query_observations뿐이다.
//   · 기록에는 고객 원문·검색어를 저장하지 않는다(메시지 id·분류·카드 수만). 어떤 실패도 던지지 않는다(handled:false → 기존 흐름).

import { sendPushToUser } from '$lib/server/push'
import { loadCrazychatSettings, resolveFeatureMode } from './settings'
import {
  RECOMMEND_REPLY, buildRecommendMetrics, extractRecommendQuery, isRecommendQuestion, pickRecommendCards,
} from './recommend'
import { defaultRecommendSearcher } from './recommend-search'
import {
  afterAgentReply, insertAgentMessage, recordObservation,
  type AdminClient, type QueryRunContext, type QueryRunResult, type RunDeps,
} from './shared'

const NOT_HANDLED: QueryRunResult = { handled: false }
/** 검색 점수 하한(너무 약한 일치로 엉뚱한 상품을 추천하지 않도록). Stage 인덱스 점수 분포로 보정(이름 일치는 10 이상, 본문·사양의 우연한 일치는 2~3대) */
export const RECOMMEND_MIN_SCORE = 4

export async function runCrazychatRecommend(admin: AdminClient, ctx: QueryRunContext, deps: RunDeps = {}): Promise<QueryRunResult> {
  let mode: 'observe' | 'on' | null = null
  try {
    if (ctx.adminEngaged) return NOT_HANDLED
    const settings = deps.settings ?? (await loadCrazychatSettings(admin))
    const resolved = resolveFeatureMode(settings, 'recommend')
    if (resolved === 'off') return NOT_HANDLED
    mode = resolved
    if (!isRecommendQuestion(ctx.content)) return NOT_HANDLED

    const push = deps.sendPush ?? sendPushToUser
    const { query, tokens } = extractRecommendQuery(ctx.content)

    // 용도·종류를 말하지 않은 추천 요청 → 되묻기(카드 없음)
    if (!query) {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'no_data', group_count: 0 })
      if (mode !== 'on') return NOT_HANDLED
      const msg = await insertAgentMessage(admin, ctx.sessionId, RECOMMEND_REPLY.needDetail, undefined, 'recommend')
      if (!msg) return NOT_HANDLED
      await afterAgentReply(admin, ctx, push)
      return { handled: true, aiMessage: msg }
    }

    const searcher = deps.searchProducts ?? defaultRecommendSearcher
    const found = await searcher(admin, query, tokens)
    const cards = pickRecommendCards(found.hits, found.rows, found.prices, { minScore: RECOMMEND_MIN_SCORE })
    // 재보정용 메트릭(점수·후보 상품 id·사용한 하한·동의어 확장 여부) — 카드 발송 여부와 무관하게 기록
    const metrics = buildRecommendMetrics(found.hits, RECOMMEND_MIN_SCORE, found.usedExpansion === true)

    if (cards.length === 0) {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'no_data', group_count: 0 }, metrics)
      return NOT_HANDLED
    }
    if (mode !== 'on') {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'answered', group_count: cards.length }, metrics)
      return NOT_HANDLED
    }

    const intro = await insertAgentMessage(admin, ctx.sessionId, RECOMMEND_REPLY.intro, undefined, 'recommend')
    if (!intro) {
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'error', group_count: 0 })
      return NOT_HANDLED
    }
    let sent = 0
    for (const card of cards) {
      const m = await insertAgentMessage(admin, ctx.sessionId, '', { ...card })
      if (m) sent++
    }
    // 카드가 한 장도 저장되지 않았으면 안내 문구만 남기지 않는다(거짓 안내 방지) — 안내를 지우고 기존 흐름으로 넘긴다
    if (sent === 0) {
      try { await admin.from('chat_messages').delete().eq('id', (intro as { id: string }).id) } catch { /* 지우기 실패는 무시 */ }
      await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'error', group_count: 0 }, metrics)
      return NOT_HANDLED
    }
    await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'answered', group_count: sent }, metrics)
    await afterAgentReply(admin, ctx, push, { title: '상품을 찾아 보았어요', body: '채팅에서 추천 상품을 확인해 주세요.' })
    return { handled: true, aiMessage: intro }
  } catch (e) {
    console.error('[crazychat] 추천형 실행 실패(기존 흐름으로 이어감):', e instanceof Error ? e.message : String(e))
    if (mode) await recordObservation(admin, { message_id: ctx.messageId, mode, intent: 'recommend', outcome: 'error', group_count: 0 })
    return NOT_HANDLED
  }
}
