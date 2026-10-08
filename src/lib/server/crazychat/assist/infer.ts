// infer.ts — AI 조력 생성기: 프롬프트 조립 · 응답 파싱 · 검증 (순수 함수, 서버 전용)
// 외부 AI는 "제안"만 한다. 이 파일의 검증을 통과한 항목만 이후 단계(시뮬레이션 게이트 → DB 반영)로 넘어간다.

export interface AssistFaq { id: string; title: string; content: string; keywords: string[] }
export interface AssistInput {
  /** id는 앞 8자리 */
  faqs: AssistFaq[]
  productTerms: string[]
  /** 이미 마스킹된 고객 질문 */
  questions: string[]
}

export interface KeywordProposal { faq: string; add: string[] }
export interface NewFaqProposal { title: string; keywords: string[]; answer: string; sources: string[] }
export interface AssistOutput { keywords: KeywordProposal[]; newFaqs: NewFaqProposal[] }

export const ASSIST_LIMITS = { keywordsPerFaq: 8, maxKeywordLen: 10, maxAnswerLen: 500, maxTitleLen: 60, newFaqMax: 5, minNewFaqKeywords: 3 } as const

const SYSTEM = [
  '당신은 촬영장비 렌탈 서비스의 빠른답변 키워드 조력자입니다.',
  '고객이 실제로 쓸 법한 질문 말투를 추론해, 기존 빠른답변(FAQ)에 붙일 키워드와 부족한 주제의 새 자동답변 초안을 제안합니다.',
  '규칙:',
  '1) 근거는 아래 FAQ 본문뿐입니다. 본문에 없는 정책·금액·기한·링크·전화번호는 절대 창작하지 마세요.',
  '2) 키워드는 공백 없는 짧은 명사형(2~10자)으로, 고객 질문에서 흔히 쓰는 표현을 제안하세요. 대여·예약·반납 같은 단독 일반어는 제외합니다.',
  '3) 새 자동답변은 반드시 근거가 되는 FAQ id를 sources에 적고, 답변은 그 FAQ 문장을 재구성하는 데 그쳐야 합니다.',
  '4) 출력은 JSON 한 덩어리만: {"keywords":[{"faq":"id","add":["키워드"]}],"new_faqs":[{"title":"","keywords":["",""," "],"answer":"","sources":["id"]}]}',
].join('\n')

export function buildAssistPrompt(input: AssistInput): { system: string; userTurn: string } {
  const faqs = input.faqs.map((f) => `[${f.id}] ${f.title}\n본문: ${f.content.slice(0, 500)}\n키워드: ${f.keywords.slice(0, 30).join(', ')}`).join('\n\n')
  const userTurn = [
    '## 기존 빠른답변',
    faqs,
    '## 상품 색인 용어',
    input.productTerms.slice(0, 80).join(', '),
    '## 최근 고객 질문(개인정보 마스킹됨)',
    input.questions.slice(0, 80).map((q) => `- ${q}`).join('\n'),
  ].join('\n')
  return { system: SYSTEM, userTurn }
}

