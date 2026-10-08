// pipeline.ts — AI 조력 생성기 전체 흐름 (서버 전용, 부수효과는 주입된 db/callModel로만)
// 입력(2차 마스킹) → AI 호출 → 파싱 → 형식·근거 검증 → 시뮬레이션 게이트 → DB 반영.
// 어느 단계가 실패하든 던지지 않고 { ok:false, reason }으로 돌려주며, 그 경우 DB에는 아무것도 반영하지 않는다.

import type { CannedResponseForMatch, SynonymGroupData } from '$lib/server/matchCannedResponse'
import { applyAssistResult, type AssistDb } from './apply'
import { gateAssistOutput } from './gate'
import { buildAssistPrompt, parseAssistOutput, validateAssistOutput, type AssistInput } from './infer'
import { isSafeToSend, maskPersonalInfo } from './mask'

export interface AssistModelResult { text: string; inputTokens: number | null; outputTokens: number | null }
export type AssistModelCaller = (args: { system: string; userTurn: string }) => Promise<AssistModelResult>

export interface PipelineArgs {
  input: AssistInput
  faqsForMatch: CannedResponseForMatch[]
  synonyms: SynonymGroupData[]
  db: AssistDb
  callModel: AssistModelCaller
  model: string
}

export interface PipelineResult {
  ok: boolean
  reason?: string
  runId?: string
  droppedQuestions?: number
  summary?: { keywordsAdded: number; faqsCreated: number; rejected: { keywords: number; newFaqs: number } }
  inputTokens?: number | null
  outputTokens?: number | null
}

export async function runAssistPipeline(a: PipelineArgs): Promise<PipelineResult> {
  // 1) 방어적 2차 마스킹 — 수집 단계에서 마스킹했더라도 외부 전송 직전에 한 번 더 확인한다
  const masked = a.input.questions.map(maskPersonalInfo)
  const safe = masked.filter((q) => q && isSafeToSend(q))
  const droppedQuestions = masked.length - safe.length
  const input: AssistInput = { ...a.input, questions: [...new Set(safe)] }

  // 2) AI 호출
  let raw
  try {
    raw = await a.callModel(buildAssistPrompt(input))
  } catch (e) {
    return { ok: false, reason: `AI 호출 실패: ${e instanceof Error ? e.message.slice(0, 160) : '알 수 없는 오류'}`, droppedQuestions }
  }

  // 3) 파싱 → 검증 → 게이트
  const parsed = parseAssistOutput(raw.text)
  if (!parsed) return { ok: false, reason: 'AI 응답을 읽을 수 없습니다(JSON 형식 아님).', droppedQuestions, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens }
  const validated = validateAssistOutput(parsed, input)
  const gated = gateAssistOutput(validated, a.faqsForMatch, a.synonyms)

  // 4) 반영(통과분이 없어도 실행 기록은 남긴다)
  try {
    const runId = await applyAssistResult(a.db, gated, { model: a.model, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens })
    const keywordsAdded = gated.keywords.reduce((n, k) => n + k.add.length, 0)
    return {
      ok: true, runId, droppedQuestions, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
      summary: { keywordsAdded, faqsCreated: gated.newFaqs.length, rejected: gated.rejected },
    }
  } catch (e) {
    return { ok: false, reason: `DB 반영 실패: ${e instanceof Error ? e.message.slice(0, 160) : '알 수 없는 오류'}`, droppedQuestions }
  }
}
