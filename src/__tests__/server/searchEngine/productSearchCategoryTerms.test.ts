/**
 * TDD: productSearchCategoryTerms.test.ts — 상품 검색 인덱스의 한글 분류어 검색 개선 (2026-10-08, Stephen 승인 Q1~Q5 추천안)
 * 실서버 진단 재현: ① 붙여 쓴 키워드("캐논카메라")가 "카메라"로 안 잡힘 ② 키워드가 빈 상품(Sony A7S3)이 "카메라"로 안 잡힘
 *                  ③ "카메라 렌즈" 질의 1위가 드론 — 분류 우선 정렬(크레이지챗 추천 경로 전용)로 해소
 * 외부 DB 없이 돈다(합성 고정 픽스처 src/__tests__/fixtures/productSearchGolden.json + 새 순수 모듈 productSearchDocs).
 */
import { describe, it, expect } from 'vitest'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'
import {
  PRODUCT_INDEX_CONFIG,
  buildCategoryLabelMap,
  buildProductDocs,
  createCategoryIntentSearch,
  detectCategoryIntent,
  extractCompoundHeads,
  reorderByCategoryIntent,
  type ProductDoc,
} from '$lib/server/searchEngine/adapters/productSearchDocs'
import { pickRecommendCards } from '$lib/server/crazychat/recommend'
import golden from '../../fixtures/productSearchGolden.json'

const LABELS = new Map<string, string[]>([
  ['camera', ['카메라']], ['lens', ['렌즈']], ['accessorie', ['악세서리']], ['dronegim', ['드론/짐벌']],
  ['light', ['조명']], ['hypepack', ['추천패키지']], ['actcam', ['액션캠']],
])
const EMPTY = new Map<string, string[]>()

function build(labels: ReadonlyMap<string, string[]>) {
  const docs = buildProductDocs(golden as unknown as Record<string, unknown>[], { categoryLabels: labels })
  return { docs, index: createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, docs) }
}
const ids = (r: Array<{ document: { id: unknown } }>): string[] => r.map((x) => String(x.document.id))
const cat = (id: string): string => String(golden.find((g) => g.id === id)?.category)

describe('extractCompoundHeads — 붙여 쓴 말의 끝말 분해', () => {
  it('"OO카메라"는 끝말 카메라만 넣는다(중복 제거)', () => {
    expect(extractCompoundHeads('캐논카메라 DSLR카메라 풀프레임카메라')).toEqual(['카메라'])
  })
  it('"카메라삼각대"는 삼각대만 — 앞말 카메라는 넣지 않는다(액세서리가 카메라 점수를 받지 않도록)', () => {
    expect(extractCompoundHeads('카메라삼각대')).toEqual(['삼각대'])
  })
  it('사전 단어와 똑같은 단어·조사 붙은 단어는 대상이 아니다(이미 단독 색인)', () => {
    expect(extractCompoundHeads('카메라')).toEqual([])
    expect(extractCompoundHeads('렌즈를')).toEqual([])
    expect(extractCompoundHeads('삼각대')).toEqual([])
  })
  it('앞말이 1자여도 분해한다(단렌즈·줌렌즈)', () => {
    expect(extractCompoundHeads('단렌즈')).toEqual(['렌즈'])
    expect(extractCompoundHeads('캐논L렌즈')).toEqual(['렌즈'])
  })
  it('영문만·사전에 없는 말은 만들지 않는다', () => {
    expect(extractCompoundHeads('DSLR Sony 5DMark4 스폿라이트')).toEqual([])
    expect(extractCompoundHeads('')).toEqual([])
  })
  it('추가 사전(분류 이름)도 끝말로 쓴다', () => {
    expect(extractCompoundHeads('아이돌조명 VLOG', ['조명'])).toEqual(['조명'])
  })
})

