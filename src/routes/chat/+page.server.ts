// PRD.1.7 T10 — 고객 채팅 라우트 서버 로드
// 딥링크: /chat?context=product&id=X | /chat?context=reservation&id=X

import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
  const { session } = await locals.safeGetSession()

  // 딥링크 파라미터 파싱
  const contextType = url.searchParams.get('context') ?? undefined
  const contextId = url.searchParams.get('id') ?? undefined

  // 비로그인 시 테스트 폴백 (로그인 라우트 구축 후 redirect로 전환)
  return {
    userId: session?.user.id ?? 'test-user',
    userName:
      (session?.user.user_metadata?.full_name as string | undefined) ??
      session?.user.email?.split('@')[0] ??
      '테스트유저',
    userHandle:
      (session?.user.user_metadata?.username as string | undefined) ??
      session?.user.email?.split('@')[0] ??
      'test',
    contextType,
    contextId,
  }
}
