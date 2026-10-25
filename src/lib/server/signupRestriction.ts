// 탈퇴 후 3개월 재가입 제한 안내 (Migration #763, sp5 MEDIUM-3)
// DB 트리거(enforce_signup_restriction)가 제한 이메일의 계정 생성·이메일 변경을 거절하면 인증 서버는 "Database error …"처럼 사유 없는 오류만 돌려준다.
// 그래서 서버 경로(레거시 인증·관리자 계정 생성·가입 확정)는 실패했을 때 제한 여부를 한 번 더 조회해 사용자 문구로 바꿔 안내한다.
export const SIGNUP_RESTRICTED_MESSAGE = '탈퇴한 이메일은 탈퇴 후 3개월 동안 다시 가입할 수 없어요.'

interface RpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

// 실패한 계정 생성·이메일 변경이 재가입 제한 때문인지 확인한다. 제한 때문이면 안내 문구를, 아니면(또는 확인 불가) null 을 돌려준다.
export async function signupRestrictedMessage(client: RpcClient, email: string | null | undefined, err?: { message?: string } | null): Promise<string | null> {
  const trimmed = (email ?? '').trim()
  if (!trimmed) return null
  if (err?.message?.includes('SIGNUP_RESTRICTED')) return SIGNUP_RESTRICTED_MESSAGE
  const { data, error } = await client.rpc('check_signup_restricted', { p_email: trimmed })
  if (error) return null
  return (data as { restricted?: boolean } | null)?.restricted ? SIGNUP_RESTRICTED_MESSAGE : null
}
