/**
 * synonymLearning.ts — 동의어 학습 파이프라인 (§E SYN-3/SYN-4/SYN-10/SYN-11/SYN-13)
 *
 * 관리자가 특정 캔드 리스폰스를 선택해 발송할 때, 해당 세션의 고객 메시지 토큰을
 * 동의어 후보(candidate)로 등록하고, 3회 이상 관찰 시 confirmed로 자동 승격합니다.
 *
 * §E SYN-10: 유사 후보 통계적 병합 — 편집거리 ≤1 유사 변형들을 같은 카운터에 합산해
 *   더 빠르고 지능적으로 동의어를 학습합니다.
 * §E SYN-11: usage_count 기반 가중치 — 이미 신뢰받는 빠른답변에서 학습된 표현일수록
 *   더 빠르게 승격됩니다.
 * §E SYN-13: DB 설정 테이블 기반 파라미터 튜닝 — promote_threshold, similarity_edit_distance_divisor,
 *   usage_weight_tiers를 synonym_learning_settings(싱글턴 1행)에서 읽어와 코드 배포 없이 조정합니다.
 *   60초 TTL 캐시 적용, 조회 실패 시 하드코딩 상수(FALLBACK_SETTINGS)로 안전하게 폴백합니다.
 *
 * 외부 AI API 없음 — 관리자 수동 발송 패턴 + 문자열 유사도 통계로만 학습합니다.
 *
 * ⚠️ 이 파일은 서버 전용 ($env/static/private 사용). 클라이언트 번들에 포함 금지.
 */

import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import type { SynonymGroupData } from './searchEngine/adapters/cannedResponseSearchIndex'
import { koreanTokenize, koreanProcessTerm } from './searchEngine/core/koreanTokenizer'

// ── §E SYN-4: 자동 승격 임계값 ───────────────────────────────────────────────
// candidate 상태의 동의어가 이 횟수 이상 관찰되면 confirmed로 자동 승격됩니다.
// DB RPC upsert_synonym_member의 p_threshold DEFAULT 값과 반드시 일치해야 합니다.
export const SYNONYM_PROMOTE_THRESHOLD = 3

// ── 타입 재수출 ───────────────────────────────────────────────────────────────
export type { SynonymGroupData }

// ── §E SYN-10/SYN-12: 편집거리 기반 유사 용어 판정 ─────────────────────────

/** Levenshtein 편집거리 계산 (matchCannedResponse.ts와 동일 알고리즘, 모듈 독립 복사) */
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  )
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

/**
 * §E SYN-12: 길이비례 허용 편집거리 공식의 계수.
 *
 * maxAllowedDistance = Math.max(0, Math.floor((minLen - 1) / SIMILARITY_EDIT_DISTANCE_DIVISOR))
 *
 * 이 값을 높이면 더 관대(더 많은 편집거리 허용), 낮추면 더 엄격.
 * 현재값 3의 의미:
 *   2~3자 단어 → maxAllowed=0 (완전일치·서브스트링만)
 *   4~6자 단어 → maxAllowed=1 (SYN-10 기존 동작과 동일)
 *   7~9자 단어 → maxAllowed=2
 *   10~12자    → maxAllowed=3
 *
 * §E SYN-13: DB 설정 테이블에서 오버라이드 가능 — FALLBACK_SETTINGS.similarityEditDistanceDivisor 참조
 */
export const SIMILARITY_EDIT_DISTANCE_DIVISOR = 3

/**
 * 두 용어가 동의어 통계 병합 대상인지 판정합니다 (§E SYN-10/SYN-12).
 *
 * §E SYN-12 개선: "4자 이상 하드 게이트" 제거 → 길이비례 허용 편집거리로 교체.
 * 어떤 길이의 단어도 원천 배제되지 않고, 짧을수록 자동으로 더 엄격한 기준 적용.
 *
 * §E SYN-13: divisor 파라미터로 DB 설정 테이블 값을 주입할 수 있습니다.
 *   생략 시 SIMILARITY_EDIT_DISTANCE_DIVISOR(하드코딩 fallback)를 사용합니다.
 *
 * 판정 순서:
 *   1. 완전 일치 (대소문자 무관) → true
 *   2. 서브스트링 포함 (한쪽이 다른 쪽 안에 있음) → true
 *   3. 길이비례 허용 편집거리 내 → true / 초과 → false
 *
 * @param tokenA  비교 대상 용어 A
 * @param tokenB  비교 대상 용어 B
 * @param divisor (optional) 길이비례 공식 계수 — 기본값: SIMILARITY_EDIT_DISTANCE_DIVISOR
 * @returns true → 기존 멤버 occurrence_count에 합산, false → 신규 후보 생성
 */
