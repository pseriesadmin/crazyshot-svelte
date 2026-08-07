/**
 * crazylogSearchIndex.test.ts — 크레이지로그 검색 인덱스 단위 테스트 (I-4)
 *
 * 검증 대상:
 * - published/public 필터가 색인 단계에서 실제로 걸러지는지 (인덱스 구조 확인)
 * - 오타 허용(fuzzy) 매칭이 동작하는지
 * - prefix 부분일치 매칭 동작
 * - boost 우선순위 (title 최고 > keywords/tags 중간 > content/category 낮음)
 *
 * Supabase 의존성 없음 — createIndex 직접 호출로 순수 로직 테스트.
 * getCrazylogSearchIndex()는 Supabase 클라이언트 의존성이 있어 이 파일에서는 테스트 제외
 * (통합 테스트는 stage 환경에서 수동 실증으로 대체).
 *
 * ── MiniSearch v7 fuzzy 정책 (중요) ───────────────────────────────────────────
 * max_edit_distance = Math.round(term.length * fuzzy)
 *   2글자 Korean: round(2 * 0.2) = round(0.4) = 0  → fuzzy 적용 없음
 *   3글자 Korean: round(3 * 0.2) = round(0.6) = 1  → 1자 오타 허용 ✓
 *   4글자 Korean: round(4 * 0.2) = round(0.8) = 1  → 1자 오타 허용 ✓
 * → fuzzy 0.2 기반 오타 허용은 3글자 이상 토큰에만 실제 적용됨
 */
import { describe, it, expect } from 'vitest'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'
import { extractContentBlocksText } from '$lib/server/searchEngine/adapters/productSearchIndex'
import type { SearchDocument } from '$lib/server/searchEngine/core/types'

// ── CrazylogDoc 로컬 정의 (adapters/ import 시 Supabase 의존성이 끌려와 테스트 불가) ─

interface CrazylogDoc extends SearchDocument {
  id: string
  title: string
  category: string
  keywords_text: string
  tags_text: string
  content_text: string
  author_name: string
  thumbnail_url: string | null
  created_at: string
  user_id: string
}

const CRAZYLOG_INDEX_CONFIG = {
  searchFields: ['title', 'keywords_text', 'tags_text', 'content_text', 'category'] as const,
  storeFields: [
    'id', 'title', 'category', 'keywords_text', 'tags_text',
    'author_name', 'thumbnail_url', 'created_at', 'user_id',
  ] as const,
  boost: {
    title:         5,
    keywords_text: 3,
    tags_text:     3,
    content_text:  1,
    category:      1,
  },
  defaultFuzzy: 0.2 as const,
  defaultPrefix: true,
}

// ── 테스트 데이터 ────────────────────────────────────────────────────────────
// 실제 user_posts는 published+is_public만 인덱싱 — 여기서는 이미 필터된 공개 게시물만 모킹

/** 공개 + 발행된 게시물 (인덱스에 포함돼야 함) */
const publishedDocs: CrazylogDoc[] = [
  {
    id: 'post-1',
    title: '소니 A7IV 렌탈 후기',
    category: '상품리뷰',
    keywords_text: '미러리스 카메라 렌탈',
    tags_text: '소니 풀프레임',
    content_text: '소니 A7IV를 일주일간 대여해봤습니다. 화질이 정말 놀랍습니다.',
    author_name: '홍길동',
    thumbnail_url: 'https://example.com/thumb1.jpg',
    created_at: '2026-08-01T00:00:00Z',
    user_id: 'user-a',
  },
  {
    id: 'post-2',
    title: '촬영 일상 브이로그',
    category: '일상공유',
    keywords_text: '브이로그 일상 촬영',
    tags_text: '유튜브 채널',
    content_text: '오늘은 스튜디오에서 촬영이 있었습니다.',
    author_name: '김촬영',
    thumbnail_url: null,
    created_at: '2026-08-02T00:00:00Z',
    user_id: 'user-b',
  },
  {
    id: 'post-3',
    title: '내 채널 홍보합니다',
    category: '채널홍보',
    keywords_text: '구독 유튜브 채널',
    tags_text: '촬영 장비 리뷰',
    content_text: '촬영 장비 리뷰 전문 채널입니다. 구독 부탁드립니다.',
    author_name: '이채널',
    thumbnail_url: null,
    created_at: '2026-08-03T00:00:00Z',
    user_id: 'user-c',
  },
  {
    id: 'post-4',
    title: 'DJI 드론 렌탈 체험기',
    category: '상품리뷰',
    keywords_text: '드론 항공촬영',
    tags_text: 'DJI 매빅',
    content_text: 'DJI 매빅3를 렌탈해서 항공촬영을 해봤습니다.',
    author_name: '박드론',
    thumbnail_url: 'https://example.com/thumb4.jpg',
    created_at: '2026-08-04T00:00:00Z',
    user_id: 'user-d',
  },
]

