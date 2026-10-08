import { describe, it, expect } from 'vitest'
import {
  MAX_SYNONYM_VARIANTS, RECOMMEND_REPLY, SYNONYM_VARIANT_WEIGHT, buildRecommendSearchTerms, extractRecommendQuery, isRecommendQuestion, pickRecommendCards,
  type RecommendProductRow,
} from '$lib/server/crazychat/recommend'

/** 크레이지챗 추천형 — 순수 로직: 추천 질문 감지·검색어 추출·카드 후보 선정 */
describe('isRecommendQuestion', () => {
  it('추천을 요청하는 질문은 대상', () => {
    for (const m of ['카메라 추천해 주세요', '브이로그 찍으려는데 어떤 카메라가 좋아요?', '렌즈 추천 부탁드려요', '조명 뭐가 좋아요?', '행사 촬영용 캠코더 추천해줘', '괜찮은 마이크 있을까요', '어느 렌즈 쓰면 되나요', '카메라 추천 받고 싶어요']) {
      expect(isRecommendQuestion(m), m).toBe(true)
    }
  })
  it('추천 요청이 아니거나 다른 용건이면 제외', () => {
    for (const m of ['내 예약 상태 알려줘', '연장하고 싶어요 추천해 주세요', '추천인 코드가 뭐예요', '친구 추천 이벤트 있나요', '렌즈 파손됐는데 추천 부탁', '환불 추천', '이거 괜찮은가요', '제안드릴게요', '안녕하세요', '', '가'.repeat(201) + ' 추천']) {
      expect(isRecommendQuestion(m), m).toBe(false)
    }
    expect(isRecommendQuestion(undefined)).toBe(false)
  })
})

describe('extractRecommendQuery', () => {
  it('요청 표현·군더더기를 빼고 핵심 단어만 남긴다', () => {
    expect(extractRecommendQuery('카메라 추천해 주세요').query).toBe('카메라')
    expect(extractRecommendQuery('렌즈 추천 부탁드려요').tokens).toEqual(['렌즈'])
    const q = extractRecommendQuery('브이로그 찍으려는데 어떤 카메라가 좋아요?')
    expect(q.tokens).toContain('브이로그')
    expect(q.tokens).toContain('카메라')
    expect(q.tokens).not.toContain('찍으려는데')
  })
  it('단어 중간을 자르지 않는다(저조도·저렴한·좀비 등)', () => {
    expect(extractRecommendQuery('저조도 카메라 추천해 주세요').tokens.some((t) => t.startsWith('저조'))).toBe(true) // 조사 '도'가 떨어져도 '저조…' 접두 검색으로 찾을 수 있다
    expect(extractRecommendQuery('저렴한 렌즈 추천').tokens).toEqual(['저렴한', '렌즈'])
    expect(extractRecommendQuery('아무거나 말고 좀비 영화용 조명 추천').tokens).toContain('좀비')
  })
  it('종류·용도를 말하지 않으면 빈 검색어', () => {
    expect(extractRecommendQuery('아무거나 추천해주세요').query).toBe('')
    expect(extractRecommendQuery('추천 부탁드려요').query).toBe('')
    expect(extractRecommendQuery('뭐가 좋아요?').query).toBe('')
    expect(extractRecommendQuery('이거 괜찮은 거 추천해줘').query).toBe('')

  })
})

const row = (o: Partial<RecommendProductRow> & { id: string }): RecommendProductRow => ({
  name: `상품 ${o.id}`, slug: `slug-${o.id}`, image_urls: [`img-${o.id}`], sale_only: false, option_only: false, is_active: true, deleted_at: null, ...o,
})

describe('pickRecommendCards', () => {
  const rows = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }), row({ id: 'd' }), row({ id: 'sale', sale_only: true }), row({ id: 'opt', option_only: true }), row({ id: 'gone', deleted_at: '2026-01-01' }), row({ id: 'off', is_active: false }), row({ id: 'noprice' }), row({ id: 'noslug', slug: '' })]
  const prices = { a: 30000, b: 20000, c: 10000, d: 5000, sale: 1000, opt: 1000, gone: 1000, off: 1000, noslug: 1000 }
  it('점수순 최대 3장만, 카드 필드는 DB 값 그대로', () => {
    const cards = pickRecommendCards([{ id: 'c', score: 8 }, { id: 'a', score: 10 }, { id: 'b', score: 9 }, { id: 'd', score: 7 }], rows, prices)
    expect(cards.map((c) => c.product_id)).toEqual(['a', 'b', 'c'])
    expect(cards[0]).toEqual({ type: 'PRODUCT_CARD', is_expired: false, product_id: 'a', product_name: '상품 a', product_price: 30000, product_image: 'img-a', action_url: '/products/slug-a' })
  })
  it('판매전용·옵션전용·삭제·비노출·가격 없음·슬러그 없음은 제외하고 다음 후보로 채운다', () => {
    const hits = ['sale', 'opt', 'gone', 'off', 'noprice', 'noslug', 'a', 'b'].map((id, i) => ({ id, score: 20 - i }))
    expect(pickRecommendCards(hits, rows, prices).map((c) => c.product_id)).toEqual(['a', 'b'])
  })
  it('행이 없는 검색 결과·중복은 무시', () => {
    expect(pickRecommendCards([{ id: 'zzz', score: 9 }, { id: 'a', score: 8 }, { id: 'a', score: 7 }], rows, prices).map((c) => c.product_id)).toEqual(['a'])
  })
  it('점수 하한·1등 대비 비율 미달은 제외', () => {
    const hits = [{ id: 'a', score: 40 }, { id: 'b', score: 20 }, { id: 'c', score: 3 }]
    expect(pickRecommendCards(hits, rows, prices, { minScore: 4 }).map((c) => c.product_id)).toEqual(['a', 'b'])
    expect(pickRecommendCards(hits, rows, prices, { minScore: 4, minRatio: 0.6 }).map((c) => c.product_id)).toEqual(['a'])
  })
  it('이미지가 없으면 product_image 필드를 넣지 않는다', () => {
    const c = pickRecommendCards([{ id: 'a', score: 9 }], [row({ id: 'a', image_urls: [] })], { a: 100 })
    expect('product_image' in c[0]).toBe(false)
  })
  it('후보가 없으면 빈 배열', () => {
    expect(pickRecommendCards([], rows, prices)).toEqual([])
  })
})