export function isSimilarTerm(
  tokenA: string,
  tokenB: string,
  divisor: number = SIMILARITY_EDIT_DISTANCE_DIVISOR,
): boolean {
  const a = tokenA.toLowerCase()
  const b = tokenB.toLowerCase()
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true

  // §E SYN-12: 길이비례 허용 편집거리
  //   minLen 기준으로 계산: 짧은 쪽이 기준 (더 보수적인 방향)
  //   §E SYN-13: divisor 파라미터로 DB 값 주입 가능 (기본: SIMILARITY_EDIT_DISTANCE_DIVISOR)
  const minLen = Math.min(a.length, b.length)
  const maxAllowedDistance = Math.max(0, Math.floor((minLen - 1) / divisor))
  if (maxAllowedDistance === 0) return false
  return Math.abs(a.length - b.length) <= maxAllowedDistance && levenshtein(a, b) <= maxAllowedDistance
}

// ── §E SYN-11: usage_count 구간별 학습 가중치 ────────────────────────────────

/**
 * usage_count 구간별 occurrence 증가폭 정의 (§E SYN-11).
 *
 * 구간은 내림차순으로 정렬돼 있어야 합니다 — getOccurrenceWeight가 첫 번째 매칭을 반환합니다.
 * 매직넘버 금지: 이 상수만 수정해 가중치 정책을 조정하세요.
 *
 * weight 의미:
 *   1 → 기본 (usage_count < 10 빠른답변, 표준 3회 관찰 필요)
 *   2 → 보통 신뢰 (usage_count 10~19, 2회 관찰로 임계값 도달 가능)
 *   3 → 높은 신뢰 (usage_count >= 20, 1회 관찰로 즉시 임계값 도달)
 *
 * §E SYN-13: DB 설정 테이블에서 오버라이드 가능 — FALLBACK_SETTINGS.usageWeightTiers 참조
 */
export const USAGE_WEIGHT_TIERS: ReadonlyArray<{ readonly minUsage: number; readonly weight: number }> = [
  { minUsage: 20, weight: 3 },
  { minUsage: 10, weight: 2 },
  { minUsage: 0,  weight: 1 },
]

/**
 * usage_count를 구간 테이블에 대조해 occurrence 증가폭을 반환합니다 (§E SYN-11).
 *
 * §E SYN-13: tiers 파라미터로 DB 설정 테이블 값을 주입할 수 있습니다.
 *   생략 시 USAGE_WEIGHT_TIERS(하드코딩 fallback)를 사용합니다.
 *
 * @param usageCount canned_response.usage_count 현재값
 * @param tiers      (optional) DB에서 읽어온 구간 정의 — 기본값: USAGE_WEIGHT_TIERS
 * @returns 증가폭 (기본 1~3, 커스텀 tiers 사용 시 해당 increment)
 */
export function getOccurrenceWeight(
  usageCount: number,
  tiers: ReadonlyArray<{ readonly minUsage: number; readonly weight: number }> = USAGE_WEIGHT_TIERS,
): number {
  for (const tier of tiers) {
    if (usageCount >= tier.minUsage) return tier.weight
  }
  return 1
}

// ── §E SYN-13: DB 설정 테이블 기반 파라미터 튜닝 ────────────────────────────────

/**
 * 동의어 학습 파라미터의 런타임 설정 구조.
 *
 * synonym_learning_settings 테이블(싱글턴)에서 읽어오며,
 * 조회 실패 시 FALLBACK_SETTINGS(하드코딩 기본값)로 폴백합니다.
 */
