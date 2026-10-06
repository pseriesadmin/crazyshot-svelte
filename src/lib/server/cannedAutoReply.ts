// cannedAutoReply.ts — 자동답변 호출부 연동 도우미 (api/chat/message 전용)
//
// 호출부(프로즌 경로)의 변경을 최소화하려고 "판정·기록·대기 안내 문구"를 이 모듈에 모았다.
//   · decideAutoReply: 규칙 판정(evaluateCannedMatch) + 확률 모델(decideWithModel) → 보낼 답변(없으면 null)
//   · buildObservationRow / recordObservation: 관찰 기록(canned_match_observations, Migration 656) — 고객 원문 미저장, fail-soft
//   · WAIT_REPLY / WAIT_SUPPRESS_MINUTES: 판정 불가 시 "관리자 답변 대기" 안내와 같은 세션 반복 억제
// 순수함수 원칙(nlsearch.md §6): 판정 함수에는 DB 호출이 없고, DB 쓰기는 recordObservation 한 곳에만 있다.

import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateCannedMatch } from './matchCannedResponse'
import type { CannedMatchEvaluation, CannedResponseForMatch, SynonymGroupData } from './matchCannedResponse'
import { decideWithModel, parseModel } from './cannedMatchModel'
import type { CannedMatchModel, ModelVerdict } from './cannedMatchModel'
import weights from './cannedMatchModel.weights.json'

/** 학습된 확률 모델(저장소의 가중치 파일). 형식이 맞지 않으면 서버 시작 시점에 바로 실패해 조용한 오작동을 막는다. */
export const activeModel: CannedMatchModel = parseModel(weights)

/** 판정 불가(미매칭·애매·낮은 확률)일 때 고객에게 보내는 안내 — AI 폴백이 꺼진 동안의 고정 문구 */
export const WAIT_REPLY = '정확한 답변을 위해 담당자가 확인 후 안내드릴게요. 잠시만 기다려 주세요.'
/** 같은 세션에서 이 시간(분) 안에 이미 대기 안내를 보냈다면 다시 보내지 않는다 */
export const WAIT_SUPPRESS_MINUTES = 5

export type AutoReplyMode = 'observe' | 'on'

export interface AutoReplyDecision {
  evaluation: CannedMatchEvaluation
  verdict: ModelVerdict
  /** 실제로 보낼 빠른답변(규칙·모델 모두 통과). 없으면 null */
  answer: CannedResponseForMatch | null
}

export function decideAutoReply(
  message: string,
  candidates: CannedResponseForMatch[],
  synonymGroups: SynonymGroupData[],
  model: CannedMatchModel = activeModel,
): AutoReplyDecision {
  const evaluation = evaluateCannedMatch(message, candidates, synonymGroups)
  const verdict = decideWithModel(evaluation, model)
  return { evaluation, verdict, answer: verdict.decision === 'answer' ? evaluation.best : null }
}

/** canned_match_observations INSERT 행 모양 */
export interface ObservationRow {
  message_id: string
  mode: AutoReplyMode
  rule_decision: CannedMatchEvaluation['decision']
  rule_reason: string
  model_decision: ModelVerdict['decision']
  probability: number | null
  threshold: number
  model_version: number
  best_canned_id: string | null
  would_send: boolean
  top: { id: string; score: number; evidence: number; coverage: number; passesRules: boolean }[]
  features: CannedMatchEvaluation['top'][number]['features'] | null
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000

export function buildObservationRow(
  messageId: string,
  mode: AutoReplyMode,
  d: AutoReplyDecision,
  model: CannedMatchModel = activeModel,
): ObservationRow {
  const chosen = d.evaluation.best ? d.evaluation.top.find((t) => t.id === d.evaluation.best?.id) : undefined
  return {
    message_id: messageId,
    mode,
    rule_decision: d.evaluation.decision,
    rule_reason: d.evaluation.reason,
    model_decision: d.verdict.decision,
    probability: d.verdict.probability === null ? null : round4(d.verdict.probability),
    threshold: round4(model.threshold),
    model_version: model.version,
    best_canned_id: d.verdict.bestId,
    would_send: d.answer !== null,
    top: d.evaluation.top.map((t) => ({ id: t.id, score: t.score, evidence: t.evidence, coverage: t.coverage, passesRules: t.passesRules })),
    features: chosen ? chosen.features : null,
  }
}

/**
 * 관찰 기록 저장 — 어떤 오류도 호출부로 전파하지 않는다(채팅 응답이 기록 실패로 깨지면 안 됨).
 * 같은 메시지가 두 번 기록되려 하면 유니크 인덱스가 막고, 그 오류도 무시한다.
 */
export async function recordObservation(admin: SupabaseClient, row: ObservationRow): Promise<void> {
  try {
    const { error } = await admin.from('canned_match_observations').insert(row)
    if (error && error.code !== '23505') console.error('[chat/message] 자동답변 관찰 기록 실패(fail-soft):', error.message)
  } catch (err) {
    console.error('[chat/message] 자동답변 관찰 기록 예외(fail-soft):', err instanceof Error ? err.message : err)
  }
}
