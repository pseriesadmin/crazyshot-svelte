// synthetic.ts — 자동답변 확률 모델 학습용 합성 질문 생성기 (시드 고정·재현 가능)
//
// 정답은 생성 시점에 확정된다:
//   · 양성: 특정 빠른답변의 키워드·제목·단축키·동의어로 만든 질문 → acceptable = 그 키워드를 가진 모든 답변 id
//   · 음성: 어떤 빠른답변도 정답이 아닌 질문(불만·인사·상품명 나열·시스템 문구·일반어만·등록 안 된 주제) → acceptable = []
// 실제 고객 질문(평가 전용)은 여기서 절대 사용하지 않는다 — 문구는 모두 일반적인 패턴을 새로 만든 것이다.

import { seededRandom } from '../../src/lib/server/cannedMatchModel'

export interface CorpusCanned {
  id: string
  title: string
  shortcut: string | null
  match_keywords: string[]
  usage_count: number
  category: string | null
  content: string
}
export interface Corpus {
  canned: CorpusCanned[]
  synonyms: { canonicalTerm: string; confirmedTerms: string[] }[]
}

export interface SyntheticQuery {
  query: string
  /** 정답으로 인정하는 빠른답변 id들. 빈 배열이면 "답변하면 안 되는 질문" */
  acceptable: string[]
  kind: string
  /** 교차검증 분할 단위(양성=빠른답변 id, 음성=템플릿 묶음) — 같은 group은 같은 fold에 들어간다 */
  group: string
  /** 라벨 확신도에 따른 표본 가중치(기본 1) — 라벨이 애매할 수 있는 합성 음성은 낮춘다 */
  weight?: number
}

const PREFIXES = ['', '', '', '저기 ', '혹시 ', '안녕하세요 ', '질문이 있는데 ', '급해요 ']
const SUFFIXES = ['', ' 어떻게 되나요?', ' 알려주세요', ' 가능한가요?', ' 궁금해요', ' 문의드립니다', ' 어떻게 해야 하나요?', ' 있나요?']
const DOMAIN_PADS = ['카메라', '장비', '렌즈', '대여']
const CONJUGATIONS = ['했어요', '했는데요', '이 있어요', '관련해서요', '때문에요']
// 자연스러운 문장 틀 — 키워드에 군더더기 명사·서술어가 붙어 "설명되지 않는 단어"가 섞인 실제 말투를 흉내 낸다(일반 패턴)
const FILLER_NOUNS = ['일정', '시간', '상황', '이번 주말', '내일모레', '현장', '이유', '경우', '조건', '절차', '날짜', '정도']
const VERB_PHRASES = ['늦을 것 같아서요', '안 될 것 같은데', '하고 싶은데', '알고 싶어서요', '궁금한데요', '어쩌죠', '급해서요', '처음이라서요', '잘 모르겠어요']
const NATURAL_FRAMES = [
  '{f} 때문에 {k} 하려는데 어떻게 해야 할까요',
  '{k}이 {v} 알려주세요',
  '{k} 관련해서 {f} 문의드려요',
  '{f}에 {k} 가능한지 궁금해요',
  '{k} {v}',
  '{k}를 {v} 어떻게 되나요',
]