export interface SynonymLearningSettings {
  /** §E SYN-4: candidate → confirmed 자동 승격 임계값 (기본 3) */
  promoteThreshold: number
  /** §E SYN-12: 길이비례 허용 편집거리 공식 계수 (기본 3) */
  similarityEditDistanceDivisor: number
  /** §E SYN-11: usage_count 구간별 occurrence 증가폭 (기본 3단계) */
  usageWeightTiers: ReadonlyArray<{ readonly minUsage: number; readonly weight: number }>
}

/**
 * 하드코딩 폴백 설정 — 기존 상수와 완전히 동일한 값.
 *
 * DB 조회 실패, 테이블 없음, 행 없음 등 모든 예외 상황에서 이 값을 사용합니다.
 * 학습 기능이 DB 설정 오류로 멈추는 일이 없도록 방어적으로 설계됐습니다.
 */
export const FALLBACK_SETTINGS: SynonymLearningSettings = {
  promoteThreshold: SYNONYM_PROMOTE_THRESHOLD,
  similarityEditDistanceDivisor: SIMILARITY_EDIT_DISTANCE_DIVISOR,
  usageWeightTiers: USAGE_WEIGHT_TIERS,
}

// ── §E SYN-13: TTL 캐시 (60초) — productSearchIndex.ts와 동일 패턴 ─────────────

const SETTINGS_CACHE_TTL_MS = 60_000

let cachedSettings: SynonymLearningSettings | null = null
let settingsCachedAt = 0

/**
 * synonym_learning_settings 테이블에서 학습 파라미터를 읽어옵니다 (§E SYN-13).
 *
 * 60초 TTL 캐시 적용 — Vercel Serverless 환경에서 매 호출마다 DB 왕복하지 않습니다.
 * 테이블 조회 실패 또는 행 없음 → FALLBACK_SETTINGS 반환 (학습 기능 보호).
 *
 * ⚠️ 이 함수는 fire-and-forget 컨텍스트 내에서 호출됩니다.
 *    내부 예외는 모두 catch해 FALLBACK_SETTINGS를 반환합니다.
 *
 * @returns SynonymLearningSettings (DB 값 또는 fallback)
 */
export async function loadSynonymSettings(): Promise<SynonymLearningSettings> {
  // TTL 캐시 히트
  if (cachedSettings !== null && Date.now() - settingsCachedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings
  }

  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    type SettingsRow = {
      promote_threshold: number
      similarity_edit_distance_divisor: number
      usage_weight_tiers: Array<{ min_usage: number; increment: number }>
    }

    const { data, error } = await admin
      .from('synonym_learning_settings')
      .select('promote_threshold, similarity_edit_distance_divisor, usage_weight_tiers')
      .limit(1)
      .maybeSingle<SettingsRow>()

    if (error || !data) return FALLBACK_SETTINGS

    // DB JSONB [{min_usage, increment}] → 내부 형식 [{minUsage, weight}] (내림차순 정렬 보장)
    let weightTiers: SynonymLearningSettings['usageWeightTiers'] = FALLBACK_SETTINGS.usageWeightTiers
    if (Array.isArray(data.usage_weight_tiers) && data.usage_weight_tiers.length > 0) {
      const parsed = data.usage_weight_tiers
        .map((t) => ({ minUsage: t.min_usage, weight: t.increment }))
        .sort((a, b) => b.minUsage - a.minUsage) // 내림차순 보장 (getOccurrenceWeight 첫 매칭 전제)
      weightTiers = parsed
    }

    const settings: SynonymLearningSettings = {
      promoteThreshold:
        typeof data.promote_threshold === 'number'
          ? data.promote_threshold
          : FALLBACK_SETTINGS.promoteThreshold,
      similarityEditDistanceDivisor:
        typeof data.similarity_edit_distance_divisor === 'number'
          ? data.similarity_edit_distance_divisor
          : FALLBACK_SETTINGS.similarityEditDistanceDivisor,
      usageWeightTiers: weightTiers,
    }

    cachedSettings = settings
    settingsCachedAt = Date.now()
    return settings
  } catch {
    // DB 연결 실패 등 예외 — FALLBACK_SETTINGS로 안전하게 폴백 (학습 기능 보호)
    return FALLBACK_SETTINGS
  }
}

// ── extractLearningTokens ─────────────────────────────────────────────────────

