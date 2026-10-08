// gate.ts — AI 제안의 시뮬레이션 안전 게이트 (순수 함수, 서버 전용)
// 즉시 운영 반영 구조이므로, 저장 전에 "기존 질문의 답이 나빠지지 않는가"를 실제 호출부(decideAutoReply)로 검증한다.
// 기준: 제안을 반영한 뒤 어떤 검증 질문도 (정답→대기/오답) 또는 (대기→오답)으로 나빠지면 그 제안은 버린다.

import { decideAutoReply } from '$lib/server/cannedAutoReply'
import type { CannedResponseForMatch, SynonymGroupData } from '$lib/server/matchCannedResponse'
import type { AssistOutput, NewFaqProposal } from './infer'

const FRAMES = ['{k} 어떻게 해요', '{k} 가능한가요', '{k} 알려주세요', '{k} 궁금해요', '{k}는 어떻게 되나요', '{k} 있나요']
const NEG = [
  '안녕하세요', '감사합니다', '소니 A7M4 대여료 얼마예요', '캐논 R5 재고 있어요', '오늘 날씨 어때요', '사장님 번호 알려주세요', '렌즈 추천해주세요', '쿠폰 어떻게 써요',
  '포인트 적립 되나요', '촬영 일정이 바뀌었어요', '배터리 몇 개 주나요', '삼각대도 같이 빌릴 수 있나요', '주차 가능한가요', '회원 탈퇴하고 싶어요', '비밀번호를 잊어버렸어요', '고객센터',
]

interface Q { q: string; exp: string }
type Outcome = 'right' | 'wrong' | 'wait'
const rank: Record<Outcome, number> = { wrong: 0, wait: 1, right: 2 }
const compact = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

export interface GateResult {
  keywords: { faqId: string; add: string[] }[]
  newFaqs: (NewFaqProposal & { tempId: string })[]
  rejected: { keywords: number; newFaqs: number }
}

function buildBank(faqs: CannedResponseForMatch[]): Q[] {
  const bank: Q[] = []
  for (const f of faqs) {
    const anchors = f.match_keywords.filter((k) => k.length >= 3 && k.length <= 8).slice(0, 5)
    for (const a of new Set(anchors)) for (const fr of FRAMES) bank.push({ q: fr.replace('{k}', a), exp: f.id })
  }
  for (const q of NEG) bank.push({ q, exp: '' })
  return bank
}

function outcomeOf(q: Q, list: CannedResponseForMatch[], syn: SynonymGroupData[]): Outcome {
  const d = decideAutoReply(q.q, list, syn)
  const got = d.answer?.id ?? ''
  if (!got) return q.exp === '' ? 'right' : 'wait'
  return got === q.exp ? 'right' : 'wrong'
}

/** 검증된 제안(AssistOutput)을 시뮬레이션해 안전한 것만 남긴다. faq.id는 전체 id, 제안의 faq는 앞 8자리 */
export function gateAssistOutput(out: AssistOutput, faqs: CannedResponseForMatch[], syn: SynonymGroupData[]): GateResult {
  const bank = buildBank(faqs)
  const base = bank.map((q) => outcomeOf(q, faqs, syn))
  const rejected = { keywords: 0, newFaqs: 0 }

  const harms = (trial: CannedResponseForMatch[], needles: string[], focusId: string | null): boolean => {
    for (let i = 0; i < bank.length; i++) {
      const cq = compact(bank[i].q)
      const related = bank[i].exp === '' || (focusId !== null && bank[i].exp === focusId) || needles.some((n) => cq.includes(n))
      if (!related) continue
      const after = outcomeOf(bank[i], trial, syn)
      if (rank[after] < rank[base[i]]) return true
    }
    return false
  }

  // 1) 키워드: 하나씩 검증
  const accepted: { faqId: string; kw: string }[] = []
  for (const p of out.keywords) {
    const faq = faqs.find((f) => f.id.startsWith(p.faq))
    if (!faq) continue
    for (const kw of p.add) {
      const trial = faqs.map((f) => (f.id === faq.id ? { ...f, match_keywords: [...f.match_keywords, kw, ...accepted.filter((a) => a.faqId === f.id).map((a) => a.kw)] } : f))
      if (harms(trial, [compact(kw)], faq.id)) { rejected.keywords++; continue }
      accepted.push({ faqId: faq.id, kw })
    }
  }
  // 누적 검증: 합쳤을 때 악화가 생기면 그 질문에 글자가 등장하는 키워드부터 걷어낸다
  let set = [...accepted]
  const apply = (s: { faqId: string; kw: string }[]): CannedResponseForMatch[] =>
    faqs.map((f) => ({ ...f, match_keywords: [...f.match_keywords, ...s.filter((a) => a.faqId === f.id).map((a) => a.kw)] }))
  for (let round = 0; round < 10 && set.length; round++) {
    const list = apply(set)
    const bad = new Set<string>()
    bank.forEach((q, i) => {
      if (rank[outcomeOf(q, list, syn)] < rank[base[i]]) {
        const cq = compact(q.q)
        set.filter((a) => cq.includes(compact(a.kw)) || a.faqId === q.exp).forEach((a) => bad.add(`${a.faqId}|${a.kw}`))
      }
    })
    if (!bad.size) break
    rejected.keywords += bad.size
    set = set.filter((a) => !bad.has(`${a.faqId}|${a.kw}`))
  }
  const byFaq = new Map<string, string[]>()
  for (const a of set) byFaq.set(a.faqId, [...(byFaq.get(a.faqId) ?? []), a.kw])

  // 2) 신규 자동답변: 반영된 키워드 위에서 하나씩 검증
  const keptNew: (NewFaqProposal & { tempId: string })[] = []
  let working = apply(set)
  out.newFaqs.forEach((nf, idx) => {
    const tempId = `new${idx}-${nf.title.length}`
    const cand: CannedResponseForMatch = { id: tempId, title: nf.title, content: nf.answer, category: null, shortcut: null, match_keywords: nf.keywords, usage_count: 0 }
    const trial = [...working, cand]
    if (harms(trial, nf.keywords.map(compact), null)) { rejected.newFaqs++; return }
    working = trial
    keptNew.push({ ...nf, tempId })
  })

  return { keywords: [...byFaq.entries()].map(([faqId, add]) => ({ faqId, add })), newFaqs: keptNew, rejected }
}
