/**
 * adapters/nlsearchParams.ts — 검색 튜닝 파라미터 로더 (서버 전용, service_role)
 *
 * nlsearch_settings(싱글턴)를 읽어 sanitize한 값을 돌려준다. 행이 없거나 읽기에 실패하면 코드 기본값(= 기존 동작)을 돌려준다(fail-open).
 * 호출 시점: 상품·크레이지로그 인덱스를 (재)구축할 때마다 새로 읽는다 — 인덱스 캐시(TTL 60초)가 호출 빈도를 이미 제한하므로
 * 별도 TTL 캐시를 두지 않아 CMS에서 저장한 값이 인덱스 TTL(60초) 안에 반영된다.
 * 순수 스키마·검증은 nlsearchParamsSchema.ts.
 */

import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { DEFAULT_NLSEARCH_PARAMS, sanitizeNlsearchParams, type NlsearchParams } from './nlsearchParamsSchema'

export interface LoadedNlsearchParams {
  params: NlsearchParams
  version: number
  /** false면 DB 값을 못 읽어 기본값을 쓴 것 */
  fromDb: boolean
}

export async function loadNlsearchSettings(): Promise<LoadedNlsearchParams> {
  try {
    const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await admin.from('nlsearch_settings').select('params, version').eq('id', 1).maybeSingle()
    if (error) {
      console.error('[nlsearchParams] 설정 조회 실패:', error.message)
      return { params: DEFAULT_NLSEARCH_PARAMS, version: 0, fromDb: false }
    }
    if (!data) return { params: DEFAULT_NLSEARCH_PARAMS, version: 0, fromDb: true }
    return {
      params: sanitizeNlsearchParams(data.params),
      version: typeof data.version === 'number' ? data.version : 0,
      fromDb: true,
    }
  } catch (e) {
    console.error('[nlsearchParams] 설정 조회 오류:', e instanceof Error ? e.message : String(e))
    return { params: DEFAULT_NLSEARCH_PARAMS, version: 0, fromDb: false }
  }
}

export async function loadNlsearchParams(): Promise<NlsearchParams> {
  return (await loadNlsearchSettings()).params
}

// 요청 경로(검색 API 등)에서 쓰는 60초 캐시 — 인덱스 빌드와 달리 요청마다 DB를 읽지 않도록 한다.
const REQUEST_CACHE_TTL_MS = 60_000
let requestCache: { value: NlsearchParams; at: number } | null = null

export async function getNlsearchParamsCached(): Promise<NlsearchParams> {
  if (requestCache && Date.now() - requestCache.at < REQUEST_CACHE_TTL_MS) return requestCache.value
  const value = await loadNlsearchParams()
  requestCache = { value, at: Date.now() }
  return value
}

export function invalidateNlsearchParamsCache(): void {
  requestCache = null
}