/**
 * 고객 메시지에서 학습 대상 토큰을 추출합니다.
 *
 * 한국어 토크나이저로 분해 → 조사 제거(koreanProcessTerm) → 2자 이상 토큰 반환.
 * null 반환(1자 미만으로 줄어든 토큰)과 중복은 자동으로 제거됩니다.
 *
 * @param message 고객 메시지 원문
 * @returns 정규화된 학습 토큰 목록 (중복 제거, 2자 이상)
 */
export function extractLearningTokens(message: string): string[] {
  if (!message || !message.trim()) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of koreanTokenize(message)) {
    const normalized = koreanProcessTerm(raw)
    if (normalized !== null && normalized.length >= 2 && !seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

// ── loadSynonymGroups — TTL 캐시 ─────────────────────────────────────────────
// §F FIX-3: 고객 메시지 1건마다 DB를 새로 조회하던 문제를 TTL 캐시로 해소.
// 동의어 데이터는 학습 승격(SYNONYM_PROMOTE_THRESHOLD 회 관찰 후)에만 변경되므로
// 상품 검색 인덱스(productSearchIndex.ts)와 동일한 60초 TTL을 사용한다.
// 캐시 만료 또는 조회 실패 시 항상 [] 폴백 — 기존 동작 보존.

const SYNONYM_GROUPS_CACHE_TTL_MS = 60_000

let cachedSynonymGroups: SynonymGroupData[] | null = null
let synonymGroupsCachedAt = 0

/**
 * DB에서 confirmed 상태의 동의어 그룹 전체를 로드합니다.
 *
 * §F FIX-3: 60초 TTL 캐시 적용 — 고객 메시지가 빈번해도 DB 조회는 최대 분당 1회.
 * 캐시 만료 전까지는 새 승격 그룹이 즉시 반영되지 않으나(최대 60초 지연),
 * 동의어 학습이 실시간 경쟁조건보다 분 단위로 누적되므로 허용 가능한 지연.
 *
 * 검색 인덱스 구축(buildCannedResponseIndex) 전에 호출해 결과를 전달하세요.
 * 에러 시 빈 배열 반환 — 동의어 없이 기존 방식으로 동작합니다.
 *
 * @returns SynonymGroupData 배열 (canonicalTerm + confirmedTerms)
 */
export async function loadSynonymGroups(): Promise<SynonymGroupData[]> {
  // TTL 캐시 히트
  if (cachedSynonymGroups !== null && Date.now() - synonymGroupsCachedAt < SYNONYM_GROUPS_CACHE_TTL_MS) {
    return cachedSynonymGroups
  }

  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    type RawRow = {
      term: string
      synonym_groups: { canonical_term: string }
    }

    const { data, error } = await admin
      .from('synonym_group_members')
      .select('term, synonym_groups!inner(canonical_term)')
      .eq('status', 'confirmed')
      .returns<RawRow[]>()

    if (error || !data) return cachedSynonymGroups ?? []

    // term → canonical_term 그룹핑
    const groupMap = new Map<string, string[]>()
    for (const row of data) {
      const canonical = row.synonym_groups.canonical_term
      if (!groupMap.has(canonical)) groupMap.set(canonical, [])
      groupMap.get(canonical)!.push(row.term)
    }

    const groups = Array.from(groupMap.entries()).map(([canonicalTerm, confirmedTerms]) => ({
      canonicalTerm,
      confirmedTerms,
    }))

    cachedSynonymGroups = groups
    synonymGroupsCachedAt = Date.now()
    return groups
  } catch {
    // 조회 실패: 기존 캐시가 있으면 그것을 반환 (완전 실패보다 낫지만 stale일 수 있음)
    // 기존 캐시도 없으면 빈 배열 반환 — 동의어 확장 없이 기존 매칭으로 폴백
    return cachedSynonymGroups ?? []
  }
}

// ── recordSynonymLearning ─────────────────────────────────────────────────────

/**
 * 관리자가 특정 캔드 리스폰스를 선택·발송했을 때, 해당 세션의 고객 메시지에서
 * 학습 토큰을 추출해 canonical keyword의 동의어 후보로 DB에 기록합니다.
 *
 * §E SYN-13: promote_threshold·similarity_edit_distance_divisor·usage_weight_tiers를
 * synonym_learning_settings 테이블에서 읽어와 사용합니다 (60초 TTL 캐시).
 * 조회 실패 시 FALLBACK_SETTINGS(하드코딩 기본값)로 안전하게 폴백합니다.
 *
 * ⚠️ Fire-and-forget: 에러가 나도 발송 흐름에 영향을 주면 안 됩니다.
 *    호출부에서 .catch(() => {}) 처리 필수.
 *
 * @param cannedResponseId 관리자가 선택한 캔드 리스폰스 ID
 * @param sessionId        현재 채팅 세션 ID
 */
export async function recordSynonymLearning(
  cannedResponseId: string,
  sessionId: string,
): Promise<void> {
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // §E SYN-13: DB 설정 테이블에서 학습 파라미터 로드 (60초 TTL 캐시, 실패 시 fallback)
    const settings = await loadSynonymSettings()

    // 1. 캔드 리스폰스의 match_keywords + usage_count 조회
    //    match_keywords: canonical term 목록 / usage_count: §E SYN-11 가중치 계산에 사용
    type CannedRow = { match_keywords: string[] | null; usage_count: number | null }
    const { data: canned, error: cannedErr } = await admin
      .from('canned_responses')
      .select('match_keywords, usage_count')
      .eq('id', cannedResponseId)
      .single<CannedRow>()

    if (cannedErr || !canned) return
    const matchKeywords: string[] = Array.isArray(canned.match_keywords)
      ? canned.match_keywords
      : []
    if (matchKeywords.length === 0) return

    // §E SYN-11 + SYN-13: usage_count → DB 설정 구간별 가중치 계산
    const weight = getOccurrenceWeight(canned.usage_count ?? 0, settings.usageWeightTiers)

    // 2. 해당 세션의 가장 최근 고객 메시지 조회 (관리자 발송 직전 고객이 보낸 메시지)
    const { data: recentMsg, error: msgErr } = await admin
      .from('chat_messages')
      .select('content')
      .eq('session_id', sessionId)
      .eq('sender_type', 'user')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (msgErr || !recentMsg?.content) return

    // 3. 고객 메시지에서 학습 토큰 추출
    const tokens = extractLearningTokens(recentMsg.content as string)
    if (tokens.length === 0) return

    // 4. 각 canonical keyword별 동의어 그룹 찾거나 생성 후 토큰 upsert
    for (const canonical of matchKeywords) {
      const { data: groupId, error: groupErr } = await admin.rpc('find_or_create_synonym_group', {
        p_canonical_term: canonical,
      })
      if (groupErr || !groupId) continue

      // §E SYN-10: 기존 그룹 멤버 전체 조회 (candidate + confirmed)
      //   새 토큰을 기록하기 전에 유사 기존 멤버가 있는지 확인합니다.
      type MemberRow = { term: string }
      const { data: existingMembers } = await admin
        .from('synonym_group_members')
        .select('term')
        .eq('group_id', groupId)
        .returns<MemberRow[]>()
      const memberTerms = (existingMembers ?? []).map((m) => m.term)

      // §E SYN-10 + SYN-11 + SYN-13: 토큰별 처리
      for (const token of tokens) {
        // §E SYN-10/SYN-12/SYN-13: DB 설정 divisor를 적용한 유사 기존 멤버 탐색
        const similar = memberTerms.find((existing) =>
          isSimilarTerm(token, existing, settings.similarityEditDistanceDivisor),
        )
        // 유사 멤버가 있으면 그 멤버의 term을 기록 → 통계 병합
        // 없으면 토큰 자체를 신규 candidate로 생성
        const termToRecord = similar ?? token

        // §E SYN-11/SYN-13: weight번 호출 → occurrence_count를 weight만큼 증가
        //   (RPC는 한 번 호출할 때마다 +1, weight 범위: 1~N)
        for (let w = 0; w < weight; w++) {
          await admin.rpc('upsert_synonym_member', {
            p_group_id: groupId,
            p_term: termToRecord,
            p_threshold: settings.promoteThreshold, // §E SYN-13: DB 설정값 사용
          })
        }
      }
    }
  } catch {
    // fire-and-forget: 에러 무시 (발송 흐름 보호)
  }
}
