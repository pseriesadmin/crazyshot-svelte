/**
 * adapters/crazylogSearchDocs.ts — 크레이지로그 검색 문서·인덱스 설정 (순수 모듈, Supabase·$env 의존 없음)
 *
 * crazylogSearchIndex.ts(DB 조회·캐시)에서 분리한 부분: 문서 타입, 인덱스 설정, user_posts 행 → 검색 문서 변환.
 * 순수 모듈이라 단위 테스트가 실제 설정을 그대로 쓸 수 있다.
 *
 * keyword_parts(2026-10-10): 키워드·태그를 붙여 쓴 한글 단어("10월출시예정")는 단어 앞부분 일치(prefix)만으로는
 * "출시예정"·"출시"로 찾을 수 없다. 그래서 한글 단어의 끝말("출시예정"·"예정")을 보조 칸으로 추가 색인한다.
 * 상품 검색의 붙임말 사전(COMPOUND_HEAD_WORDS)과 달리 크레이지로그 키워드는 사용자가 자유롭게 짓는 말이라
 * 사전 없이 끝말을 일반 규칙으로 만든다. 가중치는 키워드(3)보다 낮아 "정확한 키워드 글"이 항상 앞에 선다.
 */

import type { SearchDocument } from '../core/types'
import { extractContentBlocksText } from './productSearchDocs'

export interface CrazylogDoc extends SearchDocument {
  id: string
  /** user_posts.title */
  title: string
  /** user_posts.log_type ('상품리뷰' | '일상공유' | '채널홍보') — 검색 필드 */
  category: string
  /** keywords TEXT[] → space-joined 문자열 */
  keywords_text: string
  /** tags TEXT[] → space-joined 문자열 */
  tags_text: string
  /** keywords·tags 한글 단어의 끝말(붙여 쓴 키워드 보조 검색용) */
  keyword_parts: string
  /** content_blocks JSONB → 텍스트 노드만 추출, space-joined */
  content_text: string
  /** user_profiles.full_name (저장 필드 — 결과 표시용) */
  author_name: string
  /** user_posts.thumbnail_url (저장 필드 — 결과 표시용) */
  thumbnail_url: string | null
  /** user_posts.created_at (저장 필드 — 결과 정렬/표시용) */
  created_at: string
  /** user_posts.user_id (저장 필드 — 역조회용) */
  user_id: string
}

// boost 정책:
//   title 5 > keywords_text·tags_text 3 > keyword_parts 1.5(끝말 일치는 보조 신호) > content_text·category 1
export const CRAZYLOG_INDEX_CONFIG = {
  searchFields: ['title', 'keywords_text', 'tags_text', 'keyword_parts', 'content_text', 'category'] as const,
  storeFields: [
    'id', 'title', 'category', 'keywords_text', 'tags_text',
    'author_name', 'thumbnail_url', 'created_at', 'user_id',
  ] as const,
  boost: {
    title:         5,
    keywords_text: 3,
    tags_text:     3,
    keyword_parts: 1.5,
    content_text:  1,
    category:      1,
  },
  defaultFuzzy: 0.2 as const,
  defaultPrefix: true,
}

// ── 끝말 추출 ────────────────────────────────────────────────────────────────

const MIN_WORD_LENGTH = 4   // 3자 이하 단어는 이미 단독으로 색인된다(끝말을 만들 이득이 없고 잡음만 늘어난다)
const MIN_SUFFIX_LENGTH = 2
const MAX_SUFFIX_LENGTH = 9 // 아주 긴 끝말은 사실상 단어 전체라 의미 없음
const MAX_PARTS = 60        // 글 하나당 상한(키워드가 비정상적으로 많아도 인덱스가 부풀지 않게)

/**
 * 텍스트의 한글 단어마다 끝말(뒤쪽 2자 이상, 한글로 시작)을 모아 돌려준다(중복 제거, 단어 통째는 제외).
 *  · 예) "10월출시예정" → 월출시예정·출시예정·시예정·예정 / "장비소식" → 비소식·소식
 *  · 숫자·영문으로 시작하는 끝말과 한글이 없는 단어(Insta360 등)는 만들지 않는다
 */
export function extractKeywordSuffixes(text: string): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const raw of text.split(/[\s,.!?~·/\-_()+[\]]+/)) {
    if (out.size >= MAX_PARTS) break
    const word = raw.toLowerCase()
    if (word.length < MIN_WORD_LENGTH || !/[가-힣]/.test(word)) continue
    const maxLen = Math.min(word.length - 1, MAX_SUFFIX_LENGTH)
    for (let len = MIN_SUFFIX_LENGTH; len <= maxLen; len++) {
      const suffix = word.slice(word.length - len)
      if (/^[가-힣]/.test(suffix)) out.add(suffix)
      if (out.size >= MAX_PARTS) break
    }
  }
  return [...out]
}

// ── user_posts 행 → 검색 문서 (순수 함수) ─────────────────────────────────────

export function buildCrazylogDocs(
  rows: readonly Record<string, unknown>[],
  authorMap: Readonly<Record<string, string>>,
): CrazylogDoc[] {
  return rows.map((row) => {
    const keywords_text = Array.isArray(row['keywords']) ? (row['keywords'] as string[]).join(' ') : ''
    const tags_text = Array.isArray(row['tags']) ? (row['tags'] as string[]).join(' ') : ''
    return {
      id:            String(row['id'] ?? ''),
      title:         String(row['title'] ?? ''),
      category:      String(row['log_type'] ?? ''),
      keywords_text,
      tags_text,
      keyword_parts: extractKeywordSuffixes(`${keywords_text} ${tags_text}`).join(' '),
      content_text:  extractContentBlocksText(row['content_blocks']),
      author_name:   authorMap[String(row['user_id'] ?? '')] ?? '익명',
      thumbnail_url: row['thumbnail_url'] ? String(row['thumbnail_url']) : null,
      created_at:    String(row['created_at'] ?? ''),
      user_id:       String(row['user_id'] ?? ''),
    }
  })
}