export function parseAssistOutput(text: string): AssistOutput | null {
  const body = (text ?? '').replace(/```(?:json)?/gi, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try { raw = JSON.parse(body.slice(start, end + 1)) } catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kws = o.keywords
  const nf = o.new_faqs ?? []
  if (!Array.isArray(kws) || !Array.isArray(nf)) return null
  const keywords: KeywordProposal[] = []
  for (const k of kws) {
    if (!k || typeof k !== 'object') return null
    const { faq, add } = k as Record<string, unknown>
    if (typeof faq !== 'string' || !Array.isArray(add)) return null
    keywords.push({ faq, add: add.filter((x): x is string => typeof x === 'string') })
  }
  const newFaqs: NewFaqProposal[] = []
  for (const f of nf) {
    if (!f || typeof f !== 'object') return null
    const { title, keywords: kw, answer, sources } = f as Record<string, unknown>
    if (typeof title !== 'string' || typeof answer !== 'string' || !Array.isArray(kw) || !Array.isArray(sources)) return null
    newFaqs.push({ title, answer, keywords: kw.filter((x): x is string => typeof x === 'string'), sources: sources.filter((x): x is string => typeof x === 'string') })
  }
  return { keywords, newFaqs }
}

// 단독 일반어 — 키워드로 쓰면 어떤 질문에든 걸린다
const GENERIC = new Set(['대여', '렌탈', '예약', '반납', '장비', '상품', '제품', '카메라', '렌즈', '신청', '처리', '결제', '채널', '고객센터', '상담', '담당자', '채팅', '시간', '일정', '고객', '이용', '서비스', '문의', '안내', '확인'])
// 사람 전용 주제(settings.ts HUMAN_ONLY_TOPICS와 같은 영역): AI가 키워드·답변으로 새로 만들지 않는다
const SENSITIVE_RE = /(파손|고장|분실|도난|환불|취소|위약|수수료|배상|변상|소송|법적|고소|개인정보|결제오류|결제실패|신고)/
const PROMISE_RE = /(반드시|무조건|100\s*%|보장|약속|무료로|환불해\s*드리|책임지|틀림없이)/

const normKw = (k: string): string => k.replace(/\s+/g, '').toLowerCase()
const nums = (s: string): string[] => s.match(/\d[\d,.:/-]*\d|\d/g) ?? []

export function validateAssistOutput(out: AssistOutput, input: AssistInput): AssistOutput {
  const byId = new Map(input.faqs.map((f) => [f.id, f]))
  const keywords: KeywordProposal[] = []
  for (const p of out.keywords) {
    const faq = byId.get(p.faq)
    if (!faq) continue
    const have = new Set(faq.keywords.map(normKw))
    const add: string[] = []
    for (const raw of p.add) {
      const k = normKw(raw)
      if (k.length < 2 || k.length > ASSIST_LIMITS.maxKeywordLen) continue
      if (/^\d+$/.test(k) || !/[가-힣a-z]/.test(k)) continue
      if (GENERIC.has(k) || have.has(k) || add.includes(k) || SENSITIVE_RE.test(k)) continue
      add.push(k)
      if (add.length >= ASSIST_LIMITS.keywordsPerFaq) break
    }
    if (add.length) keywords.push({ faq: p.faq, add })
  }
  const titles = new Set(input.faqs.map((f) => f.title.replace(/\s+/g, '').toLowerCase()))
  const newFaqs: NewFaqProposal[] = []
  for (const f of out.newFaqs) {
    if (newFaqs.length >= ASSIST_LIMITS.newFaqMax) break
    const title = f.title.trim()
    const answer = f.answer.trim()
    if (!title || title.length > ASSIST_LIMITS.maxTitleLen || !answer || answer.length > ASSIST_LIMITS.maxAnswerLen) continue
    if (titles.has(title.replace(/\s+/g, '').toLowerCase())) continue
    const src = f.sources.map((s) => byId.get(s)).filter((x): x is AssistFaq => !!x)
    if (!src.length || src.length !== f.sources.length) continue
    if (PROMISE_RE.test(answer) || SENSITIVE_RE.test(`${title} ${answer} ${f.keywords.join(' ')}`)) continue
    const srcText = src.map((s) => `${s.title} ${s.content}`).join(' ')
    const srcNums = new Set(nums(srcText))
    if (nums(answer).some((n) => !srcNums.has(n))) continue
    const urls = answer.match(/https?:\/\/\S+/g) ?? []
    if (urls.some((u) => !srcText.includes(u))) continue
    const kws = [...new Set(f.keywords.map(normKw).filter((k) => k.length >= 2 && k.length <= ASSIST_LIMITS.maxKeywordLen && !GENERIC.has(k) && !/^\d+$/.test(k)))]
    if (kws.length < ASSIST_LIMITS.minNewFaqKeywords) continue
    newFaqs.push({ title, answer, keywords: kws, sources: f.sources })
  }
  return { keywords, newFaqs }
}
