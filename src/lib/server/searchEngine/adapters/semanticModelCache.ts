/**
 * adapters/semanticModelCache.ts — 의미 벡터 모델 로드 + 모듈 캐시 (서버 전용, $env 사용)
 * 로드 실패(null)도 같은 TTL로 캐시해, 장애 중 매 요청이 스토리지를 두드리지 않게 한다.
 */

import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import type { SemanticModel } from '../core/semanticVectors'
import { loadLatestSemanticModel } from './semanticModelStore'

const MODEL_CACHE_TTL_MS = 5 * 60_000

let cachedModel: SemanticModel | null = null
let cachedAt = 0
let cacheFilled = false

export async function getSemanticModel(): Promise<SemanticModel | null> {
  if (cacheFilled && Date.now() - cachedAt < MODEL_CACHE_TTL_MS) return cachedModel
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  cachedModel = await loadLatestSemanticModel(admin)
  cachedAt = Date.now()
  cacheFilled = true
  return cachedModel
}

export function invalidateSemanticModelCache(): void {
  cachedModel = null
  cachedAt = 0
  cacheFilled = false
}
