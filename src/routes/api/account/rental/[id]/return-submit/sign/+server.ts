/**
 * POST /api/account/rental/[id]/return-submit/sign — 고객 반납 증빙 업로드용 서명 URL 발급 (Migration #722)
 *
 * 영상은 서버 함수 본문 한도(4.5MB)를 넘으므로 브라우저가 비공개 버킷(return-evidence)으로 직접 올린다.
 * 이 엔드포인트는 ① 로그인 ② 예약 소유권 ③ 제출 가능한 상태·방식 ④ 항목·형식·용량을 확인한 뒤
 * 본인 예약 폴더 아래의 경로 하나에 대한 1회용 업로드 토큰만 발급한다(임의 경로 업로드 불가).
 */
import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { createClient } from '@supabase/supabase-js'
import {
  RETURN_EVIDENCE_BUCKET,
  RETURN_SUBMIT_STATUSES,
  allowedItemKeys,
  buildEvidencePath,
  toReturnSubmitMethod,
  validateMediaFile,
} from '$lib/server/returnSubmission'
import { loadReturnPhotoItems, customerPhotoOf } from '$lib/server/returnInspectionItems'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request, params, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const reservationId = Number(params.id)
  if (!Number.isInteger(reservationId) || reservationId <= 0) return json({ error: '유효하지 않은 예약입니다.' }, { status: 400 })

  const { data: reservation } = await locals.supabase
    .from('rental_reservations')
    .select('id, status, return_method')
    .eq('id', reservationId)
    .eq('user_id', session.user.id)
    .maybeSingle()
  if (!reservation) return json({ error: '이 예약에 대한 권한이 없습니다.' }, { status: 403 })

  const row = reservation as { status: string; return_method: string | null }
  if (!RETURN_SUBMIT_STATUSES.has(row.status)) return json({ error: '지금은 반납 정보를 등록할 수 없는 상태예요.' }, { status: 409 })
  const method = toReturnSubmitMethod(row.return_method)
  if (!method) return json({ error: '이 반납 방식은 사진 등록이 필요하지 않아요.' }, { status: 400 })

  let body: { item_key?: unknown; content_type?: unknown; size?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청입니다.' }, { status: 400 })
  }
  const itemKey = typeof body.item_key === 'string' ? body.item_key : ''
  const contentType = typeof body.content_type === 'string' ? body.content_type : ''
  const size = typeof body.size === 'number' ? body.size : Number.NaN

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) return json({ error: '서버 설정 오류' }, { status: 500 })
  const admin = createClient(getSupabaseUrl(), serviceRoleKey)

  // 이미 등록한 예약은 사진을 더 올릴 수 없다(재등록 불가)
  const { data: already } = await admin.from('reservation_return_submissions').select('id').eq('reservation_id', reservationId).maybeSingle()
  if (already) return json({ error: '이미 반납 정보를 등록하셨어요.' }, { status: 409 })

  // 택배 반납의 사진 카드는 CMS '사진등록 항목' 기준(조회 실패 시 기본 3종)
  const photo = await loadReturnPhotoItems(admin)
  if (!allowedItemKeys(method, customerPhotoOf(photo.active)).includes(itemKey)) return json({ error: '올릴 수 없는 사진 항목이에요.' }, { status: 400 })
  const file = validateMediaFile(contentType, size)
  if (!file.ok) return json({ error: file.error }, { status: 400 })

  const path = buildEvidencePath(reservationId, itemKey, contentType)
  const { data, error } = await admin.storage.from(RETURN_EVIDENCE_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return json({ error: '업로드 준비에 실패했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })

  return json({ path: data.path ?? path, token: data.token, kind: file.kind })
}