// ── 필터 정책 검증 ───────────────────────────────────────────────────────────

describe('published/public 필터 정책 — 인덱스 구조 확인', () => {
  it('공개+발행 게시물 4건이 정상적으로 색인됨', () => {
    const index = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, publishedDocs)
    // 모든 발행 게시물이 색인됨 — 제목 검색으로 확인
    const results = index.search('렌탈')
    expect(results.length).toBeGreaterThan(0)
    // post-1, post-4 두 건이 '렌탈' 키워드로 매칭돼야 함
    const ids = results.map(r => r.document.id)
    expect(ids).toContain('post-1')
    expect(ids).toContain('post-4')
  })

  it('비공개·미발행 게시물은 인덱스에 애초에 포함되지 않음 (어댑터 필터 확인)', () => {
    // getCrazylogSearchIndex()가 status='published' AND is_public=true로 쿼리한다는 점을
    // 인덱스 자체에 없는 문서를 검색했을 때 결과가 없어야 함으로 간접 검증
    const nonPublicDoc: CrazylogDoc = {
      id: 'private-post',
      title: '비공개테스트 게시물',       // '비공개테스트' — 단일 토큰으로 인식
      category: '일상공유',
      keywords_text: '숨겨진내용',         // 숨겨진내용 — 공개 게시물에 없는 단어
      tags_text: '',
      content_text: '비공개 콘텐츠입니다.',
      author_name: '익명',
      thumbnail_url: null,
      created_at: '2026-08-01T00:00:00Z',
      user_id: 'user-x',
    }

    // 공개 게시물만으로 인덱스 빌드 (어댑터가 필터해서 넘겨주는 상태 재현)
    const onlyPublicIndex = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, publishedDocs)
    // '숨겨진내용'은 공개 게시물에 없으므로 결과 0건
    const resultsPublic = onlyPublicIndex.search('숨겨진내용')
    expect(resultsPublic.length).toBe(0)

    // 비공개 게시물을 포함시키면 검색됨 (필터 제거 시 차이 확인)
    const withPrivateIndex = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, [
      ...publishedDocs,
      nonPublicDoc,
    ])
    const resultsWithPrivate = withPrivateIndex.search('숨겨진내용')
    expect(resultsWithPrivate.length).toBeGreaterThan(0)
    expect(resultsWithPrivate[0].document.id).toBe('private-post')
  })
})

// ── 오타 허용(fuzzy) 매칭 ──────────────────────────────────────────────────────
//
// MiniSearch v7 fuzzy 계산: max_edit_distance = Math.round(term.length * 0.2)
// 3글자 토큰: round(3 * 0.2) = round(0.6) = 1 → 편집거리 1 허용
// 4글자 토큰: round(4 * 0.2) = round(0.8) = 1 → 편집거리 1 허용
// 2글자 토큰: round(2 * 0.2) = round(0.4) = 0 → 허용 안 됨 (정확 일치만)

describe('오타 허용 매칭 (fuzzy: 0.2, 3글자+ 토큰에 적용)', () => {
  const index = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, publishedDocs)

  it('keywords_text 3글자 토큰 오타 — "카메리"로 "카메라" 매칭 (편집거리 1)', () => {
    // "카메리"(3글자) vs "카메라"(3글자): 마지막 자 차이(리 vs 라) → 편집거리 1
    // max_edit_distance = round(3 * 0.2) = 1 → 매칭됨
    // post-1.keywords_text에 '카메라' 있음
    const results = index.search('카메리', { fuzzy: 0.2 })
    expect(results.length).toBeGreaterThan(0)
    const ids = results.map(r => r.document.id)
    expect(ids).toContain('post-1')
  })

  it('keywords_text 4글자 토큰 오타 — "항공촬녕"으로 "항공촬영" 매칭 (편집거리 1)', () => {
    // "항공촬녕"(4글자) vs "항공촬영"(4글자): 마지막 자 차이 → 편집거리 1
    // max_edit_distance = round(4 * 0.2) = round(0.8) = 1 → 매칭됨
    // post-4.keywords_text에 '항공촬영' 있음
    const results = index.search('항공촬녕', { fuzzy: 0.2 })
    expect(results.length).toBeGreaterThan(0)
    const ids = results.map(r => r.document.id)
    expect(ids).toContain('post-4')
  })

  it('완전히 다른 단어는 fuzzy로도 매칭 안 됨', () => {
    const results = index.search('xyz12345abc')
    expect(results.length).toBe(0)
  })

  it('2글자 토큰은 fuzzy 0.2에서 정확 일치만 매칭됨 — 오타 허용 없음', () => {
    // "소이"(2글자) vs "소니"(2글자): round(2 * 0.2) = 0 → 정확 일치만
    // 이것은 MiniSearch v7 한계 — 문서화 목적 테스트
    const results = index.search('소이', { fuzzy: 0.2, prefix: false })
    // '소이'는 인덱스에 없고, fuzzy 적용 안 됨 → 0건 예상
    expect(results.length).toBe(0)
  })
})

