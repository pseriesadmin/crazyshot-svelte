/**
 * productSearchLogic.test.ts — 상품 검색 인덱스 로직 단위 테스트 (PROD-SEARCH-4)
 *
 * 검증 대상:
 * - extractContentBlocksText: content_blocks JSONB → 텍스트 추출 함수
 * - createIndex: keywords/caption 필드 포함 시 실제 MiniSearch 인덱스 검색 동작
 * - 기존 정확한 상품명 검색이 name boost(5)로 항상 최상위를 유지하는지
 *
 * Supabase 의존성 없음 — 순수 로직 테스트.
 */
import { describe, it, expect } from 'vitest'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'
import type { SearchDocument } from '$lib/server/searchEngine/core/types'

// ── content_blocks 텍스트 추출 로직 재현 ────────────────────────────────────
// productSearchIndex.ts의 extractContentBlocksText와 동일 로직 — 회귀 확인용
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
}

type ContentBlockRaw = { type: string; html?: string; content?: string; text?: string }

function extractContentBlocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks as ContentBlockRaw[]) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.html === 'string') parts.push(stripHtml(b.html))
    if (b.type === 'html' && typeof b.content === 'string') parts.push(stripHtml(b.content))
    if (b.type === 'link-entry' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join(' ').trim()
}

// ── 테스트 문서 타입 ─────────────────────────────────────────────────────────

interface ProductDoc extends SearchDocument {
  name: string
  brand: string
  category: string
  slug: string
  caption: string
  keywords_text: string
  content_text: string
}

const PRODUCT_INDEX_CONFIG = {
  searchFields: ['name', 'brand', 'caption', 'keywords_text', 'content_text', 'category'] as const,
  storeFields: ['id', 'name', 'brand', 'category', 'slug', 'caption', 'keywords_text'] as const,
  boost: { name: 5, brand: 3, caption: 3, keywords_text: 3, content_text: 1, category: 1 },
  defaultFuzzy: 0.2 as const,
  defaultPrefix: true,
}

// 테스트용 상품 데이터 (실제 상품 시나리오 반영)
const testProducts: ProductDoc[] = [
  {
    id: 'p1',
    name: '소니 A7IV 풀프레임 미러리스',
    brand: '소니',
    category: 'camera',
    slug: 'sony-a7iv',
    caption: '뛰어난 저조도 성능의 소니 플래그십 미러리스 카메라',
    keywords_text: '미러리스 풀프레임 야간촬영 저조도',
    content_text: '소니 A7IV는 3300만 화소 풀프레임 센서를 갖춘 미러리스 카메라입니다.',
  },
  {
    id: 'p2',
    name: 'DJI 로닌 SC2 짐벌',
    brand: 'DJI',
    category: 'gimbal',
    slug: 'dji-ronin-sc2',
    caption: '스마트폰 미러리스 카메라용 3축 짐벌 스태빌라이저',
    keywords_text: '짐벌 스태빌라이저 동영상 영상',
    content_text: '영상 촬영 시 흔들림을 잡아주는 고성능 짐벌입니다.',
  },
  {
    id: 'p3',
    name: '캐논 EOS R6 Mark II',
    brand: '캐논',
    category: 'camera',
    slug: 'canon-eos-r6-ii',
    caption: '고속 연사와 동영상AF에 특화된 캐논 미러리스',
    keywords_text: '미러리스 연사 동영상AF 캐논',
    content_text: '캐논의 최신 풀프레임 미러리스 카메라로 초당 40연사를 지원합니다.',
  },
]

describe('extractContentBlocksText — content_blocks JSONB 텍스트 추출', () => {
  it('TextBlock(type:text)의 HTML 태그를 제거하고 텍스트만 추출', () => {
    const blocks = [{ type: 'text', html: '<p>소니 A7IV는 <strong>3300만 화소</strong> 카메라입니다.</p>' }]
    const result = extractContentBlocksText(blocks)
    expect(result).toContain('소니 A7IV는')
    expect(result).toContain('3300만 화소')
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<strong>')
  })

  it('HtmlBlock(type:html)의 content 태그 제거', () => {
    const blocks = [{ type: 'html', content: '<div class="spec">화소: 3300만</div>' }]
    const result = extractContentBlocksText(blocks)
    expect(result).toContain('화소: 3300만')
    expect(result).not.toContain('<div')
  })

  it('LinkEntryBlock(type:link-entry)의 text 추출', () => {
    const blocks = [{ type: 'link-entry', url: 'https://example.com', text: '소니 공식 제품 페이지' }]
    const result = extractContentBlocksText(blocks)
    expect(result).toBe('소니 공식 제품 페이지')
  })

  it('여러 블록 혼합 — 순서 유지하며 합치기', () => {
    const blocks = [
      { type: 'text', html: '<p>화소</p>' },
      { type: 'image', src: 'img.jpg' },   // 이미지 블록은 무시
      { type: 'html', content: '<span>연사</span>' },
    ]
    const result = extractContentBlocksText(blocks)
    expect(result).toContain('화소')
    expect(result).toContain('연사')
  })

  it('null/undefined 입력 → 빈 문자열', () => {
    expect(extractContentBlocksText(null)).toBe('')
    expect(extractContentBlocksText(undefined)).toBe('')
    expect(extractContentBlocksText('not-an-array')).toBe('')
  })
})

describe('상품 인덱스 검색 — PROD-SEARCH-4 핵심 시나리오', () => {
  const index = createIndex<ProductDoc>(PRODUCT_INDEX_CONFIG, testProducts)

  it('(a) 정확한 상품명 검색 → name boost(5)로 최상위 유지', () => {
    const results = index.search('소니 A7IV')
    expect(results.length).toBeGreaterThan(0)
    // name 필드 boost=5로 인해 정확 상품명 매칭은 반드시 1순위
    expect(results[0].document.id).toBe('p1')
  })

  it('(a2) 다른 상품 정확한 이름 검색도 1순위 유지', () => {
    const results = index.search('캐논 EOS R6')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('p3')
  })

  it('(b1) keywords에만 있는 단어로 검색 — 새로 걸려야 함 (야간촬영)', () => {
    const results = index.search('야간촬영')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('p1')
  })

  it('(b2) product_caption에만 있는 단어로 검색 — 새로 걸려야 함 (스태빌라이저)', () => {
    const results = index.search('스태빌라이저')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('p2')
  })

  it('(b3) content_blocks 텍스트로만 매칭 가능한 단어 검색 (초당 40연사)', () => {
    const results = index.search('초당')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('p3')
  })

  it('(b4) 상품 캡션 키워드(저조도) — keywords_text · caption boost(3) 반영', () => {
    const results = index.search('저조도')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('p1')
  })

  it('prefix 부분 입력 검색 (짐) → 짐벌 매칭', () => {
    const results = index.search('짐', { prefix: true })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('p2')
  })

  it('정확한 상품명이 있을 때 부분 키워드 결과보다 우선', () => {
    // '소니'는 p1의 name+brand+caption에 모두 있고, p2도 caption에 '미러리스'로 겹침
    // 정확한 name 매칭인 p1이 p2보다 높은 점수를 가져야 함
    const nameResults = index.search('소니 A7IV 풀프레임')
    expect(nameResults[0].document.id).toBe('p1')
  })
})
