import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

// QR 코드 스캔 핸들러
// 스캔 시 CMS 상세 패널로 redirect
// 확장 예정: product → reservation → asset

const ENTITY_REDIRECT: Record<string, (id: string) => string> = {
  product: (id) => `/cms/products?selected=${id}`,
  reservation: (id) => `/cms/reservation?selected=${id}`,
  asset: (id) => `/cms/products?asset=${id}`,
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const { entity, id } = params
  const { session } = await locals.safeGetSession()

  const redirectPath = Object.prototype.hasOwnProperty.call(ENTITY_REDIRECT, entity)
    ? ENTITY_REDIRECT[entity as keyof typeof ENTITY_REDIRECT]
    : undefined
  if (!redirectPath) {
    throw redirect(303, '/cms')
  }

  const target = redirectPath(id)

  if (!session) {
    // 미인증 → 로그인 후 원래 목적지로
    throw redirect(303, `/cms/login?next=${encodeURIComponent(target)}`)
  }

  throw redirect(303, target)
}
