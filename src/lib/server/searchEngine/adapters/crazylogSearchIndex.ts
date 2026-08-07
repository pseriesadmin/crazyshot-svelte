/**
 * adapters/crazylogSearchIndex.ts — 크레이지로그(user_posts) 자연어 검색 어댑터 (서버 전용)
 *
 * crazyshot 전용 코드: user_posts 테이블을 조회해 core가 이해하는 SearchDocument[]로 변환하고
 * MiniSearch 인덱스를 생성한다.
 *
 * 특징:
 * - 공개 게시물만 대상 (status='published' AND is_public=true) — RLS와 동일 조건
 * - 모듈 스코프 캐시 (TTL 60초) — Vercel Serverless 콜드스타트 시 즉시 재구축
 * - title / keywords(TEXT[]) / tags(TEXT[]) / content_blocks(JSONB → 텍스트 추출) / log_type 포함
 * - content_blocks 추출은 productSearchIndex.ts의 extractContentBlocksText() 재사용 (중복 구현 금지)
 * - 작성자명(author_name)은 user_profiles 별도 조회로 포함 — +page.server.ts와 동일 패턴
 *
 * boost 정책:
 *   title        → 5 (최고)
 *   keywords_text → 3 (중간)
 *   tags_text     → 3 (중간)
 *   content_text  → 1 (낮음)
 *   category      → 1 (낮음, log_type 매핑)
 *
 * ⚠️ 이 파일은 crazyshot 전용 import 포함 가능 (adapters/ 계층)
 */

import { supabase } from '$lib/services/supabase'
import { createIndex } from '../core/createIndex'
import type { NaturalSearchProvider, SearchDocument } from '../core/types'
import { extractContentBlocksText } from './productSearchIndex'

// ── 문서 타입 ────────────────────────────────────────────────────────────────

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

// ── 인덱스 설정 ───────────────────────────────────────────────────────────────

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

// ── 모듈 스코프 캐시 (TTL 60초) ──────────────────────────────────────────────

const CACHE_TTL_MS = 60_000

let cachedIndex: NaturalSearchProvider<CrazylogDoc> | null = null
let cachedAt = 0

function isCacheValid(): boolean {
  return cachedIndex !== null && Date.now() - cachedAt < CACHE_TTL_MS
}

// ── 내보내기 함수 ─────────────────────────────────────────────────────────────

/**
 * 공개 크레이지로그 전체를 조회해 MiniSearch 인덱스를 빌드합니다.
 * TTL 내 재호출은 캐시 재사용, 만료 시 재구축.
 *
 * @returns 즉시 search() 호출 가능한 NaturalSearchProvider
 */
export async function getCrazylogSearchIndex(): Promise<NaturalSearchProvider<CrazylogDoc>> {
  if (isCacheValid()) return cachedIndex!

  // 공개 게시물만 조회 (RLS와 동일 조건: status='published' AND is_public=true)
  const { data: rawPosts, error } = await supabase
    .from('user_posts')
    .select('id, title, log_type, content_blocks, keywords, tags, thumbnail_url, created_at, user_id')
    .eq('status', 'published')
    .eq('is_public', true)

  if (error || !rawPosts) {
    console.error('[crazylogSearchIndex] user_posts 조회 실패:', error?.message)
    return createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, [])
  }

  // 작성자명 별도 조회 (+page.server.ts와 동일 패턴, N+1 방지)
  const posts = rawPosts as Record<string, unknown>[]
  const userIds = [...new Set(posts.map((p) => String(p['user_id'] ?? '')).filter(Boolean))]
  const authorMap: Record<string, string> = {}

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, full_name')
      .in('id', userIds)
    for (const profile of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (profile.id) authorMap[profile.id] = profile.full_name ?? '익명'
    }
  }

  const docs: CrazylogDoc[] = posts.map((row) => ({
    id:            String(row['id'] ?? ''),
    title:         String(row['title'] ?? ''),
    category:      String(row['log_type'] ?? ''),
    keywords_text: Array.isArray(row['keywords'])
      ? (row['keywords'] as string[]).join(' ')
      : '',
    tags_text: Array.isArray(row['tags'])
      ? (row['tags'] as string[]).join(' ')
      : '',
    content_text:  extractContentBlocksText(row['content_blocks']),
    author_name:   authorMap[String(row['user_id'] ?? '')] ?? '익명',
    thumbnail_url: row['thumbnail_url'] ? String(row['thumbnail_url']) : null,
    created_at:    String(row['created_at'] ?? ''),
    user_id:       String(row['user_id'] ?? ''),
  }))

  cachedIndex = createIndex<CrazylogDoc>(CRAZYLOG_INDEX_CONFIG, docs)
  cachedAt = Date.now()
  return cachedIndex
}

/**
 * 캐시를 강제 무효화합니다 (테스트 또는 수동 갱신 시 사용).
 */
export function invalidateCrazylogSearchCache(): void {
  cachedIndex = null
  cachedAt = 0
}
