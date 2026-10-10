/**
 * crazylogKeywordParts.test.ts — 크레이지로그 검색: 붙여 쓴 키워드의 끝말 색인 (2026-10-10)
 *
 * 문제: 키워드 `10월출시예정`은 "출시예정"·"출시"로 검색하면 못 찾았다(단어 앞부분만 일치하는 prefix 방식).
 * 해결: 키워드·태그의 한글 단어 끝부분(끝말)을 `keyword_parts` 칸(가중치 낮음)에 추가 색인한다.
 * 실제 설정(CRAZYLOG_INDEX_CONFIG)과 문서 변환(buildCrazylogDocs)을 그대로 사용한다 — 순수 모듈이라 Supabase 없이 실행된다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createIndex } from '$lib/server/searchEngine/core/createIndex'
import {
  CRAZYLOG_INDEX_CONFIG,
  buildCrazylogDocs,
  extractKeywordSuffixes,
  type CrazylogDoc,
} from '$lib/server/searchEngine/adapters/crazylogSearchDocs'

describe('extractKeywordSuffixes — 끝말 추출', () => {
  it('붙여 쓴 한글 키워드의 끝말을 돌려준다(통째 단어는 제외)', () => {
    const r = extractKeywordSuffixes('10월출시예정')
    expect(r).toContain('출시예정')
    expect(r).toContain('예정')
    expect(r).not.toContain('10월출시예정')
  })

  it('4자 이상 단어에서만 만든다 — 짧은 단어는 이미 단독으로 색인된다', () => {
    expect(extractKeywordSuffixes('카메라')).toEqual([])
    expect(extractKeywordSuffixes('소식')).toEqual([])
    expect(extractKeywordSuffixes('장비소식')).toContain('소식')
  })

  it('끝말은 2자 이상이고 한글로 시작한다 — 숫자·영문으로 시작하는 끝말과 영문 단어는 만들지 않는다', () => {
    const r = extractKeywordSuffixes('인스타360셀피스틱 insta360 Insta360')
    expect(r).toContain('셀피스틱')
    for (const s of r) {
      expect(s.length).toBeGreaterThanOrEqual(2)
      expect(/^[가-힣]/.test(s)).toBe(true)
    }
    expect(r.some((s) => s.includes('insta'))).toBe(false)
  })

  it('여러 단어·구분자(공백·쉼표·슬래시 등)를 각각 처리하고 중복을 제거한다', () => {
    const r = extractKeywordSuffixes('장비소식 10월소식, 장비소식/신제품소식')
    expect(r.filter((s) => s === '소식')).toHaveLength(1)
  })

  it('빈 입력·해당 없는 입력은 빈 배열이고, 결과 수에 상한이 있다', () => {
    expect(extractKeywordSuffixes('')).toEqual([])
    expect(extractKeywordSuffixes('abc 123')).toEqual([])
    const many = Array.from({ length: 200 }, (_, i) => `가나다라마바사${String.fromCharCode(0xac00 + i * 7)}${String.fromCharCode(0xac00 + i * 11)}`).join(' ')
    expect(extractKeywordSuffixes(many).length).toBeLessThanOrEqual(60)
  })
})

describe('buildCrazylogDocs — 문서 변환', () => {
  const rows = [
    { id: 'P1', title: '[카메라 소식] 10월 신제품 일정', log_type: '상품리뷰', keywords: ['10월출시예정', '10월소식', '장비소식'], tags: ['10월출시예정', '10월소식', '장비소식'], content_blocks: [{ type: 'text', html: '<p>인스타360 액션 인비저블 셀피스틱은 신제품</p>' }], thumbnail_url: null, created_at: '2026-10-09', user_id: 'u1' },
    { id: 'P2', title: '[리마인] 리센느 채널 홍보 1차', log_type: '채널홍보', keywords: ['리센느', '안원잘부', '리마인'], tags: ['리센느'], content_blocks: [], thumbnail_url: null, created_at: '2026-10-08', user_id: 'u2' },
    { id: 'P3', title: '출시 일정 안내', log_type: '일상공유', keywords: ['출시'], tags: [], content_blocks: [], thumbnail_url: null, created_at: '2026-10-07', user_id: 'u3' },
  ]
  const docs = buildCrazylogDocs(rows, { u1: '운영관리자' })

  it('기존 필드는 그대로 만들고, keyword_parts를 추가한다', () => {
    const d = docs.find((x) => x.id === 'P1')!
    expect(d.title).toContain('10월 신제품')
    expect(d.keywords_text).toBe('10월출시예정 10월소식 장비소식')
    expect(d.tags_text).toBe('10월출시예정 10월소식 장비소식')
    expect(d.author_name).toBe('운영관리자')
    expect(d.keyword_parts).toContain('출시예정')
    expect(docs.find((x) => x.id === 'P2')!.author_name).toBe('익명')
  })

  it('키워드와 태그가 같아도 끝말은 중복 없이 한 번만 담는다', () => {
    const d = docs.find((x) => x.id === 'P1')!
    const parts = d.keyword_parts.split(' ')
    expect(new Set(parts).size).toBe(parts.length)
  })

  it('키워드·태그가 비어 있거나 배열이 아니어도 깨지지 않는다', () => {
    const [d] = buildCrazylogDocs([{ id: 'X', title: 't', log_type: '', keywords: null, tags: undefined, content_blocks: null, user_id: '' }], {})
    expect(d.keywords_text).toBe('')
    expect(d.keyword_parts).toBe('')
  })

  const idx = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, docs)
  const ids = (q: string): string[] => idx.search(q, { fuzzy: 0.2, prefix: true, limit: 10 }).map((r) => r.document.id)

  it('붙여 쓴 키워드의 끝말로 검색해도 찾는다(이전엔 못 찾던 "출시예정"·"예정")', () => {
    expect(ids('출시예정')).toContain('P1')
    expect(ids('예정')).toContain('P1')
    expect(ids('출시')).toContain('P1')
  })

  it('이미 찾던 검색은 그대로 찾는다(회귀 없음)', () => {
    expect(ids('10월소식')[0]).toBe('P1')
    expect(ids('소식')).toContain('P1')
    expect(ids('신제품')).toContain('P1')
    expect(ids('리센느')[0]).toBe('P2')
  })

  it('끝말 일치는 보조 신호다 — 키워드가 "출시"인 글이 "…출시예정" 글보다 앞에 선다', () => {
    const r = ids('출시')
    expect(r.indexOf('P3')).toBeGreaterThanOrEqual(0)
    expect(r.indexOf('P3')).toBeLessThan(r.indexOf('P1'))
  })

  it('keyword_parts 가중치는 키워드(3)보다 약하다', () => {
    const b = CRAZYLOG_INDEX_CONFIG.boost
    expect(b.keyword_parts).toBeGreaterThan(0)
    expect(b.keyword_parts).toBeLessThan(b.keywords_text)
  })
})

describe('배선 — 실제 어댑터가 순수 모듈을 사용한다', () => {
  const s = readFileSync('src/lib/server/searchEngine/adapters/crazylogSearchIndex.ts', 'utf-8')
  it('문서 변환과 설정을 crazylogSearchDocs에서 가져오고, 공개·AI저장 허용 필터는 그대로다', () => {
    expect(s).toContain("from './crazylogSearchDocs'")
    expect(s).toContain('buildCrazylogDocs(')
    expect(s).toContain(".eq('allow_ai_save', true)")
  })
})
