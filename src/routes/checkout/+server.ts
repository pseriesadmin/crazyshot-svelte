// /checkout → /cart 영구 리다이렉트 (2026-07-29 라우트 리네임)
// 기존 북마크·SNS 링크·검색엔진 색인 등 코드로 막을 수 없는 외부 참조 보호용
import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = () => {
  throw redirect(301, '/cart')
}
