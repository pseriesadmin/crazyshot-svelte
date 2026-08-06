/**
 * core/createIndex.ts — 제네릭 인덱스 팩토리
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성(Supabase, $env, SvelteKit 타입 등)을 절대 포함하지 않는다.
 * 의존성: core/types.ts + core/miniSearchProvider.ts만.
 *
 * 사용 예 (adapters/ 에서):
 *   const index = createIndex<ProductDoc>(
 *     { searchFields: ['name','brand','keywords'], storeFields: ['id','name','slug'], boost: { name: 3 } },
 *     documents
 *   )
 *   const results = index.search('소니 카메라', { fuzzy: 0.2, prefix: true })
 */

import type { SearchDocument, NaturalSearchProvider, IndexConfig } from './types'
import { createMiniSearchProvider } from './miniSearchProvider'

/**
 * 문서 배열 + IndexConfig를 받아 빌드된 NaturalSearchProvider를 반환합니다.
 * 반환된 프로바이더는 즉시 search() 호출 가능한 상태입니다.
 */
export function createIndex<T extends SearchDocument>(
  config: IndexConfig<T>,
  documents: T[],
): NaturalSearchProvider<T> {
  const provider = createMiniSearchProvider<T>(config)
  provider.build(documents)
  return provider
}
