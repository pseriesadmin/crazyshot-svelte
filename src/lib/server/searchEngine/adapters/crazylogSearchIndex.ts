/**
 * adapters/crazylogSearchIndex.ts — 크레이지로그(user_posts) 자연어 검색 어댑터 (서버 전용)
 *
 * crazyshot 전용 코드: user_posts 테이블을 조회해 core가 이해하는 SearchDocument[]로 변환하고
 * MiniSearch 인덱스를 생성한다.
 *
 * 특징:
 * - 공개 게시물만 대상 (status='published' AND is_public=true) — RLS와 동일 조건, 작성자가 'AI·자동 저장'을 끈 글(allow_ai_save=false)은 제외
 * - 모듈 스코프 캐시 (TTL 60초) — Vercel Serverless 콜드스타트 시 즉시 재구축
 * - title / keywords(TEXT[]) / tags(TEXT[]) / content_blocks(JSONB → 텍스트 추출) / log_type 포함
 * - content_blocks 추출은 productSearchDocs.ts의 extractContentBlocksText() 재사용 (중복 구현 금지)
 * - 작성자명(author_name)은 user_profiles 별도 조회로 포함 — +page.server.ts와 동일 패턴
 *
 * 문서 타입·인덱스 설정(boost 정책)·행→문서 변환은 순수 모듈 crazylogSearchDocs.ts에 있다(이 파일은 DB 조회·캐시만).
 * keyword_parts(2026-10-10): 붙여 쓴 키워드의 끝말("10월출시예정" → "출시예정")을 보조 칸으로 색인.
 *
 * ⚠️ 이 파일은 crazyshot 전용 import 포함 가능 (adapters/ 계층)
 */

import { supabase } from '$lib/services/supabase'
import { createIndex } from '../core/createIndex'
import type { NaturalSearchProvider } from '../core/types'
import { CRAZYLOG_INDEX_CONFIG, buildCrazylogDocs, type CrazylogDoc } from './crazylogSearchDocs'

export type { CrazylogDoc }

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
    // 작성자가 'AI·자동 저장'을 끈 글은 검색 인덱스(자동 수집 대상)에서 제외 — 글 화면에는 영향 없음(2026-10-06)
    .eq('allow_ai_save', true)

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

  const docs = buildCrazylogDocs(posts, authorMap)

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
