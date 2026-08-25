// src/routes/api/cart/validate-delivery-address/+server.ts
// 배송 가능 주소 사전 검증 — 두발히어로 bulk-delivery 방식 선택 시 비차단 경고용
//
// 설계 원칙:
//  - 로그인 세션 필요 (비회원 체크아웃 없음)
//  - isDeliveryLocked() 재사용: bulk-delivery 방식 아닐 때는 무조건 valid:true 반환 (호출 불필요)
//  - validateAddress() 실패 → fail-soft (valid:true 반환, 서버 에러가 UX를 막지 않음)
//  - 이 응답이 valid:false여도 제출 자체를 막지 않음 (경고 toast만 표시)
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { validateAddress } from '$lib/server/dhero'
import { isBulkDeliveryMethod } from '$lib/server/isBulkDeliveryMethod'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, locals }) => {
  // 로그인 세션 필수
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  let body: { address?: unknown; postalCode?: unknown; methodKey?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }

  const address   = typeof body.address   === 'string' ? body.address.trim()   : ''
  const postalCode = typeof body.postalCode === 'string' ? body.postalCode.trim() : ''
  const methodKey  = typeof body.methodKey  === 'string' ? body.methodKey.trim()  : ''

  if (!address || !postalCode) {
    return json({ valid: true }) // 주소 미입력 = 검증 불필요 (제출 시 별도 validation)
  }

  // bulk-delivery 방식인지 isBulkDeliveryMethod() 공유 함수로 판단 (LOW-1 수정 — 2026-08-25)
  // 기존 인라인 rental_method_options 조회를 제거하고 공유 유틸 재사용 (DRY 원칙)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const isBulk = await isBulkDeliveryMethod(admin, methodKey)
  if (!isBulk) {
    return json({ valid: true }) // 배송 방식이 두발히어로 아님 → 검증 불필요
  }

  // 두발히어로 주소 검증 (fail-soft)
  try {
    const res = await validateAddress({ address, postalCode })
    return json({ valid: res.valid, dongGroup: res.dongGroup ?? null })
  } catch {
    // API 실패 → 경고 toast 안 띄움 (배송 가능 여부 불명 시 낙관적 처리)
    return json({ valid: true })
  }
}
