/**
 * core/index.ts — 공개 export barrel
 *
 * 이 폴더(core/)가 이식/패키징의 단위입니다.
 * 다른 프로젝트로 이전 시 이 폴더 전체를 복사하고 adapters/만 새로 작성하면 됩니다.
 *
 * ⚠️ 이 파일은 crazyshot 전용 의존성을 절대 포함하지 않습니다.
 */

export type {
  SearchDocument,
  SearchOptions,
  SearchResult,
  NaturalSearchProvider,
  IndexConfig,
} from './types'

export {
  TRAILING_PARTICLES,
  stripTrailingParticle,
  extractChosung,
  toChosung,
  isChosungQuery,
  koreanTokenize,
  koreanProcessTerm,
} from './koreanTokenizer'

export { MiniSearchProvider, createMiniSearchProvider } from './miniSearchProvider'
export { createIndex } from './createIndex'
