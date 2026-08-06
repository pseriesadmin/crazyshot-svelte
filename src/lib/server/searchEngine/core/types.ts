/**
 * core/types.ts — 자연어 검색 엔진 공통 타입 · 인터페이스
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성(Supabase, $env, SvelteKit 타입 등)을 절대 포함하지 않는다.
 * 의존성: 순수 TypeScript 타입만 (런타임 의존성 없음).
 * 목적: NaturalSearchProvider 인터페이스로 검색 엔진을 추상화 → 추후 MiniSearch 외 다른 구현체
 *       (임베딩 기반 AI 등)로 교체 시 호출부 코드 재작성 불필요.
 */

// ── 공통 문서 타입 ────────────────────────────────────────────────────────────

/**
 * 검색 엔진에 색인되는 문서의 기본 형태.
 * `id` 필드는 필수 — 검색 결과에서 원본 데이터를 역조회할 때 사용.
 */
export interface SearchDocument {
  /** 문서 고유 식별자 (원본 DB id) */
  id: string
  [field: string]: unknown
}

// ── 검색 옵션 ─────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /**
   * fuzzy 매칭 허용 범위.
   * - 0 ~ 1 사이의 소수: 단어 길이 기반 허용 편집거리 비율 (MiniSearch 방식)
   * - 예: 0.2 → 5자 단어는 편집거리 1 이내 오타 허용
   */
  fuzzy?: number | false

  /**
   * prefix 매칭 사용 여부.
   * true 시 "소니카" 입력으로 "소니카메라" 매칭 가능.
   */
  prefix?: boolean

  /**
   * 결과 최대 개수. 미지정 시 엔진 기본값 사용.
   */
  limit?: number

  /**
   * 필드별 boost 가중치 맵.
   * 예: { match_keywords: 5, shortcut: 3, title: 2, content: 1 }
   */
  boost?: Record<string, number>
}

// ── 검색 결과 ─────────────────────────────────────────────────────────────────

export interface SearchResult<T extends SearchDocument = SearchDocument> {
  /** 매칭된 문서 (원본 타입 그대로 반환) */
  document: T
  /** 검색 점수 (높을수록 관련도 높음) */
  score: number
  /** 매칭에 기여한 필드 목록 */
  terms: string[]
  /** 매칭 기여 필드명 목록 */
  queryTerms: string[]
}

// ── 검색 엔진 프로바이더 인터페이스 ───────────────────────────────────────────

/**
 * NaturalSearchProvider — 자연어 검색 엔진의 추상 인터페이스.
 *
 * 현재 구현체: MiniSearchProvider (core/miniSearchProvider.ts)
 * 추후 추가 가능: EmbeddingSearchProvider (AI 임베딩 기반), HybridProvider 등
 *
 * 호출부(matchCannedResponse.ts, /api/search/products/+server.ts)는 이 인터페이스에만
 * 의존하므로 구현체 교체 시 호출부 코드 변경 불필요.
 */
export interface NaturalSearchProvider<T extends SearchDocument = SearchDocument> {
  /**
   * 자연어 질의로 색인된 문서를 검색합니다.
   * @param query 사용자 입력 검색어
   * @param opts 검색 옵션 (fuzzy, prefix, limit, boost)
   * @returns 매칭된 문서 목록 (점수 내림차순 정렬)
   */
  search(query: string, opts?: SearchOptions): SearchResult<T>[]

  /**
   * 문서 배열로 인덱스를 (재)구축합니다.
   * @param documents 색인할 문서 전체 목록
   */
  build(documents: T[]): void

  /**
   * 현재 색인된 문서 수.
   */
  readonly documentCount: number
}

// ── 인덱스 팩토리 설정 ────────────────────────────────────────────────────────

/**
 * createIndex() 팩토리에 전달하는 설정.
 * 각 어댑터(productSearchIndex.ts, cannedResponseSearchIndex.ts)가 도메인별 설정을 정의할 때 사용.
 * searchFields / storeFields 는 `as const` readonly 튜플로 선언해도 할당 가능.
 */
export interface IndexConfig<T extends SearchDocument = SearchDocument> {
  /** 검색 대상 필드명 목록 */
  searchFields: readonly (keyof T & string)[]
  /** 결과 문서에 포함할 필드명 목록 (`id` 는 항상 포함됨) */
  storeFields: readonly (keyof T & string)[]
  /** 필드별 boost 가중치 (searchFields 중 일부에만 적용 가능) */
  boost?: Record<string, number>
  /** 기본 fuzzy 범위 (createIndex 수준 기본값; search() 호출 시 opts.fuzzy로 덮어씌울 수 있음) */
  defaultFuzzy?: number | false
  /** 기본 prefix 매칭 여부 */
  defaultPrefix?: boolean
}
