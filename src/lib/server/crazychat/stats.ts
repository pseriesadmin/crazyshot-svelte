// stats.ts — 크레이지챗 관찰 통계 집계(순수 로직, S5). 고객 원문은 다루지 않는다.
import { AI_READY_MIN_ACCURACY, AI_READY_MIN_REVIEWED } from './settings-update'

export interface QueryObsRow { mode: string; intent: string; outcome: string; feedback?: number | null }
export interface AiObsRow {
  mode: string; outcome: string; reason: string | null; sent: boolean
  input_tokens: number | null; output_tokens: number | null; feedback: number | null
}

export interface QuerySummary {
  total: number
  byOutcome: Record<string, number>
  byIntent: Record<string, number>
  answerRate: number | null // (answered+registered) / total
}

export function summarizeQuery(rows: readonly QueryObsRow[]): QuerySummary {
  const byOutcome: Record<string, number> = {}
  const byIntent: Record<string, number> = {}
  for (const r of rows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1
    byIntent[r.intent] = (byIntent[r.intent] ?? 0) + 1
  }
  const ok = (byOutcome.answered ?? 0) + (byOutcome.registered ?? 0)
  return { total: rows.length, byOutcome, byIntent, answerRate: rows.length ? ok / rows.length : null }
}

export interface AiSummary {
  calls: number // pending 제외
  answered: number
  sent: number
  byReason: Record<string, number>
  inputTokens: number
  outputTokens: number
  reviewed: number
  correct: number
  wrong: number
  accuracy: number | null
  passRate: number | null // answered / calls
  ready: boolean
}

export function summarizeAi(rows: readonly AiObsRow[]): AiSummary {
  const done = rows.filter((r) => r.outcome !== 'pending')
  const byReason: Record<string, number> = {}
  let inputTokens = 0, outputTokens = 0, answered = 0, sent = 0, correct = 0, wrong = 0
  for (const r of done) {
    if (r.reason) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
    inputTokens += r.input_tokens ?? 0
    outputTokens += r.output_tokens ?? 0
    if (r.outcome === 'answered') answered++
    if (r.sent) sent++
    if (r.feedback === 1) correct++
    if (r.feedback === 0) wrong++
  }
  const reviewed = correct + wrong
  const accuracy = reviewed ? correct / reviewed : null
  return {
    calls: done.length, answered, sent, byReason, inputTokens, outputTokens, reviewed, correct, wrong, accuracy,
    passRate: done.length ? answered / done.length : null,
    ready: reviewed >= AI_READY_MIN_REVIEWED && accuracy !== null && accuracy >= AI_READY_MIN_ACCURACY,
  }
}

/** 한국 시간(KST) 기준 오늘 0시의 ISO 시각 */
export function kstDayStartIso(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  const startKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())
  return new Date(startKst - 9 * 3600_000).toISOString()
}

export type StatsRange = 'today' | '7d' | 'all'
export function rangeSinceIso(range: StatsRange, now: Date = new Date()): string | null {
  if (range === 'all') return null
  if (range === 'today') return kstDayStartIso(now)
  return new Date(now.getTime() - 7 * 24 * 3600_000).toISOString()
}
