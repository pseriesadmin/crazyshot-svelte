// keyword-candidates.ts — 빠른답변 키워드 후보 오프라인 생성기 (AI 모델 미사용, 규칙 기반)
//
// 사용: npx tsx scripts/canned-match/keyword-candidates.ts --corpus <corpus.json> [--out <report.md>] [--json <cands.json>] [--sql <apply.sql>] [--rollback <rollback.sql>]
//
// 원칙
//  · DB·운영에 아무것도 쓰지 않는다. 입력 파일(corpus)을 읽고 후보 목록·리포트·"적용 SQL 초안"을 파일로만 만든다.
//  · 후보는 FAQ 자신의 제목·본문에서만 뽑는다(본문에 없는 말은 키워드가 될 수 없다 → 정책을 지어내지 않음).
//  · 후보마다 오프라인 시뮬레이션(실제 호출부 decideAutoReply)으로 검증해 통과한 것만 남긴다:
//      ① 그 FAQ의 합성 질문 중 새로 정답이 되는 것이 있어야 하고
//      ② 어떤 FAQ의 합성 질문·부정 대조 질문도 정답→오답/대기, 대기→오답으로 나빠지면 안 된다.
//  · 마지막에 통과 후보를 모두 합쳐 다시 전체 검증하고, 문제를 일으키는 후보를 걷어낸다.
import { readFileSync, writeFileSync } from 'node:fs'
import { decideAutoReply } from '../../src/lib/server/cannedAutoReply'
import { stripTrailingParticle } from '../../src/lib/server/searchEngine/core/koreanTokenizer'
import type { CannedResponseForMatch, SynonymGroupData } from '../../src/lib/server/matchCannedResponse'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface Faq extends CannedResponseForMatch { }
interface Corpus { canned: Faq[]; synonyms: SynonymGroupData[] }

const corpus = JSON.parse(readFileSync(arg('corpus') ?? '', 'utf-8')) as Corpus
const faqs = corpus.canned

