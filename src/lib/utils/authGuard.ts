/**
 * 예약 등 "가입 완료 계정"만 허용해야 하는 액션의 세션 판별 유틸.
 * 클라이언트(supabase-js Session)와 서버(locals.safeGetSession() 반환값) 양쪽에서
 * 동일하게 재사용 가능하도록 최소 shape만 의존한다.
 */
interface SessionLike {
	user?: {
		is_anonymous?: boolean;
	} | null;
}

/**
 * 실제 가입 완료(로그인) 세션인지 판별한다.
 * - 세션 자체가 없으면 false
 * - Supabase 익명 로그인(signInAnonymously)으로 생성된 세션(user.is_anonymous === true)이면 false
 * - 그 외 실제 회원 세션이면 true
 */
export function isRealMemberSession(session: SessionLike | null | undefined): boolean {
	if (!session?.user) return false;
	return session.user.is_anonymous !== true;
}
