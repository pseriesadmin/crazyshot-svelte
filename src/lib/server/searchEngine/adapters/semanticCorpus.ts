/**
 * adapters/semanticCorpus.ts — 의미 벡터 학습용 말뭉치 구성 (순수 모듈, DB·$env 없음)
 *
 * ⛔ 허용 소스 화이트리스트(nlsearch.md §4-12): 이 모듈은 아래 7종 입력만 받는다. 채팅 원문(chat_messages)·채팅 답변 후보·분류 로그의
 * 원문 응답·검색 로그 원문은 입력 타입에 없고, 소스 스캔 테스트(semanticCorpusWhitelist.test.ts)가 이 파일에 해당 이름이 나타나지 않음을 감시한다.
 *   product(공개 부모 상품 텍스트) · review(공개 후기) · crazylog(공개 크레이지로그 글) · comment(공개 글의 공개 댓글) ·
 *   canned(활성 빠른답변: 제목·키워드·본문) · synonym(확정 동의어 그룹) · learned(승격된 검색 학습 키워드)
 * 사용자가 쓴 텍스트(review·crazylog·comment·learned)는 개인정보 마스킹을 통과한 줄만 쓰고, 마스킹 후에도 위험 신호가 남은 줄은 버린다.
 * 어휘 필터: 사용자 작성 출처의 단어는 "공개 상품·관리자 작성 출처에도 나오는 단어"이거나 "사용자 출처에서 2회 이상 나온 단어"만 남긴다
 * (한 사람만 쓴 고유한 말 — 이름·닉네임·개인 사연 — 이 모델 어휘에 들어가는 것을 막는다).
 */

import { maskPersonalInfo, isSafeToSend } from '$lib/server/crazychat/assist/mask'
import type { CorpusDoc } from '../core/semanticVectors'
import { tokenizeForSemantics } from '../core/semanticVectors'
import { buildProductDocs, extractContentBlocksText } from './productSearchDocs'

export const SEMANTIC_CORPUS_SOURCES = ['product', 'review', 'crazylog', 'comment', 'canned', 'synonym', 'learned'] as const
export type SemanticCorpusSource = (typeof SEMANTIC_CORPUS_SOURCES)[number]

export interface SemanticCorpusInput {
  products?: readonly Record<string, unknown>[]
  /** { title, content, is_public } */
  reviews?: readonly Record<string, unknown>[]
  /** user_posts 행: { id, title, content_blocks, keywords, tags, is_public, status, allow_ai_save } */
  posts?: readonly Record<string, unknown>[]
  /** post_comments 행: { post_id, content, is_public } — 허용된 글의 댓글만 사용 */
  comments?: readonly Record<string, unknown>[]
  /** canned_responses 행: { title, content, match_keywords, pending_review } */
  canned?: readonly Record<string, unknown>[]
  /** { canonicalTerm, confirmedTerms } */
  synonymGroups?: readonly { canonicalTerm: string; confirmedTerms: readonly string[] }[]
  /** { search_term, product_name } — 승격 임계값 이상 클릭된 쌍 */
  learned?: readonly { search_term: string; product_name: string }[]
}

export interface SemanticCorpusStats {
  docs: Record<SemanticCorpusSource, number>
  /** 개인정보 마스킹 후에도 위험 신호가 남아 버린 줄 수 */
  droppedUnsafe: number
  /** 어휘 필터로 제거된 단어 수 */
  droppedWords: number
}

export interface SemanticCorpus {
  docs: CorpusDoc[]
  stats: SemanticCorpusStats
}

const SYNONYM_DOC_WEIGHT = 3
const LEARNED_DOC_WEIGHT = 2
const MIN_USER_WORD_FREQ = 2

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** 사용자 작성 텍스트 → 마스킹된 안전한 줄 목록(위험 신호가 남은 줄은 버림) */
function safeLines(text: string, counter: { unsafe: number }): string[] {
  const out: string[] = []
  // 마스킹을 먼저(문단 단위) 한 뒤 문장으로 나눈다 — 먼저 나누면 "010.1234.5678"처럼 구두점이 낀 번호가 조각나 마스킹을 피한다
  for (const paragraph of text.split('\n')) {
    const masked = maskPersonalInfo(paragraph)
    for (const raw of masked.split(/[.!?]+(?=\s|$)/)) {
      const line = raw.trim()
      if (!line) continue
      if (!isSafeToSend(line)) {
        counter.unsafe++
        continue
      }
      // 마스킹 자리표시자(예: [전화])는 학습에 쓸모없는 잡음 — 제거
      const cleaned = line.replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim()
      if (cleaned) out.push(cleaned)
    }
  }
  return out
}

