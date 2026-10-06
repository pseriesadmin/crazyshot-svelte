// dataset.ts — 학습·가상 관찰 공용 데이터 도우미 (코퍼스 로드, 질문 재생, 학습 표본 변환)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateCannedMatch } from '../../src/lib/server/matchCannedResponse'
import type { CannedMatchEvaluation, CannedResponseForMatch, SynonymGroupData } from '../../src/lib/server/matchCannedResponse'
import type { Sample } from '../../src/lib/server/cannedMatchModel'
import type { Corpus } from './synthetic'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const CORPUS_PATH = join(ROOT, 'src', '__tests__', 'fixtures', 'cannedCorpus.json')
export const WEIGHTS_PATH = join(ROOT, 'src', 'lib', 'server', 'cannedMatchModel.weights.json')

export function loadCorpus(): Corpus {
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as Corpus
}

export function toCandidates(corpus: Corpus): CannedResponseForMatch[] {
  return corpus.canned.map((c) => ({
    id: c.id, title: c.title, content: c.content, category: c.category, shortcut: c.shortcut,
    match_keywords: c.match_keywords, usage_count: c.usage_count,
  }))
}

export function toSynonymGroups(corpus: Corpus): SynonymGroupData[] {
  return corpus.synonyms.map((s) => ({ canonicalTerm: s.canonicalTerm, confirmedTerms: s.confirmedTerms }))
}

export interface LabeledQuery {
  query: string
  /** 정답으로 인정하는 빠른답변 id들. 빈 배열 = 답변하면 안 되는 질문 */
  acceptable: string[]
  kind: string
  group: string
  weight?: number
  /** 평가셋 번호(검수용 CSV와 맞춤) */
  n?: number
}

export interface Replayed {
  item: LabeledQuery
  evaluation: CannedMatchEvaluation
}

/** 질문들을 규칙 판정에 그대로 재생한다(호출부와 같은 함수·같은 후보·같은 동의어) */
export function replay(queries: LabeledQuery[], corpus: Corpus): Replayed[] {
  const candidates = toCandidates(corpus)
  const synonyms = toSynonymGroups(corpus)
  return queries.map((item) => ({ item, evaluation: evaluateCannedMatch(item.query, candidates, synonyms) }))
}

/** 규칙이 "답변"으로 판정한 질문만 학습 표본이 된다(확률 모델은 그 답이 맞는지를 판단) */
export function toSamples(replayed: Replayed[]): { sample: Sample; group: string; kind: string }[] {
  const out: { sample: Sample; group: string; kind: string }[] = []
  for (const r of replayed) {
    const ev = r.evaluation
    if (ev.decision !== 'answer' || !ev.best) continue
    const chosen = ev.top.find((t) => t.id === ev.best?.id) ?? ev.top[0]
    out.push({
      sample: { features: chosen.features, label: r.item.acceptable.includes(ev.best.id) ? 1 : 0, weight: r.item.weight },
      group: r.item.group,
      kind: r.item.kind,
    })
  }
  return out
}