describe('고정 문구', () => {
  it('금액·약속·가용성 단정 표현이 없다', () => {
    const all = [RECOMMEND_REPLY.intro, RECOMMEND_REPLY.needDetail]
    for (const t of all) expect(t).not.toMatch(/\d{1,3}(,\d{3})+원|확정|보장|무조건|가능합니다/)
    expect(RECOMMEND_REPLY.intro).not.toMatch(/\d가지/)
  })
})

/**
 * 동의어 변형 검색어 — "소니 카메라 추천" 같은 여러 단어 질문에서 단어 하나만 확정 동의어로 바꾼 변형을 만든다.
 * 핵심: 그룹이 없거나 일치하는 단어가 없으면 원문 1개뿐(기존 동작과 동일) / 원문은 항상 가중치 1 / 변형은 0.9 / 상한 / 중복 제거
 */
describe('buildRecommendSearchTerms', () => {
  const sony = { canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony'] }
  const lens = { canonicalTerm: '렌즈', confirmedTerms: ['렌즈', 'lens'] }

  it('검색어가 비어 있으면 빈 배열', () => {
    expect(buildRecommendSearchTerms('', [], [sony])).toEqual([])
  })

  it('동의어 그룹이 없으면 원문 1개뿐(기존 동작과 동일)', () => {
    expect(buildRecommendSearchTerms('소니 카메라', ['소니', '카메라'], [])).toEqual([{ q: '소니 카메라', weight: 1, expanded: false }])
  })

  it('일치하는 단어가 없으면 원문 1개뿐', () => {
    expect(buildRecommendSearchTerms('캐논 카메라', ['캐논', '카메라'], [sony, lens])).toEqual([{ q: '캐논 카메라', weight: 1, expanded: false }])
  })

  it('한 단어를 동의어로 바꾼 변형을 만들고 나머지 단어는 유지한다(한글→영문)', () => {
    const terms = buildRecommendSearchTerms('소니 카메라', ['소니', '카메라'], [sony])
    expect(terms[0]).toEqual({ q: '소니 카메라', weight: 1, expanded: false })
    expect(terms[1]).toEqual({ q: 'Sony 카메라', weight: SYNONYM_VARIANT_WEIGHT, expanded: true })
    expect(terms).toHaveLength(2)
  })

  it('영문→한글 양방향, 대소문자 무시', () => {
    const terms = buildRecommendSearchTerms('sony 카메라', ['sony', '카메라'], [sony])
    expect(terms.map((t) => t.q)).toEqual(['sony 카메라', '소니 카메라'])
  })

  it('검색어 전체가 동의어와 일치하면 전체 변형도 만든다', () => {
    const terms = buildRecommendSearchTerms('소니', ['소니'], [sony])
    expect(terms.map((t) => t.q)).toEqual(['소니', 'Sony'])
  })

  it('서로 다른 두 단어가 각각 동의어를 가지면 한 번에 하나씩만 바꾼다(조합 폭증 방지)', () => {
    const terms = buildRecommendSearchTerms('소니 렌즈', ['소니', '렌즈'], [sony, lens])
    expect(terms.map((t) => t.q)).toEqual(['소니 렌즈', 'Sony 렌즈', '소니 lens'])
    expect(terms.slice(1).every((t) => t.expanded && t.weight === SYNONYM_VARIANT_WEIGHT)).toBe(true)
  })

  it('변형은 상한을 넘기지 않고 중복은 제거한다', () => {
    const many = { canonicalTerm: '소니', confirmedTerms: ['소니', ...Array.from({ length: 20 }, (_, i) => `brand${i}`), 'BRAND1'] }
    const terms = buildRecommendSearchTerms('소니 카메라', ['소니', '카메라'], [many])
    expect(terms.length - 1).toBeLessThanOrEqual(MAX_SYNONYM_VARIANTS)
    const keys = terms.map((t) => t.q.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('검색어 전체가 동의어일 때 대소문자만 다른 확장어(Sony/SONY)는 하나만 남긴다(상한 칸 낭비 방지)', () => {
    const upper = { canonicalTerm: '소니', confirmedTerms: ['소니', 'Sony', 'SONY'] }
    const terms = buildRecommendSearchTerms('소니', ['소니'], [upper])
    expect(terms.map((t) => t.q)).toEqual(['소니', 'Sony'])
  })

  it('원문 가중치는 항상 1이고 변형보다 크다', () => {
    const terms = buildRecommendSearchTerms('소니 카메라', ['소니', '카메라'], [sony])
    expect(terms[0].weight).toBe(1)
    expect(SYNONYM_VARIANT_WEIGHT).toBeLessThan(1)
  })
})