describe('분류 이름·끝말이 인덱스에 들어가면 — 검색 누락 해소(전체 소비처 공통)', () => {
  it('키워드가 빈 Sony A7S3도 "카메라"로 잡힌다(분류 이름), 렌즈 분류도 "렌즈"로 전부 잡힌다', () => {
    const { index } = build(LABELS)
    const cams = ids(index.search('카메라', { fuzzy: 0.2, prefix: true, limit: 200 }))
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']) expect(cams, id).toContain(id)
    const lenses = ids(index.search('렌즈', { fuzzy: 0.2, prefix: true, limit: 200 }))
    for (const id of ['l1', 'l2', 'l3', 'l4', 'l5']) expect(lenses, id).toContain(id)
  })
  it('분류 이름이 없어도(조회 실패) 끝말 분해만으로 "캐논카메라" 상품은 "카메라"로 잡힌다', () => {
    const { index } = build(EMPTY)
    const cams = ids(index.search('카메라', { fuzzy: 0.2, prefix: true, limit: 200 }))
    expect(cams).toContain('c2')
    expect(cams).not.toContain('c1') // 키워드·캡션이 비어 있어 이름 신호가 없는 상품은 분류 이름이 있어야 잡힌다
  })
  it('"OO삼각대" 액세서리가 "삼각대"로 잡힌다', () => {
    const { index } = build(EMPTY)
    const r = ids(index.search('삼각대', { fuzzy: 0.2, prefix: true, limit: 200 }))
    expect(r).toContain('a2')
    expect(r).toContain('ac2')
  })
  it('검색 결과 객체에 새 칸(compound_heads·category_label)이 새지 않는다', () => {
    const { index } = build(LABELS)
    const doc = index.search('카메라', { limit: 1 })[0].document as Record<string, unknown>
    expect(doc).not.toHaveProperty('compound_heads')
    expect(doc).not.toHaveProperty('category_label')
    expect(PRODUCT_INDEX_CONFIG.storeFields).not.toContain('compound_heads')
  })
  it('영문 "camera" 검색(분류 코드)은 그대로 동작한다', () => {
    const { index } = build(LABELS)
    expect(ids(index.search('camera', { limit: 200 }))).toContain('c1')
  })
  it('분류 이름 맵이 비면 category_label은 빈 문자열(기존과 같은 문서)', () => {
    const { docs } = build(EMPTY)
    expect(docs.every((d) => d.category_label === '')).toBe(true)
  })
})

describe('detectCategoryIntent — 질문 끝쪽의 연속된 분류 이름', () => {
  const det = (q: string) => detectCategoryIntent(q, LABELS)?.slice().sort() ?? null
  it('표', () => {
    expect(det('카메라')).toEqual(['camera'])
    expect(det('소니 카메라')).toEqual(['camera'])
    expect(det('카메라 렌즈')).toEqual(['camera', 'lens'])
    expect(det('렌즈를')).toEqual(['lens'])
    expect(det('드론')).toEqual(['dronegim'])
    expect(det('추천패키지')).toEqual(['hypepack'])
  })
  it('끝말이 분류 이름이 아니면 적용하지 않는다("카메라 가방")', () => {
    expect(det('카메라 가방')).toBeNull()
    expect(det('삼각대')).toBeNull()
    expect(det('카메라 삼각대')).toBeNull()
    expect(det('')).toBeNull()
  })
  it('끝에 붙은 부탁 표현은 무시한다', () => {
    expect(det('카메라 렌즈 줘요')).toEqual(['camera', 'lens'])
    expect(det('카메라 알려줘')).toEqual(['camera'])
  })
  it('분류 이름 맵이 비면 항상 null', () => {
    expect(detectCategoryIntent('카메라 렌즈', EMPTY)).toBeNull()
  })
})