export function buildSemanticCorpus(input: SemanticCorpusInput): SemanticCorpus {
  const counter = { unsafe: 0 }
  const docsBySource: Record<SemanticCorpusSource, number> = { product: 0, review: 0, crazylog: 0, comment: 0, canned: 0, synonym: 0, learned: 0 }
  const docs: CorpusDoc[] = []
  const trusted: string[] = [] // 공개 상품·관리자 작성 텍스트(어휘 필터의 "허용 단어" 기준)

  // ── 신뢰 소스: 상품 · 빠른답변 · 동의어 ──
  for (const p of buildProductDocs([...(input.products ?? [])])) {
    const text = [p.name, p.brand, p.caption, p.keywords_text, p.components_text, p.specs_text, p.content_text].filter(Boolean).join(' ')
    if (!text.trim()) continue
    docs.push({ text })
    trusted.push(text)
    docsBySource.product++
  }
  for (const c of input.canned ?? []) {
    if (c['pending_review'] === true) continue
    const text = [str(c['title']), arr(c['match_keywords']).join(' '), str(c['content'])].filter(Boolean).join(' ')
    if (!text.trim()) continue
    docs.push({ text })
    trusted.push(text)
    docsBySource.canned++
  }
  for (const g of input.synonymGroups ?? []) {
    const text = [g.canonicalTerm, ...g.confirmedTerms].filter(Boolean).join(' ')
    if (!text.trim()) continue
    docs.push({ text, weight: SYNONYM_DOC_WEIGHT })
    trusted.push(text)
    docsBySource.synonym++
  }

  // ── 사용자 작성 소스: 후기 · 크레이지로그 · 댓글 · 학습 키워드 (마스킹 + 어휘 필터 대상) ──
  const userTexts: { source: SemanticCorpusSource; text: string; weight?: number }[] = []
  for (const r of input.reviews ?? []) {
    if (r['is_public'] === false) continue
    for (const line of safeLines([str(r['title']), str(r['content'])].join('. '), counter)) userTexts.push({ source: 'review', text: line })
  }
  const allowedPostIds = new Set<string>()
  for (const post of input.posts ?? []) {
    if (post['is_public'] !== true || post['status'] !== 'published' || post['allow_ai_save'] !== true) continue
    allowedPostIds.add(String(post['id'] ?? ''))
    const body = [str(post['title']), arr(post['keywords']).join(' '), arr(post['tags']).join(' '), extractContentBlocksText(post['content_blocks'])].join('. ')
    for (const line of safeLines(body, counter)) userTexts.push({ source: 'crazylog', text: line })
  }
  for (const cm of input.comments ?? []) {
    if (cm['is_public'] !== true || !allowedPostIds.has(String(cm['post_id'] ?? ''))) continue
    for (const line of safeLines(str(cm['content']), counter)) userTexts.push({ source: 'comment', text: line })
  }
  for (const l of input.learned ?? []) {
    for (const line of safeLines(`${l.search_term} ${l.product_name}`, counter)) userTexts.push({ source: 'learned', text: line, weight: LEARNED_DOC_WEIGHT })
  }

  const trustedWords = new Set(trusted.flatMap((t) => tokenizeForSemantics(t)))
  const userFreq = new Map<string, number>()
  for (const u of userTexts) for (const w of new Set(tokenizeForSemantics(u.text))) userFreq.set(w, (userFreq.get(w) ?? 0) + 1)

  let droppedWords = 0
  for (const u of userTexts) {
    const kept: string[] = []
    for (const raw of u.text.split(/\s+/)) {
      const toks = tokenizeForSemantics(raw)
      if (toks.length === 0) continue
      const ok = toks.every((w) => trustedWords.has(w) || (userFreq.get(w) ?? 0) >= MIN_USER_WORD_FREQ)
      if (ok) kept.push(raw)
      else droppedWords++
    }
    if (kept.length < 2) continue // 한 단어만 남은 줄은 공출현 정보가 없다
    docs.push({ text: kept.join(' '), weight: u.weight })
    docsBySource[u.source]++
  }

  return { docs, stats: { docs: docsBySource, droppedUnsafe: counter.unsafe, droppedWords } }
}
