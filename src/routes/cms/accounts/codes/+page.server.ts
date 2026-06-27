import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

// 구 경로 → 신 경로 영구 리다이렉트
export const load: PageServerLoad = async () => {
  throw redirect(301, '/cms/codes')
}