describe('분류 우선 정렬 — 크레이지챗 추천 경로 전용 메서드', () => {
  it('"카메라 렌즈": 1~3위가 카메라·렌즈 분류(드론·조명·액세서리 아님)', () => {
    const { index } = build(LABELS)
    const search = createCategoryIntentSearch(index, LABELS)
    const top3 = ids(search('카메라 렌즈', { fuzzy: 0.2, prefix: true, limit: 30 }).slice(0, 3))
    expect(top3.every((id) => ['camera', 'lens'].includes(cat(id))), top3.join(',')).toBe(true)
  })
  it('같은 질의의 기존 search()는 드론이 앞선다(= 기존 동작 불변 확인)', () => {
    const { index } = build(LABELS)
    const plain = ids(index.search('카메라 렌즈', { fuzzy: 0.2, prefix: true, limit: 30 }))
    expect(plain[0]).toBe('d1')
  })
  it('"소니 카메라": 배터리 액세서리가 아니라 카메라가 1~3위', () => {
    const { index } = build(LABELS)
    const top3 = ids(createCategoryIntentSearch(index, LABELS)('소니 카메라', { fuzzy: 0.2, prefix: true, limit: 30 }).slice(0, 3))
    expect(top3.every((id) => cat(id) === 'camera'), top3.join(',')).toBe(true)
  })
  it('"렌즈": 즉석카메라·조명이 아니라 렌즈가 1~3위', () => {
    const { index } = build(LABELS)
    const top3 = ids(createCategoryIntentSearch(index, LABELS)('렌즈', { fuzzy: 0.2, prefix: true, limit: 30 }).slice(0, 3))
    expect(top3.every((id) => cat(id) === 'lens'), top3.join(',')).toBe(true)
  })
  it('"카메라 가방"에는 분류 우선이 적용되지 않는다(기존 search와 같은 결과)', () => {
    const { index } = build(LABELS)
    const opts = { fuzzy: 0.2, prefix: true, limit: 30 }
    expect(ids(createCategoryIntentSearch(index, LABELS)('카메라 가방', opts))).toEqual(ids(index.search('카메라 가방', opts)))
  })
  it('모델명 정확 질의("Sony A7S3")는 1위 유지', () => {
    const { index } = build(LABELS)
    const r = createCategoryIntentSearch(index, LABELS)('Sony A7S3', { fuzzy: 0.2, prefix: true, limit: 30 })
    expect(ids(r)[0]).toBe('c1')
  })
  it('분류 이름 맵이 비면(조회 실패) 기존 search와 완전히 같다', () => {
    const { index } = build(EMPTY)
    const opts = { fuzzy: 0.2, prefix: true, limit: 30 }
    expect(ids(createCategoryIntentSearch(index, EMPTY)('카메라 렌즈', opts))).toEqual(ids(index.search('카메라 렌즈', opts)))
  })
  it('분류 일치 상품이 3개 미만이면 나머지가 채운다(결과가 비지 않음)', () => {
    const { index } = build(LABELS)
    // 끝말 "조명" → 조명 분류 2개가 앞, 앞 단어 "카메라"에 일치한 나머지가 뒤를 채운다
    const opts = { fuzzy: 0.2, prefix: true, limit: 30 }
    const plain = ids(index.search('카메라 조명', opts))
    expect(cat(plain[0]), '기존 검색은 조명 분류가 첫째가 아니다(= 재정렬 효과를 증명하는 전제)').not.toBe('light')
    const r = createCategoryIntentSearch(index, LABELS)('카메라 조명', opts)
    expect(r.length).toBeGreaterThan(2)
    expect(ids(r).slice(0, 2).sort()).toEqual(['li1', 'li2'])
    expect(cat(ids(r)[2])).not.toBe('light')
  })
  it('limit을 지킨다', () => {
    const { index } = build(LABELS)
    expect(createCategoryIntentSearch(index, LABELS)('카메라', { limit: 4 }).length).toBeLessThanOrEqual(4)
  })
})

