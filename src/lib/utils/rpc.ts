// src/lib/utils/rpc.ts
// supabase-js v2 + TypeScript 6 조합에서 SupabaseClient<Database>.rpc()의 제네릭 오버로드 해석이
// 실패하는 기존 프로젝트 이슈 우회 헬퍼 — src/lib/services/supabase.ts의 callRpc 헬퍼(frozen file)와
// 동일 원인·동일 패턴. 여러 신규 파일에서 반복 사용하기 위해 별도 유틸로 분리.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '$lib/types/database'

export function callTypedRpc<T>(
  client: SupabaseClient<Database>,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  return client.rpc(fn as never, args as never) as unknown as Promise<{
    data: T | null
    error: { message: string } | null
  }>
}