// ── 1) 후보 추출 ─────────────────────────────────────────────────────────────
const SPLIT = /[\s,.!?~·/()'"“”‘’[\]{}:;+\-_=<>|*&^%$#@•▶◀📌📦🚨⚠️✓✅🚫💾🔍🌙🛠️📋💰😊🎬⭐💡🛡️🚚📸]+/u
const VERBAL_RE = /(요|니다|습니다|세요|하는|하신|하며|하고|해서|하면|드립니다|드려요|바랍니다|됩니다|입니다|있습니다|없습니다|아닌|있는|없는|같은|위한|통한|대한|따른|경우|때문|이상|이내|이하|이후|이전|까지|부터|에서|으로|에게|하여|되어|있도록|있으니|있으며|드리겠습니다|주시기|주세요|해주세요)$/
const STOP = new Set([
  '안녕하세요', '감사합니다', '고객님', '고객', '크레이지샷', 'crazyshot', '그리고', '그러나', '하지만', '단지', '특히', '아래', '위의', '다음', '모든', '관련', '문의', '안내', '확인', '요청', '진행', '가능', '필요', '정도', '이용', '서비스',
  '해당', '내용', '사항', '부탁', '양해', '협조', '때문', '이유', '방법', '상태', '대해', '대한', '통해', '위해', '경우', '이상', '이내', '현재', '이미', '또는', '혹은', '반드시', '꼭', '언제든', '편하게', '직접', '별도',
  '대여', '렌탈', '예약', '반납', '장비', '상품', '제품', '카메라', '렌즈', '신청', '처리', '결제', '채널', '고객센터', '상담', '담당자', '담당', '채팅', '시간', '일정',
])
// 업종 일반어(STOP에 있어도 복합어의 일부로는 쓰인다): 단독 후보로는 쓰지 않는다.
const GENERIC_SOLO = new Set(['대여', '렌탈', '예약', '반납', '장비', '상품', '제품', '카메라', '렌즈', '신청', '처리', '결제', '채널', '고객센터', '상담', '담당자', '채팅', '시간', '일정', '고객', '이용', '서비스'])

function sentences(text: string): string[] {
  return text.split(/[.!?。\n]|(?<=다)\s+(?=[가-힣])|•|▶|◀/u).map((s) => s.trim()).filter(Boolean)
}

function nounTokens(sentence: string): string[] {
  const out: string[] = []
  for (const raw of sentence.toLowerCase().split(SPLIT)) {
    if (raw.length < 2) { out.push(''); continue }
    const t = stripTrailingParticle(raw)
    if (t.length < 2 || !/[가-힣a-z]/.test(t) || /^\d+/.test(t) || VERBAL_RE.test(t)) { out.push(''); continue }
    out.push(t)
  }
  return out
}

interface Cand { kw: string; score: number; inTitle: boolean; kind: 'uni' | 'bi'; a?: string; n?: string }

const df = new Map<string, number>() // 단어가 등장하는 FAQ 수(제목+본문)
const faqTokens = new Map<string, { title: string[][]; body: string[][] }>()
for (const f of faqs) {
  const title = sentences(f.title).map(nounTokens)
  const body = sentences(f.content).map(nounTokens)
  faqTokens.set(f.id, { title, body })
  const seen = new Set<string>()
  for (const sent of [...title, ...body]) for (const t of sent) if (t) seen.add(t)
  for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
}
const DF_MAX = 5 // 이 이상의 FAQ에 나오는 단어는 주제어가 아님
const JUNK = /^(필수|바로|아니라|대여아|이후|이전|우선|먼저|전체|일부|추가|기본|정상|가능|불가|해당|관련)|(면|된|하지|되는|아니라|서울특별시|강서구|양천|출구|방향|동안)$/

/** FAQ의 "주제어" A: 제목 명사(일반어 포함)와 등록된 짧은 키워드. 후보는 A와 본문 명사 N의 조합이다. */
function topicsOf(f: Faq): string[] {
  const tk = faqTokens.get(f.id)!
  const fromTitle = tk.title.flat().filter((t) => t && t.length >= 2 && t.length <= 5 && !STOP_TITLE.has(t))
  const fromKw = f.match_keywords.map((k) => k.toLowerCase().replace(/\s+/g, '')).filter((k) => k.length >= 2 && k.length <= 4)
  return [...new Set([...fromTitle, ...fromKw])].slice(0, 6)
}
const STOP_TITLE = new Set(['안내', '방법', '경우', '관련', '가능', '하나요', '있나요', '인가요', '어떻게', '무엇', '이유', '필요'])

function extractCandidates(f: Faq): Cand[] {
  const tk = faqTokens.get(f.id)!
  const existing = new Set(f.match_keywords.map((k) => k.toLowerCase().replace(/\s+/g, '')))
  const topics = topicsOf(f)
  const map = new Map<string, Cand>()
  const add = (c: Cand): void => {
    if (c.kw.length < 3 || c.kw.length > 9 || existing.has(c.kw) || JUNK.test(c.kw)) return
    const prev = map.get(c.kw)
    if (prev) { prev.score += c.score; prev.inTitle ||= c.inTitle } else map.set(c.kw, c)
  }
  const nouns = new Map<string, { w: number; inTitle: boolean }>()
  const scan = (sents: string[][], inTitle: boolean): void => {
    for (const sent of sents) for (let i = 0; i < sent.length; i++) {
      const n = sent[i]
      if (!n || STOP.has(n) || GENERIC_SOLO.has(n) || JUNK.test(n) || (df.get(n) ?? 0) > 2) continue
      const e = nouns.get(n) ?? { w: 0, inTitle: false }
      e.w += inTitle ? 3 : 1
      e.inTitle ||= inTitle
      nouns.set(n, e)
      // 본문 인접 복합어(A가 주제어일 때만)
      const prevTok = sent[i - 1]
      if (prevTok && topics.includes(prevTok) && !JUNK.test(prevTok + n)) add({ kw: prevTok + n, score: 2, inTitle, kind: 'bi', a: prevTok, n })
      const nextTok = sent[i + 1]
      if (nextTok && topics.includes(nextTok) && !JUNK.test(n + nextTok)) add({ kw: n + nextTok, score: 2, inTitle, kind: 'bi', a: nextTok, n })
    }
  }
  scan(tk.title, true)
  scan(tk.body, false)
  // 주제어 × 본문 명사 조합(상위 명사만)
  const topNouns = [...nouns.entries()].sort((x, y) => y[1].w - x[1].w).slice(0, 8)
  for (const a of topics.slice(0, 3)) for (const [n, info] of topNouns) if (a !== n) add({ kw: a + n, score: info.w, inTitle: info.inTitle, kind: 'bi', a, n })
  // 단어 후보: 제목에 있거나 본문 2회 이상
  for (const [n, info] of topNouns) if (n.length >= 3 && (info.inTitle || info.w >= 2)) add({ kw: n, score: info.w, inTitle: info.inTitle, kind: 'uni', n })
  return [...map.values()].sort((x, y) => y.score - x.score).slice(0, 12)
}

// ── 2) 합성 질문(템플릿, AI 아님) ────────────────────────────────────────────
const FRAMES = ['{k} 어떻게 해요', '{k} 가능한가요', '{k} 알려주세요', '{k} 궁금해요', '{k}는 어떻게 되나요', '{k} 문의드려요', '{k} 있나요', '{k} 안내해 주세요']
const halves = (kw: string): string | null => (kw.length === 4 || kw.length === 6 ? `${kw.slice(0, kw.length / 2)} ${kw.slice(kw.length / 2)}` : null)

interface Q { q: string; exp: string; anchor: string }
// 기준 은행: 등록된 키워드를 앵커로 한 질문 — 후보가 기존 답변을 망치는지 보는 용도
const bank: Q[] = []
const candsByFaq = new Map<string, Cand[]>()
for (const f of faqs) {
  candsByFaq.set(f.id, extractCandidates(f))
  const anchors = f.match_keywords.filter((k) => k.length >= 3 && k.length <= 8).slice(0, 5)
  for (const a of new Set(anchors)) for (const fr of FRAMES) {
    bank.push({ q: fr.replace('{k}', a), exp: f.id, anchor: a })
    const h = halves(a)
    if (h && /[가-힣]/.test(h)) bank.push({ q: fr.replace('{k}', h), exp: f.id, anchor: a })
  }
}
// 부정 대조: 답하면 안 되는 질문
const NEG = ['안녕하세요', '감사합니다', '소니 A7M4 대여료 얼마예요', '캐논 R5 재고 있어요', '오늘 날씨 어때요', '사장님 번호 알려주세요', '렌즈 추천해주세요', '쿠폰 어떻게 써요', '포인트 적립 되나요', '다음 주 토요일 촬영인데 뭐가 좋을까요',
  '촬영 일정이 바뀌었어요', '배터리 몇 개 주나요', '삼각대도 같이 빌릴 수 있나요', '렌즈 필터 있나요', '주차 가능한가요', '엘리베이터 있어요', '후기 쓰면 혜택 있나요', '회원 탈퇴하고 싶어요', '비밀번호를 잊어버렸어요', '일본 가는데 렌즈 추천해주세요',
  '고객센터', '답변이 계속 엉뚱하게만 오네요', '10일 11일 장비가 다르게 필요한데요', '택배 언제 와요 지금 안 와요', '장비 상태가 안 좋아요']
for (const q of NEG) bank.push({ q, exp: '', anchor: '(부정)' })
const questions = bank

/** 후보가 도와야 할 "이득 질문": 주제어 A와 본문 명사 N을 띄어 말하는 자연스러운 질문(후보 문자열 자체를 그대로 말하지 않는다) */
function gainQuestions(f: Faq, c: Cand): Q[] {
  const out: Q[] = []
  const as = c.a ? [c.a] : topicsOf(f).slice(0, 3)
  const n = c.n ?? c.kw
  for (const a of as) for (const fr of FRAMES) {
    out.push({ q: fr.replace('{k}', `${a} ${n}`), exp: f.id, anchor: c.kw })
    if (c.a) out.push({ q: fr.replace('{k}', `${n} ${a}`), exp: f.id, anchor: c.kw })
  }
  return out
}

// ── 3) 평가 도우미 ───────────────────────────────────────────────────────────
type Outcome = 'right' | 'wrong' | 'wait'
function outcomeOf(q: Q, list: Faq[]): { o: Outcome; got: string } {
  const d = decideAutoReply(q.q, list as CannedResponseForMatch[], corpus.synonyms)
  const got = d.answer ? d.answer.id : ''
  if (!got) return { o: q.exp === '' ? 'right' : 'wait', got }
  return { o: got === q.exp ? 'right' : 'wrong', got }
}
const compact = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
const rank: Record<Outcome, number> = { wrong: 0, wait: 1, right: 2 }

const baseOut = questions.map((q) => outcomeOf(q, faqs))
const baseRight = baseOut.filter((x) => x.o === 'right').length
const baseWrong = baseOut.filter((x) => x.o === 'wrong').length

// ── 4) 후보별 검증 ───────────────────────────────────────────────────────────
interface Accepted { faqId: string; kw: string; gained: string[]; kind: string }
const accepted: Accepted[] = []
const rejected = new Map<string, number>()
const rej = (why: string): void => { rejected.set(why, (rejected.get(why) ?? 0) + 1) }

function withKeyword(faqId: string, kw: string, list: Faq[] = faqs): Faq[] {
  return list.map((f) => (f.id === faqId ? { ...f, match_keywords: [...f.match_keywords, kw] } : f))
}

for (const f of faqs) {
  for (const c of candsByFaq.get(f.id) ?? []) {
    const trial = withKeyword(f.id, c.kw)
    // 해악 검사: 은행 전체(질문 수가 많지 않아 전수) — 후보가 다른 FAQ의 질문을 가로채지 않는지
    const idxs = questions.map((_, i) => i).filter((i) => compact(questions[i].q).includes(c.n ?? c.kw) || compact(questions[i].q).includes(c.kw) || questions[i].exp === '' || questions[i].exp === f.id)
    let worse = false
    for (const i of idxs) {
      const after = outcomeOf(questions[i], trial)
      const before = baseOut[i]
      if (rank[after.o] < rank[before.o] || (after.o === 'wrong' && before.o !== 'wrong')) { worse = true; break }
    }
    if (worse) { rej('기존 질문 악화'); continue }
    // 이득 검사: 주제어+본문명사 질문이 새로 정답이 되어야 한다(후보 문자열 자체를 말하는 질문은 쓰지 않음)
    const gq = gainQuestions(f, c)
    let gained = 0
    let wrongNow = 0
    const ex: string[] = []
    for (const g of gq) {
      const b = outcomeOf(g, faqs)
      const a = outcomeOf(g, trial)
      if (a.o === 'wrong' && b.o !== 'wrong') wrongNow++
      if (b.o !== 'right' && a.o === 'right') { gained++; if (ex.length < 3) ex.push(g.q) }
    }
    if (wrongNow > 0) { rej('이득 질문이 오답으로'); continue }
    if (gained < 4) { rej('이득 없음'); continue }
    accepted.push({ faqId: f.id, kw: c.kw, gained: ex, kind: c.kind })
    if (accepted.filter((x) => x.faqId === f.id).length >= 5) break
  }
}

// ── 5) 누적 검증: 통과 후보를 모두 합쳐 다시 검증하고, 악화시키는 후보를 걷어낸다 ────────
let finalSet = [...accepted]
function applyAll(set: Accepted[]): Faq[] {
  return faqs.map((f) => ({ ...f, match_keywords: [...f.match_keywords, ...set.filter((a) => a.faqId === f.id).map((a) => a.kw)] }))
}
for (let round = 0; round < 40; round++) {
  const list = applyAll(finalSet)
  const bad = new Set<string>()
  questions.forEach((q, i) => {
    const after = outcomeOf(q, list)
    const before = baseOut[i]
    if (rank[after.o] < rank[before.o]) {
      // 악화 원인: 문제 질문에 글자가 등장하는 후보 + 오답으로 답한 FAQ의 후보
      const cq = compact(q.q)
      const culprit = after.got
      finalSet.filter((a) => cq.includes(a.kw) || (culprit && a.faqId === culprit) || (!culprit && a.faqId !== q.exp && cq.includes(a.kw.slice(0, 2)))).forEach((a) => bad.add(`${a.faqId}|${a.kw}`))
    }
  })
  if (!bad.size) break
  finalSet = finalSet.filter((a) => !bad.has(`${a.faqId}|${a.kw}`))
  rej('누적 검증에서 제외')
}
const finalList = applyAll(finalSet)
const finalOut = questions.map((q) => outcomeOf(q, finalList))
const finRight = finalOut.filter((x) => x.o === 'right').length
const finWrong = finalOut.filter((x) => x.o === 'wrong').length
const regress = questions.filter((q, i) => rank[finalOut[i].o] < rank[baseOut[i].o]).length

// ── 6) 출력 ──────────────────────────────────────────────────────────────────
const q1 = (s: string): string => `'${s.replace(/'/g, "''")}'`
const byFaq = new Map<string, Accepted[]>()
for (const a of finalSet) byFaq.set(a.faqId, [...(byFaq.get(a.faqId) ?? []), a])

const md: string[] = []
md.push('# 빠른답변 키워드 후보 리포트 (규칙 기반, AI 미사용)')
md.push('')
md.push(`> 생성: ${new Date().toISOString()} · FAQ ${faqs.length}건 · 합성 질문 ${questions.length}개(부정 대조 ${NEG.length}) · **운영 DB에는 아무것도 쓰지 않았다**`)
md.push('')
md.push('## 요약')
md.push('')
md.push('| 구분 | 정답 | 오답 | 악화(정답→대기/오답) |')
md.push('|---|---|---|---|')
md.push(`| 적용 전 | ${baseRight} | ${baseWrong} | - |`)
md.push(`| 후보 전부 적용 후 | ${finRight} | ${finWrong} | ${regress} |`)
md.push('')
md.push(`- 후보 통과 ${finalSet.length}개 / FAQ ${byFaq.size}건. 걸러진 사유: ${[...rejected.entries()].map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`)
md.push('- 후보는 FAQ 본문·제목에 실제로 있는 말만 사용했고, 단독 일반어(대여·반납 등)와 5개 이상 FAQ에 흔한 말은 제외했다.')
md.push('')
md.push('## FAQ별 통과 후보')
md.push('')
for (const f of faqs) {
  const list = byFaq.get(f.id) ?? []
  md.push(`### ${f.title.slice(0, 60)} \`${f.id.slice(0, 8)}\` — 기존 키워드 ${f.match_keywords.length}개${f.match_keywords.length === 0 ? ' ⚠️ 키워드 없음' : ''}`)
  if (!list.length) { md.push('- (통과 후보 없음)'); md.push(''); continue }
  for (const a of list) md.push(`- \`${a.kw}\` (${a.kind === 'bi' ? '복합' : '단어'}) — 새로 답하는 질문 예: ${a.gained.map((x) => `"${x}"`).join(', ')}`)
  md.push('')
}
writeFileSync(arg('out') ?? 'keyword-candidates-report.md', md.join('\n'), 'utf-8')
writeFileSync(arg('json') ?? 'keyword-candidates.json', JSON.stringify(finalSet, null, 1), 'utf-8')

let ap = 'begin;\n'
let rb = 'begin;\n'
for (const [id, list] of byFaq) {
  const arr = `ARRAY[${list.map((a) => q1(a.kw)).join(',')}]::text[]`
  ap += `update canned_responses set match_keywords = (select array_agg(distinct k) from unnest(match_keywords || ${arr}) k) where id::text like ${q1(id.slice(0, 8) + '%')} and pending_review=false;\n`
  rb += `update canned_responses set match_keywords = (select coalesce(array_agg(k),ARRAY[]::text[]) from unnest(match_keywords) k where k <> all(${arr})) where id::text like ${q1(id.slice(0, 8) + '%')} and pending_review=false;\n`
}
ap += 'commit;\n'
rb += 'commit;\n'
if (arg('sql')) writeFileSync(arg('sql') as string, ap, 'utf-8')
if (arg('rollback')) writeFileSync(arg('rollback') as string, rb, 'utf-8')
console.log(`FAQ ${faqs.length} · 질문 ${questions.length} · 적용 전 정답 ${baseRight}/오답 ${baseWrong} → 후보 ${finalSet.length}개 적용 시 정답 ${finRight}/오답 ${finWrong}/악화 ${regress}`)
