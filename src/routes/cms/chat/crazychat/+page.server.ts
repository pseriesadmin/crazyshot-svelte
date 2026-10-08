// /cms/chat/crazychat — 크레이지챗 설정·관찰 검토 화면. 데이터는 화면이 /api/cms/chat/crazychat/* 로 읽는다(권한·감사는 API가 집행).
import { redirect } from '@sveltejs/kit'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ parent }) => {
  const { cmsRole } = await parent()
  if (!cmsRole) throw redirect(303, '/cms/login')
  if (!hasSettingsAccess(cmsRole)) throw redirect(303, '/cms?notice=access_denied')
  return {}
}
