/**
 * adapters/nlsearchParamsSchema.ts — 검색 튜닝 파라미터의 순수 스키마 (DB·$env 의존 없음)
 *
 * A-3(2026-10-10): 코드에 박혀 있던 boost·fuzzy·prefix를 DB(nlsearch_settings)로 옮길 수 있게 한 값 정의.
 * 계약:
 *  ① 기본값(DEFAULT_NLSEARCH_PARAMS)은 기존 PRODUCT_INDEX_CONFIG·CRAZYLOG_INDEX_CONFIG에서 그대로 만든다 —
 *     설정이 비어 있거나 읽기에 실패해도 검색 결과는 기존과 같다(fail-open).
 *  ② 읽을 때(sanitize)는 범위 밖·이상한 값을 맞추거나 기본값으로 대체한다. 저장할 때(validate)는 범위 밖을 거절한다.
 *  ③ semantic.*(의미 점수)는 B·C단계용이며 기본 꺼짐(weight 0, recommend false, shadow false — shadow는 응답을 바꾸지 않는 관찰 기록).
 */

import { PRODUCT_INDEX_CONFIG } from './productSearchDocs'
import { CRAZYLOG_INDEX_CONFIG } from './crazylogSearchDocs'

export type IndexParams = {
  boost: Record<string, number>
  fuzzy: number
  prefix: boolean
}

export type NlsearchParams = {
  product: IndexParams
  crazylog: IndexParams
  semantic: { weight: number; recommend: boolean; shadow: boolean }
  /** 검색 학습 승격 기준: 같은 (상품, 검색어)를 서로 다른 사용자 minUsers명 이상이 눌러야 색인에 합쳐진다 */
  learning: { minUsers: number }
  /** 상품 페이지 직접 진입(검색을 거치지 않은 방문) 인기를 순위에 약하게 더한다. 기본 꺼짐 */
  popularity: { enabled: boolean; weight: number }
}

export const PARAM_RANGES = {
  boost: { min: 0, max: 20 },
  fuzzy: { min: 0, max: 0.5 },
  semanticWeight: { min: 0, max: 1 },
  learningMinUsers: { min: 1, max: 10 },
  popularityWeight: { min: 0, max: 2 },
} as const

