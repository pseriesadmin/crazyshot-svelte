/**
 * core/miniSearchProvider.ts — MiniSearch 기반 NaturalSearchProvider 구현체
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성(Supabase, $env, SvelteKit 타입 등)을 절대 포함하지 않는다.
 * 의존성: `minisearch` + core/types.ts + core/koreanTokenizer.ts만.
 *
 * NaturalSearchProvider 인터페이스의 첫 번째(현재 유일한) 구현체.
 * 추후 임베딩 기반 AI 프로바이더 등 다른 구현체를 추가하려면 동일 인터페이스를 구현하면 됨.
 */

import MiniSearch from 'minisearch'
import type { NaturalSearchProvider, SearchDocument, SearchOptions, SearchResult, IndexConfig } from './types'
import { koreanTokenize, koreanProcessTerm } from './koreanTokenizer'

export class MiniSearchProvider<T extends SearchDocument = SearchDocument>
  implements NaturalSearchProvider<T> {

  private ms: MiniSearch<T>
  private config: IndexConfig<T>
  private _documentCount = 0

  constructor(config: IndexConfig<T>) {
    this.config = config
    this.ms = this.createMiniSearch()
  }

  private createMiniSearch(): MiniSearch<T> {
    return new MiniSearch<T>({
      // readonly 배열을 mutable string[]로 변환
      fields: [...this.config.searchFields] as string[],
      storeFields: [...this.config.storeFields] as string[],
      tokenize: koreanTokenize,
      processTerm: koreanProcessTerm,
    })
  }

  /** 문서 배열로 인덱스를 (재)구축합니다. */
  build(documents: T[]): void {
    // 기존 인덱스 완전 교체 (재구축)
    this.ms = this.createMiniSearch()
    this.ms.addAll(documents)
    this._documentCount = documents.length
  }

  /** 자연어 질의로 검색합니다. */
  search(query: string, opts?: SearchOptions): SearchResult<T>[] {
    if (!query || query.trim() === '') return []

    const fuzzy = opts?.fuzzy !== undefined ? opts.fuzzy : (this.config.defaultFuzzy ?? 0.2)
    const prefix = opts?.prefix !== undefined ? opts.prefix : (this.config.defaultPrefix ?? true)
    const boost = opts?.boost ?? this.config.boost ?? {}
    const limit = opts?.limit ?? 20

    const rawResults = this.ms.search(query, {
      fuzzy,
      prefix,
      boost,
      combineWith: 'OR',
    })

    return rawResults.slice(0, limit).map((r) => ({
      document: r as unknown as T,
      score: r.score,
      terms: r.terms,
      queryTerms: r.queryTerms,
    }))
  }

  get documentCount(): number {
    return this._documentCount
  }
}

/**
 * MiniSearchProvider 팩토리 — IndexConfig를 받아 프로바이더 인스턴스를 반환합니다.
 * createIndex.ts에서 사용하는 핵심 생성 함수.
 */
export function createMiniSearchProvider<T extends SearchDocument>(
  config: IndexConfig<T>,
): MiniSearchProvider<T> {
  return new MiniSearchProvider<T>(config)
}
