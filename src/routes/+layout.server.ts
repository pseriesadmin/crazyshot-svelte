import type { ServerLoad } from '@sveltejs/kit'

/**
 * 루트 레이아웃 서버 로드 — 탈퇴 자동복구 통합 지점
 *
 * 설계 원칙 (plan: dazzling-sauteeing-aurora.md §2-②):
 * - hooks.server.ts(~90개 파일이 매 요청 호출하는 핫패스)는 건드리지 않는다.
 * - 세션이 있을 때만 user_profiles에서 withdrawal_status를 1회 조회한다(PK 단건, 저비용).
 * - withdrawal_status='requested'면 restore_withdrawn_account() RPC를 호출한다.
 * - 결과에 따른 하드 리다이렉트 없음 — 루프 위험 방지. 경계 레이스(expired:true)는 당일 cron이 정리.
 * - 반환값은 최소 {} — 각 페이지의 +page.server.ts가 필요한 데이터를 따로 로드한다.
 *
 * withdrawal_status 컬럼은 Migration #365로 추가됐으나 database.ts 타입은 G1에서 갱신 예정.
 * → as 캐스팅으로 타입 불일치 임시 해소 (G1 완료 후 제거)
 */
export const load: ServerLoad = async ({ locals }) => {
  const { session } = await locals.safeGetSession()

  if (!session) {
    return {}
  }

  // PK 단건 조회 — withdrawal_status만 확인 (저비용)
  const { data: profile } = (await locals.supabase
    .from('user_profiles')
    .select('withdrawal_status, withdrawal_purge_at')
    .eq('id', session.user.id)
    .maybeSingle()) as unknown as {
    data: { withdrawal_status: string; withdrawal_purge_at: string | null } | null
    error: unknown
  }

  if (profile?.withdrawal_status === 'requested') {
    // 유예기간 내 재접속 시 자동복구 시도
    // restored:true/false 어느 결과든 하드 리다이렉트 없이 통과
    // expired:true(경계 레이스)도 허용 — 당일 pg_cron(purge-withdrawn-accounts)이 정리
    await locals.supabase.rpc('restore_withdrawn_account')
  }

  return {}
}