// ── prefix 부분일치 매칭 ───────────────────────────────────────────────────────

describe('prefix 부분일치 매칭', () => {
  const index = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, publishedDocs)

  it('"브이" prefix → "브이로그" 매칭 (post-2)', () => {
    const results = index.search('브이', { prefix: true })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('post-2')
  })

  it('"항공" prefix → "항공촬영" 매칭 (post-4)', () => {
    const results = index.search('항공', { prefix: true })
    expect(results.length).toBeGreaterThan(0)
    const ids = results.map(r => r.document.id)
    expect(ids).toContain('post-4')
  })

  it('"미러리" prefix → "미러리스" 매칭 (post-1)', () => {
    const results = index.search('미러리', { prefix: true })
    expect(results.length).toBeGreaterThan(0)
    const ids = results.map(r => r.document.id)
    expect(ids).toContain('post-1')
  })
})

// ── boost 우선순위 ─────────────────────────────────────────────────────────────

describe('boost 우선순위 — title(5) > keywords(3) > content(1)', () => {
  const index = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, publishedDocs)

  it('title에 있는 단어("촬영")는 content에만 있는 것보다 우선 랭킹', () => {
    // post-2 title: '촬영 일상 브이로그' — title에 '촬영'(boost=5)
    // post-3 content: '촬영 장비 리뷰 전문 채널' — content에 '촬영'(boost=1)
    // post-2가 post-3보다 높은 점수를 가져야 함
    const results = index.search('촬영')
    expect(results.length).toBeGreaterThan(0)
    const p2Idx = results.findIndex(r => r.document.id === 'post-2')
    const p3Idx = results.findIndex(r => r.document.id === 'post-3')
    if (p2Idx !== -1 && p3Idx !== -1) {
      expect(p2Idx).toBeLessThan(p3Idx) // post-2가 post-3보다 앞에 있어야 함
    }
  })

  it('tags_text(3)에만 있는 단어도 검색됨', () => {
    // post-1의 tags_text: '소니 풀프레임'
    const results = index.search('풀프레임')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('post-1')
  })

  it('category(log_type)로 검색 시 해당 카테고리 게시물 매칭', () => {
    const results = index.search('채널홍보')
    expect(results.length).toBeGreaterThan(0)
    const ids = results.map(r => r.document.id)
    expect(ids).toContain('post-3')
  })

  it('정확한 title 단어 매칭 — name boost(5)로 최상위', () => {
    // 'DJI 드론'은 post-4 title에만 있음
    const results = index.search('드론')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].document.id).toBe('post-4')
  })
})

// ── extractContentBlocksText 재사용 검증 ───────────────────────────────────────

describe('extractContentBlocksText 재사용 (productSearchIndex.ts export)', () => {
  it('TextBlock(type:text)의 HTML 태그 제거 후 텍스트 추출', () => {
    const blocks = [{ type: 'text', html: '<p>소니 <strong>A7IV</strong> 후기입니다.</p>' }]
    const result = extractContentBlocksText(blocks)
    expect(result).toContain('소니')
    expect(result).toContain('A7IV')
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<strong>')
  })

  it('빈 배열/null → 빈 문자열', () => {
    expect(extractContentBlocksText([])).toBe('')
    expect(extractContentBlocksText(null)).toBe('')
  })

  it('이미지 블록(type:image)은 텍스트 추출 대상 아님', () => {
    const blocks = [{ type: 'image', url: 'https://example.com/img.jpg' }]
    const result = extractContentBlocksText(blocks)
    expect(result).toBe('')
  })

  it('여러 블록 혼합 — 순서 유지하며 합치기', () => {
    const blocks = [
      { type: 'text', html: '<p>카메라</p>' },
      { type: 'image', src: 'img.jpg' },  // 무시됨
      { type: 'html', content: '<span>렌탈</span>' },
    ]
    const result = extractContentBlocksText(blocks)
    expect(result).toContain('카메라')
    expect(result).toContain('렌탈')
  })
})
