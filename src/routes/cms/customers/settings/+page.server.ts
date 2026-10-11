import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

// 고객 설정(회원코드 기준)은 2026-10-10 '코드설정'(/cms/codes) 화면의 '고객코드' 탭으로 이관됐다.
// 북마크·외부 링크가 깨지지 않도록 옛 주소는 새 탭으로 보내기만 한다(권한 검사는 /cms/codes가 수행).
export const load: PageServerLoad = () => {
  throw redirect(308, '/cms/codes?tab=customer')
}