function stripDecor(title: string): string {
  return title.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── 음성 템플릿(일반 패턴, 실제 질문 문자열 아님) ──────────────────────────────
const NEG_CHITCHAT = [
  '진짜 별로네요', '이게 뭐죠', '답변이 너무 느려요', '오늘 날씨가 정말 좋네요', '감사합니다 수고하세요', '네 알겠습니다',
  '뭐라고요 이해가 안 돼요', '사람이랑 얘기하고 싶어요', '다시 한번 말씀해 주세요', '잠깐만요 다시 연락드릴게요',
  '좋은 하루 보내세요', '아 그렇구나', '엄청 불편하네요', '이상한 답변만 오네요', '지금 바빠서 나중에 다시 올게요',
]
const NEG_MODEL_LISTS = [
  'SONY FX3 + 24-70 GM2 + NP-FZ100 2개', 'CANON R5C RF 15-35 L + CFexpress 512', 'Zhiyun Crane 4 + Rode Wireless GO II',
  'DJI RS3 PRO 컴보 + 모니터 7인치 SmallHD', 'BMPCC 6K Pro + Sigma 18-35 + V마운트 배터리', 'Nikon Z9 + 70-200 S + EN-EL18d',
  'Aputure 600d Pro + Light Dome II + C-스탠드', 'Sennheiser MKH416 + Zoom F6 + 붐폴',
]
const NEG_SYSTEM = [
  "'홍길동' 회원 본인증명정보 등록 확인 요청", "'김철수' 님 서류 승인 요청드립니다 주문 번호 20481", '[QA-고객] 삭제 테스트용 메시지', '[테스트] 결제 화면 확인용',
  'TEST 123', '주문번호 55231 결제 내역 전달드립니다', '자동 발송 메시지입니다 회신 불필요', '업로드 완료 알림 확인 부탁드려요',
]
const NEG_GENERIC_ONLY = [
  '장비 문의드립니다', '카메라 대여 관련해서 질문 있어요', '제품 상담 부탁드립니다', '대여 신청했는데 어떻게 하나요?', '렌즈 사용 관련 문의입니다',
  '상품 확인 부탁드려요', '장비 관련 질문이 있습니다', '서비스 이용 문의입니다',
]
// 등록된 빠른답변에 없는 주제(도메인 단어는 들어 있지만 정답 없음)
const NEG_UNKNOWN_TOPIC = [
  '렌즈 추천해주세요', '삼각대도 대여되나요?', '조명 세트 구성이 어떻게 되나요', '촬영 장소 추천해 주실 수 있나요', '카메라 사용법 알려주세요',
  '드론도 대여할 수 있나요', '세금계산서 발행 가능한가요', '영수증 발급해 주세요', '학생 할인 되나요?', '쿠폰은 어떻게 쓰나요', '포인트 적립은 얼마나 되나요',
  '친구 추천하면 혜택 있나요', '택배 송장번호 알려주세요', '메모리카드도 대여하나요', '충전기가 안 맞는 것 같아요', '삼각대 높이 조절이 안 돼요',
  '사용설명서 어디서 볼 수 있나요', '촬영 스태프도 소개해 주나요', '주차는 가능한가요', '휴무일이 언제예요', '배터리 몇 개 포함인가요',
]
// 키워드는 맞지만 묻는 용건이 어느 빠른답변도 다루지 않는 틀 — 라벨이 애매할 수 있어 가중치 0.5
const OFF_TOPIC_FRAMES = [
  '{k}도 대여되나요', '{k} 몇 개 포함인가요', '{k} 가격이 얼마예요', '{k} 사용법 알려주세요', '{k} 추천해 주세요', '{k} 종류가 뭐가 있나요',
  '{k} 재고 있나요', '{k} 색상 선택 가능한가요', '{k} 무게가 얼마나 되나요',
]
const NOISE_CLAUSES = [
  '그런데 어제 서울에서 있었던 공연 정말 좋았어요', '그건 그렇고 이번 주말에 여행 가는데 날씨가 걱정돼요', '참고로 저는 영상 편집을 오래 해왔고 취미로 사진도 찍어요',
  '말씀드리자면 지난번 행사에서 스태프분들이 너무 친절하셨어요',
]

export interface GenerateOptions {
  seed?: number
  /** 빠른답변 1건당 만들 양성 질문 상한 */
  perCannedLimit?: number
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

function decorate(rnd: () => number, core: string): string {
  return `${pick(rnd, PREFIXES)}${core}${pick(rnd, SUFFIXES)}`.replace(/\s+/g, ' ').trim()
}

export function generateSynthetic(corpus: Corpus, opts: GenerateOptions = {}): SyntheticQuery[] {
  const rnd = seededRandom(opts.seed ?? 20261006)
  const limit = opts.perCannedLimit ?? 26
  const out: SyntheticQuery[] = []

  // 키워드 → 그 키워드를 가진 빠른답변들(공유 키워드는 어느 쪽 답이든 정답으로 인정)
  const owners = new Map<string, Set<string>>()
  const own = (term: string, id: string): void => {
    const k = term.toLowerCase().trim()
    if (!owners.has(k)) owners.set(k, new Set())
    owners.get(k)?.add(id)
  }
  for (const c of corpus.canned) {
    for (const k of c.match_keywords) own(k, c.id)
    if (c.shortcut) own(c.shortcut.replace(/^\//, ''), c.id)
  }
  const acceptableFor = (...terms: string[]): string[] => {
    // 모든 단어를 키워드로 가진 빠른답변만 정답(교집합)
    let acc: string[] | undefined
    for (const t of terms) {
      const s = owners.get(t.toLowerCase().trim()) ?? new Set<string>()
      acc = acc === undefined ? [...s] : acc.filter((x) => s.has(x))
    }
    return acc ?? []
  }

  const titleWords = (t: string): Set<string> => new Set(stripDecor(t).split(' ').filter((w) => w.length >= 2))
  const siblingsOf = (c: CorpusCanned): string[] => {
    const myKw = new Set(c.match_keywords.map((k) => k.toLowerCase().trim()))
    const myTw = titleWords(c.title)
    return corpus.canned
      .filter((o) => o.id !== c.id)
      .filter((o) => o.match_keywords.some((k) => myKw.has(k.toLowerCase().trim())) && [...titleWords(o.title)].some((w) => myTw.has(w)))
      .map((o) => o.id)
  }

  const synGroupFor = (term: string): string[] => {
    const t = term.toLowerCase()
    for (const g of corpus.synonyms) {
      if (g.canonicalTerm.toLowerCase() === t || g.confirmedTerms.some((x) => x.toLowerCase() === t)) return g.confirmedTerms.filter((x) => x.toLowerCase() !== t)
    }
    return []
  }

  for (const c of corpus.canned) {
    const kws = [...new Set(c.match_keywords.map((k) => k.trim()).filter((k) => k.length >= 2))]
    const made: SyntheticQuery[] = []
    const add = (core: string, kind: string, acceptable: string[]): void => {
      made.push({ query: decorate(rnd, core), acceptable: acceptable.length ? acceptable : [c.id], kind, group: c.id })
    }

    // 1) 단일 키워드
    for (const k of kws) add(k, 'kw1', acceptableFor(k))
    // 2) 키워드 2개 조합
    for (let n = 0; n < Math.min(6, kws.length); n++) {
      if (kws.length < 2) break
      const a = pick(rnd, kws)
      const b = pick(rnd, kws.filter((x) => x !== a))
      if (b) add(`${a} ${b}`, 'kw2', acceptableFor(a, b))
    }
    // 3) 키워드 3개 조합
    for (let n = 0; n < Math.min(3, Math.floor(kws.length / 3)); n++) {
      const a = pick(rnd, kws)
      const rest = kws.filter((x) => x !== a)
      const b = pick(rnd, rest)
      const d = pick(rnd, rest.filter((x) => x !== b))
      if (b && d) add(`${a} ${b} ${d}`, 'kw3', acceptableFor(a, b, d))
    }
    // 4) 제목 변형
    const title = stripDecor(c.title)
    if (title) {
      const accept = [c.id, ...siblingsOf(c)]
      made.push({ query: title, acceptable: accept, kind: 'title', group: c.id })
      const words = title.split(' ').filter((w) => w.length >= 2)
      if (words.length >= 3) made.push({ query: words.slice(0, Math.ceil(words.length * 0.7)).join(' '), acceptable: accept, kind: 'titlePart', group: c.id })
    }
    // 5) 단축키
    if (c.shortcut) {
      const sc = c.shortcut.replace(/^\//, '')
      if (sc.length >= 2) {
        made.push({ query: sc, acceptable: acceptableFor(sc), kind: 'shortcut', group: c.id })
        add(sc, 'shortcutDecor', acceptableFor(sc))
      }
    }
    // 6) 동의어 치환
    for (const k of kws) {
      const syns = synGroupFor(k)
      if (syns.length) add(pick(rnd, syns), 'synonym', acceptableFor(k))
    }
    // 7) 오타(키워드 4자 이상, 마지막이 아닌 한 글자 치환)
    for (const k of kws.filter((x) => x.length >= 4).slice(0, 2)) {
      const i = Math.floor(rnd() * (k.length - 1))
      const typo = `${k.slice(0, i)}${k[i] === '가' ? '나' : '가'}${k.slice(i + 1)}`
      add(typo, 'typo', acceptableFor(k))
    }
    // 7-2) 자연스러운 문장(군더더기 명사·서술어 포함)
    for (let n = 0; n < Math.min(4, kws.length); n++) {
      const k = pick(rnd, kws)
      const core = pick(rnd, NATURAL_FRAMES).replace('{k}', k).replace('{f}', pick(rnd, FILLER_NOUNS)).replace('{v}', pick(rnd, VERB_PHRASES))
      made.push({ query: core, acceptable: acceptableFor(k).length ? acceptableFor(k) : [c.id], kind: 'natural', group: c.id })
    }
    // 8) 일반어 섞기 + 활용형("분실했어요")
    for (const k of kws.slice(0, 3)) {
      add(`${pick(rnd, DOMAIN_PADS)} ${k}`, 'pad', acceptableFor(k))
      add(`${k}${pick(rnd, CONJUGATIONS)}`, 'conj', acceptableFor(k))
    }

    // 상한을 넘으면 시드 기반으로 솎아낸다. 제목·단축키 질문(구조적 질문)은 항상 보존한다
    const isCore = (q: SyntheticQuery): boolean => q.kind === 'title' || q.kind === 'titlePart' || q.kind === 'shortcut'
    const core = made.filter(isCore)
    const rest = made.filter((q) => !isCore(q))
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    out.push(...core, ...rest.slice(0, Math.max(0, limit - core.length)))
  }

  // ── 음성 ──
  const negGroups: [string, readonly string[], boolean][] = [
    ['negChitchat', NEG_CHITCHAT, true],
    ['negModel', NEG_MODEL_LISTS, false],
    ['negSystem', NEG_SYSTEM, false],
    ['negGeneric', NEG_GENERIC_ONLY, true],
    ['negUnknown', NEG_UNKNOWN_TOPIC, true],
  ]
  for (const [kind, list, decorateIt] of negGroups) {
    for (let i = 0; i < list.length; i++) {
      const group = `${kind}:${i}`
      out.push({ query: list[i], acceptable: [], kind, group })
      if (decorateIt) {
        for (let r = 0; r < 2; r++) out.push({ query: decorate(rnd, list[i]), acceptable: [], kind, group })
      }
    }
  }
  // 한 단어만 겹치고 나머지는 딴소리(잡음이 큰 질문) — 키워드 1개 + 무관한 절
  for (const c of corpus.canned) {
    const kws = c.match_keywords.filter((k) => k.trim().length >= 2)
    if (kws.length === 0) continue
    for (let n = 0; n < 2; n++) {
      out.push({ query: `${pick(rnd, kws)} ${pick(rnd, NOISE_CLAUSES)}`, acceptable: [], kind: 'negNoisy', group: `negNoisy:${c.id}` })
    }
  }
  // 키워드 + 다른 용건 틀(가중치 0.5)
  for (const c of corpus.canned) {
    const kws = c.match_keywords.filter((k) => k.trim().length >= 2)
    for (let n = 0; n < Math.min(3, kws.length); n++) {
      const k = pick(rnd, kws)
      out.push({ query: pick(rnd, OFF_TOPIC_FRAMES).replace('{k}', k), acceptable: [], kind: 'negOffTopic', group: `negOffTopic:${c.id}`, weight: 0.5 })
    }
  }
  return out
}

/** 평가 전용 질문과 겹치는 합성 질문이 있는지 검사(학습 누수 방지) — 겹치는 쿼리 목록을 돌려준다 */
export function findLeaks(train: SyntheticQuery[], evalQueries: string[]): string[] {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
  const evalSet = new Set(evalQueries.map(norm))
  return train.filter((t) => evalSet.has(norm(t.query))).map((t) => t.query)
}
