// guestChatMerge.ts — 로그인 직전의 비회원(익명) 세션 토큰을 잡아 두었다가 로그인 성공 뒤 서버에 채팅 통합을 요청한다 (2026-10-27)
// 로그인 성공 시 브라우저의 익명 세션은 회원 세션으로 교체되어 사라지므로, 교체 전에 토큰을 보관해야 한다. 실패해도 로그인은 막지 않는다.

/** 로그인 직전 세션이 익명 계정이면 그 액세스 토큰을, 아니면 null을 돌려준다. */
export function pickGuestToken(session: { access_token?: string; user?: { is_anonymous?: boolean } } | null | undefined): string | null {
  if (!session?.user || session.user.is_anonymous !== true) return null
  const token = session.access_token
  return typeof token === 'string' && token.length > 0 ? token : null
}

/** 서버에 통합을 요청한다(결과를 기다리지 않아도 되도록 예외를 던지지 않음). 통합된 대화가 있으면 true. */
export async function requestGuestChatMerge(guestToken: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/auth/merge-guest-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_access_token: guestToken }),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean; sessions?: number }
    return body.ok === true && (body.sessions ?? 0) > 0
  } catch {
    return false
  }
}
