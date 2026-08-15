/**
 * crossLingualSynonymScan.ts — 이중언어 괄호 패턴 → 동의어 후보 등록 어댑터
 *
 * extractBilingualPairs(text)로 한글↔영문 쌍을 추출하고,
 * 각 쌍을 find_or_create_synonym_group + upsert_synonym_member(× 2)로
 * synonym_group_members에 cross_lingual_pattern 출처로 등록합니다.
 *
 * weight=2 (upsert 2회): promote_threshold(기본 3)에 대해
 *   첫 관찰(동일 텍스트): occurrence_count=1→2 → candidate
 *   둘째 관찰(다른 텍스트): occurrence_count=2→3 → confirmed 자동 승격
 * cross_lingual_pattern은 query_reformulation(weight=1)보다 신뢰도 높은 신호이므로
 * weight=2로 더 빠른 승격 경로를 부여합니다.
 *
 * ⚠️ 이 파일은 서버 전용 ($env/static/private 사용). 클라이언트 번들 포함 금지.
 * ⚠️ registerCrossLingualCandidates는 fire-and-forget — 에러 무시 계약.
 *    호출부에서 .catch(() => {}) 처리 필수. 어떤 저장 흐름도 블록하면 안 됩니다.
 */

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { extractBilingualPairs } from './searchEngine/core/crossLingualPatternExtractor'
import { SYNONYM_PROMOTE_THRESHOLD } from './synonymLearning'

/**
 * 텍스트에서 이중언어 쌍을 추출하고 동의어 후보로 DB에 등록합니다.
 *
 * 추출된 각 (hangul, latin) 쌍에 대해:
 *   1. hangul을 canonical term으로 하는 동의어 그룹을 찾거나 생성
 *   2. hangul과 latin 각각을 upsert × 2 (weight=2, source='cross_lingual_pattern')
 *      → 두 번째 텍스트에서 동일 패턴 발견 시 자동으로 confirmed 승격
 *
 * ⚠️ Fire-and-forget: 호출 후 await 없이 .catch(() => {}) 처리해야 합니다.
 *    상품 저장·채팅 발신·상담 기록 흐름을 절대 블록하지 않습니다.
 *
 * @param text 상품명/캡션/콘텐츠/채팅 메시지/CS 요약 등 임의 텍스트
 */
export async function registerCrossLingualCandidates(text: string): Promise<void> {
  try {
    const pairs = extractBilingualPairs(text)
    if (pairs.length === 0) return

    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    for (const { hangul, latin } of pairs) {
      // 1. 한글을 canonical term으로 그룹 찾기/생성
      const { data: groupId, error: groupErr } = await admin.rpc('find_or_create_synonym_group', {
        p_canonical_term: hangul,
      })
      if (groupErr || !groupId) continue

      // 2. 한글 term 등록 × 2 (weight=2, cross_lingual_pattern)
      //    한글 자체도 member로 등록 → "Sony" 검색 시 한글도 역방향 확장 가능
      for (let i = 0; i < 2; i++) {
        await admin.rpc('upsert_synonym_member', {
          p_group_id: groupId,
          p_term: hangul,
          p_threshold: SYNONYM_PROMOTE_THRESHOLD,
          p_source: 'cross_lingual_pattern',
        })
      }

      // 3. 영문 term 등록 × 2 (weight=2, cross_lingual_pattern)
      for (let i = 0; i < 2; i++) {
        await admin.rpc('upsert_synonym_member', {
          p_group_id: groupId,
          p_term: latin,
          p_threshold: SYNONYM_PROMOTE_THRESHOLD,
          p_source: 'cross_lingual_pattern',
        })
      }
    }
  } catch {
    // fire-and-forget: 에러 무시 (저장/발신/기록 흐름 보호)
  }
}

/**
 * 여러 텍스트 조각을 하나로 합쳐 스캔합니다.
 * 상품 저장 시 name·brand·product_caption·content_blocks 등을 한 번에 처리합니다.
 *
 * @param parts 스캔할 텍스트 파트 목록 (null/undefined 허용, 자동 제거)
 */
export async function registerCrossLingualCandidatesFromParts(
  parts: (string | null | undefined)[],
): Promise<void> {
  const combined = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
  return registerCrossLingualCandidates(combined)
}
