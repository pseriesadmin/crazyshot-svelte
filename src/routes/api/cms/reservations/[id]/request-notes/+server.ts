/**
 * GET /api/cms/reservations/[id]/request-notes — 고객이 예약신청 때 남긴 요청사항 조회 (CMS 전용, 읽기 전용)
 *
 * 장바구니 "요청 사항" 입력(공동현관 출입번호·경비실 호출 등 안내 문구 포함)은 수령용(pickup_request_note)·
 * 반납용(return_request_note)으로 나뉘어 예약에 저장된다(Migration 476). 과거 단일 요청사항(notes)이 있는 예약도 함께 돌려준다.
 * 수령 공동현관 출입번호(pickup_frontdoor_password, Migration #774)는 별도 전용 칸이라 manager 이상에게만 내려준다(무인보관함 비밀번호와 같은 수준).
 * RentalDetailPanel(/cms/rentals·/cms/reservation 공유)의 대여정보 탭이 lazy-fetch 로 읽어 표시한다.
 */
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import type { RequestHandler } from './$types'

function cleanNote(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('rental_reservations')
    .select('notes, pickup_request_note, return_request_note')
    .eq('id', reservationId)
    .maybeSingle()

  if (error) return json({ error: '요청사항을 불러오지 못했습니다.' }, { status: 500 })
  if (!data) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const r = data as { notes: unknown; pickup_request_note: unknown; return_request_note: unknown }

  // 공동현관 출입번호(Migration #774)는 manager 이상에게만, 핵심 조회와 분리한 fail-soft 조회 —
  // 컬럼이 아직 없는 환경(DB 적용 전 코드 배포)에서도 요청사항 영역 전체가 500 으로 깨지지 않게 한다
  let frontdoor: string | null = null
  if (hasSettingsAccess(cmsRole)) {
    try {
      const { data: fd } = await admin
        .from('rental_reservations')
        .select('pickup_frontdoor_password')
        .eq('id', reservationId)
        .maybeSingle()
      frontdoor = cleanNote((fd as { pickup_frontdoor_password?: unknown } | null)?.pickup_frontdoor_password)
    } catch { /* fail-soft — 출입번호만 비어 보인다 */ }
  }
  return json({
    notes:               cleanNote(r.notes),
    pickup_request_note: cleanNote(r.pickup_request_note),
    return_request_note: cleanNote(r.return_request_note),
    pickup_frontdoor_password: frontdoor, // manager 이상만(partner 는 null)
  })
}