export const DEFAULT_NLSEARCH_PARAMS: NlsearchParams = {
  product: {
    boost: { ...PRODUCT_INDEX_CONFIG.boost },
    fuzzy: PRODUCT_INDEX_CONFIG.defaultFuzzy,
    prefix: PRODUCT_INDEX_CONFIG.defaultPrefix,
  },
  crazylog: {
    boost: { ...CRAZYLOG_INDEX_CONFIG.boost },
    fuzzy: CRAZYLOG_INDEX_CONFIG.defaultFuzzy,
    prefix: CRAZYLOG_INDEX_CONFIG.defaultPrefix,
  },
  semantic: { weight: 0, recommend: false, shadow: false },
  learning: { minUsers: 3 },
  popularity: { enabled: false, weight: 0.3 },
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function sanitizeNumber(v: unknown, fallback: number, min: number, max: number): number {
  return isNum(v) ? clamp(v, min, max) : fallback
}

function sanitizeIndexParams(raw: unknown, def: IndexParams): IndexParams {
  const o = isRec(raw) ? raw : {}
  const rawBoost = isRec(o.boost) ? o.boost : {}
  const boost: Record<string, number> = {}
  for (const key of Object.keys(def.boost)) {
    boost[key] = sanitizeNumber(rawBoost[key], def.boost[key], PARAM_RANGES.boost.min, PARAM_RANGES.boost.max)
  }
  return {
    boost,
    fuzzy: sanitizeNumber(o.fuzzy, def.fuzzy, PARAM_RANGES.fuzzy.min, PARAM_RANGES.fuzzy.max),
    prefix: typeof o.prefix === 'boolean' ? o.prefix : def.prefix,
  }
}

/** 읽기용: 어떤 입력이든 항상 완전하고 안전한 파라미터를 돌려준다 */
export function sanitizeNlsearchParams(raw: unknown): NlsearchParams {
  const o = isRec(raw) ? raw : {}
  const sem = isRec(o.semantic) ? o.semantic : {}
  const learn = isRec(o.learning) ? o.learning : {}
  const pop = isRec(o.popularity) ? o.popularity : {}
  return {
    product: sanitizeIndexParams(o.product, DEFAULT_NLSEARCH_PARAMS.product),
    crazylog: sanitizeIndexParams(o.crazylog, DEFAULT_NLSEARCH_PARAMS.crazylog),
    semantic: {
      weight: sanitizeNumber(sem.weight, 0, PARAM_RANGES.semanticWeight.min, PARAM_RANGES.semanticWeight.max),
      recommend: typeof sem.recommend === 'boolean' ? sem.recommend : false,
      shadow: typeof sem.shadow === 'boolean' ? sem.shadow : false,
    },
    learning: {
      minUsers: Math.round(
        sanitizeNumber(learn.minUsers, DEFAULT_NLSEARCH_PARAMS.learning.minUsers, PARAM_RANGES.learningMinUsers.min, PARAM_RANGES.learningMinUsers.max),
      ),
    },
    popularity: {
      enabled: typeof pop.enabled === 'boolean' ? pop.enabled : false,
      weight: sanitizeNumber(pop.weight, DEFAULT_NLSEARCH_PARAMS.popularity.weight, PARAM_RANGES.popularityWeight.min, PARAM_RANGES.popularityWeight.max),
    },
  }
}

export type ValidateResult = { ok: true; params: NlsearchParams } | { ok: false; errors: string[] }

function validateIndexParams(raw: unknown, path: string, def: IndexParams, errors: string[]): void {
  if (raw === undefined) return
  if (!isRec(raw)) {
    errors.push(`${path}: 객체여야 합니다`)
    return
  }
  if (raw.boost !== undefined) {
    if (!isRec(raw.boost)) errors.push(`${path}.boost: 객체여야 합니다`)
    else {
      for (const [k, v] of Object.entries(raw.boost)) {
        if (!Object.hasOwn(def.boost, k)) errors.push(`${path}.boost.${k}: 알 수 없는 칸입니다`)
        else if (!isNum(v)) errors.push(`${path}.boost.${k}: 숫자여야 합니다`)
        else if (v < PARAM_RANGES.boost.min || v > PARAM_RANGES.boost.max)
          errors.push(`${path}.boost.${k}: ${PARAM_RANGES.boost.min}~${PARAM_RANGES.boost.max} 범위여야 합니다`)
      }
    }
  }
  if (raw.fuzzy !== undefined) {
    if (!isNum(raw.fuzzy)) errors.push(`${path}.fuzzy: 숫자여야 합니다`)
    else if (raw.fuzzy < PARAM_RANGES.fuzzy.min || raw.fuzzy > PARAM_RANGES.fuzzy.max)
      errors.push(`${path}.fuzzy: ${PARAM_RANGES.fuzzy.min}~${PARAM_RANGES.fuzzy.max} 범위여야 합니다`)
  }
  if (raw.prefix !== undefined && typeof raw.prefix !== 'boolean') errors.push(`${path}.prefix: true/false여야 합니다`)
}

/** 저장용: 범위 밖·알 수 없는 키·타입 오류를 모두 모아 거절한다. 통과하면 기본값으로 채운 완전한 값을 돌려준다. */
export function validateNlsearchParams(raw: unknown): ValidateResult {
  if (!isRec(raw)) return { ok: false, errors: ['파라미터는 객체여야 합니다'] }
  const errors: string[] = []
  validateIndexParams(raw.product, 'product', DEFAULT_NLSEARCH_PARAMS.product, errors)
  validateIndexParams(raw.crazylog, 'crazylog', DEFAULT_NLSEARCH_PARAMS.crazylog, errors)
  if (raw.semantic !== undefined) {
    if (!isRec(raw.semantic)) errors.push('semantic: 객체여야 합니다')
    else {
      const w = raw.semantic.weight
      if (w !== undefined) {
        if (!isNum(w)) errors.push('semantic.weight: 숫자여야 합니다')
        else if (w < PARAM_RANGES.semanticWeight.min || w > PARAM_RANGES.semanticWeight.max)
          errors.push(`semantic.weight: ${PARAM_RANGES.semanticWeight.min}~${PARAM_RANGES.semanticWeight.max} 범위여야 합니다`)
      }
      if (raw.semantic.recommend !== undefined && typeof raw.semantic.recommend !== 'boolean')
        errors.push('semantic.recommend: true/false여야 합니다')
      if (raw.semantic.shadow !== undefined && typeof raw.semantic.shadow !== 'boolean') errors.push('semantic.shadow: true/false여야 합니다')
    }
  }
  if (raw.learning !== undefined) {
    if (!isRec(raw.learning)) errors.push('learning: 객체여야 합니다')
    else {
      const m = raw.learning.minUsers
      if (m !== undefined) {
        if (!isNum(m) || !Number.isInteger(m)) errors.push('learning.minUsers: 정수여야 합니다')
        else if (m < PARAM_RANGES.learningMinUsers.min || m > PARAM_RANGES.learningMinUsers.max)
          errors.push(`learning.minUsers: ${PARAM_RANGES.learningMinUsers.min}~${PARAM_RANGES.learningMinUsers.max} 범위여야 합니다`)
      }
    }
  }
  if (raw.popularity !== undefined) {
    if (!isRec(raw.popularity)) errors.push('popularity: 객체여야 합니다')
    else {
      const w = raw.popularity.weight
      if (w !== undefined) {
        if (!isNum(w)) errors.push('popularity.weight: 숫자여야 합니다')
        else if (w < PARAM_RANGES.popularityWeight.min || w > PARAM_RANGES.popularityWeight.max)
          errors.push(`popularity.weight: ${PARAM_RANGES.popularityWeight.min}~${PARAM_RANGES.popularityWeight.max} 범위여야 합니다`)
      }
      if (raw.popularity.enabled !== undefined && typeof raw.popularity.enabled !== 'boolean') errors.push('popularity.enabled: true/false여야 합니다')
    }
  }
  for (const k of Object.keys(raw)) if (!['product', 'crazylog', 'semantic', 'learning', 'popularity'].includes(k)) errors.push(`${k}: 알 수 없는 항목입니다`)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, params: sanitizeNlsearchParams(raw) }
}

/** 상품 인덱스 설정: 검색·저장 칸은 코드 그대로, boost·fuzzy·prefix만 파라미터 반영 */
export function resolveProductIndexConfig(params: NlsearchParams): Omit<typeof PRODUCT_INDEX_CONFIG, 'defaultFuzzy' | 'defaultPrefix'> & { defaultFuzzy: number; defaultPrefix: boolean } {
  return {
    ...PRODUCT_INDEX_CONFIG,
    boost: { ...params.product.boost } as typeof PRODUCT_INDEX_CONFIG.boost,
    defaultFuzzy: params.product.fuzzy,
    defaultPrefix: params.product.prefix,
  }
}

export function resolveCrazylogIndexConfig(params: NlsearchParams): Omit<typeof CRAZYLOG_INDEX_CONFIG, 'defaultFuzzy' | 'defaultPrefix'> & { defaultFuzzy: number; defaultPrefix: boolean } {
  return {
    ...CRAZYLOG_INDEX_CONFIG,
    boost: { ...params.crazylog.boost } as typeof CRAZYLOG_INDEX_CONFIG.boost,
    defaultFuzzy: params.crazylog.fuzzy,
    defaultPrefix: params.crazylog.prefix,
  }
}
