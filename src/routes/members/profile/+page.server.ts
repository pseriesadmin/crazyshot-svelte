import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = ({ url }) => {
  const tab = url.searchParams.get('tab')
  const dest = tab ? `/account/profile?tab=${tab}` : '/account/profile'
  throw redirect(301, dest)
}