describe('분류 우선 검색 → 추천 카드 선정까지 (점수 압축이 pickRecommendCards에서 실제로 효과를 내는지)', () => {
  const rows = (golden as Array<Record<string, unknown>>).map((g) => ({
    id: String(g.id), name: String(g.name), slug: String(g.slug), image_urls: null, sale_only: false, is_active: true, option_only: false, deleted_at: null,
  }))
  const prices: Record<string, number> = Object.fromEntries(rows.map((r) => [r.id, 10000]))
  const toHits = (rs: Array<{ document: { id: unknown }; score: number }>) => rs.map((r) => ({ id: String(r.document.id), score: r.score }))

  it('"카메라 렌즈": 분류 우선이면 카드가 전부 카메라·렌즈, 기존 검색이면 드론이 첫 카드', () => {
    const { index } = build(LABELS)
    const opts = { fuzzy: 0.2, prefix: true, limit: 30 }
    const withIntent = pickRecommendCards(toHits(createCategoryIntentSearch(index, LABELS)('카메라 렌즈', opts)), rows, prices, { minScore: 4 })
    const plain = pickRecommendCards(toHits(index.search('카메라 렌즈', opts)), rows, prices, { minScore: 4 })
    // 카드 수는 pickRecommendCards의 "1위 대비 35%" 규칙이 정한다(작은 합성 픽스처는 점수 분포가 좁아 2장일 수 있음) — 여기서는 분류가 맞는 카드만 나오는지 본다
    expect(withIntent.length).toBeGreaterThanOrEqual(2)
    expect(withIntent.every((c) => ['camera', 'lens'].includes(cat(c.product_id)))).toBe(true)
    expect(plain[0].product_id).toBe('d1')
  })
  it('"조명"처럼 분류 일치가 적을 때도 카드가 비지 않고 분류 상품이 먼저 나온다', () => {
    const { index } = build(LABELS)
    const opts = { fuzzy: 0.2, prefix: true, limit: 30 }
    const plainCards = pickRecommendCards(toHits(index.search('카메라 조명', opts)), rows, prices, { minScore: 4 })
    const cards = pickRecommendCards(toHits(createCategoryIntentSearch(index, LABELS)('카메라 조명', opts)), rows, prices, { minScore: 4 })
    expect(cards.length).toBeGreaterThan(0)
    expect(cat(cards[0].product_id)).toBe('light')
    expect(cat(plainCards[0].product_id)).not.toBe('light')
  })
})

describe('reorderByCategoryIntent — 2구간 점수 압축', () => {
  const mk = (id: string, category: string, score: number) => ({ document: { id, category }, score, terms: [], queryTerms: [] })
  it('분류 일치 구간을 앞에 두고 나머지 점수를 일치 구간 최저점 아래로 압축(상대 순서 유지)', () => {
    const out = reorderByCategoryIntent([mk('x', 'drone', 60), mk('a', 'camera', 50), mk('y', 'light', 40), mk('b', 'camera', 10)], ['camera'])
    expect(out.map((r) => r.document.id)).toEqual(['a', 'b', 'x', 'y'])
    expect(out[2].score).toBeLessThan(10)
    expect(out[2].score).toBeGreaterThan(out[3].score)
  })
  it('점수가 0 이하이면 압축하지 않고 구간만 나눈다(순서 뒤집힘 방지)', () => {
    const out = reorderByCategoryIntent([mk('x', 'drone', 5), mk('a', 'camera', 0), mk('y', 'light', -1)], ['camera'])
    expect(out.map((r) => r.document.id)).toEqual(['a', 'x', 'y'])
    expect(out.map((r) => r.score)).toEqual([0, 5, -1])
  })
  it('일치 상품이 없거나 전부 일치면 그대로', () => {
    const a = [mk('x', 'drone', 60), mk('y', 'light', 40)]
    expect(reorderByCategoryIntent(a, ['camera']).map((r) => r.document.id)).toEqual(['x', 'y'])
    const b = [mk('p', 'camera', 60), mk('q', 'camera', 40)]
    expect(reorderByCategoryIntent(b, ['camera'])).toEqual(b)
  })
})

describe('buildCategoryLabelMap — code_mapping_groups 행 → 분류별 이름', () => {
  it('상품 분류 외 그룹도 그대로 담고, 비정상 행은 건너뛴다', () => {
    const m = buildCategoryLabelMap([
      { default_category: 'camera', name: '카메라' }, { default_category: 'camera', name: ' 캠 ' }, { default_category: 'lens', name: '렌즈' },
      { default_category: null, name: 'x' }, { default_category: 'light', name: '' }, null, 'bad',
    ])
    expect(m.get('camera')).toEqual(['카메라', '캠'])
    expect(m.get('lens')).toEqual(['렌즈'])
    expect(m.has('light')).toBe(false)
    expect(buildCategoryLabelMap(undefined).size).toBe(0)
  })
})
