/**
 * POST /api/cms/reservations/[id]/locker-password/test-send — 무인보관함 안내 문자 "시범 발송" (CMS 전용, manager 이상)
 *
 * 실제 고객 번호가 아니라 회사 테스트폰(SMS_TEST_PHONE, 미설정 시 Solapi에 등록된 회사 발신번호 SMS_SENDER_PHONE)으로
 * 자동 발송과 같은 문구를 실제로 보낸다. 고객에게는 아무것도 가지 않는다.
 * 본문: 요청 본문의 locker_number·locker_password(입력 중인 값) → 없으면 저장된 값. 무인함 번호 1~10자 + 비밀번호 4~10자(둘 다 숫자·특수문자만, 둘 다 필수).
 * 응답: { message, sent_at, to_masked } — 화면이 발송 문구와 시각을 그대로 보여준다.
 */
import { json } from '@sveltejs/kit'
import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'
import { getCmsRoleForAction } from '$lib/server/getCmsRoleForAction'
import { hasSettingsAccess } from '$lib/utils/cmsPermissions'
import { applyParentFieldsToRowProducts } from '$lib/server/products/resolveParentProductFields'
import { sendSms, buildLockerGuideSms } from '$lib/server/sms'
import { isValidLockerNumber, isValidLockerPassword, LOCKER_NUMBER_ERROR, LOCKER_PASSWORD_ERROR } from '$lib/utils/lockerFields'
import type { RequestHandler } from './$types'


// 문자 비용 남용 방지 — 같은 예약은 10초에 1회만(서버 인스턴스 단위 간이 제한, 더블클릭·연타 차단용)
const COOLDOWN_MS = 10_000
const lastSentAt = new Map<number, number>()

function maskPhone(raw: string): string {
  const d = raw.replace(/[^0-9]/g, '')
  return d.length >= 8 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : '등록된 번호'
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const denied = await requireMenuAccessApi(locals, 'rental.reservation')
  if (denied) return denied
  const { session } = await locals.safeGetSession()
  if (!session) return json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const cmsRole = await getCmsRoleForAction(locals)
  if (!cmsRole || !hasSettingsAccess(cmsRole)) return json({ error: '권한이 없습니다.' }, { status: 403 })

  const reservationId = parseInt(params.id, 10)
  if (isNaN(reservationId) || reservationId <= 0) return json({ error: '유효하지 않은 예약 ID입니다.' }, { status: 400 })

  let body: { locker_password?: string | null; locker_number?: string | null } = {}
  try {
    body = await request.json() as { locker_password?: string | null; locker_number?: string | null }
  } catch {
    body = {}
  }

  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: row, error: rowErr } = await admin
    .from('rental_reservations')
    .select('locker_password, locker_number, status, products!rental_reservations_product_id_fkey(name, parent_product_id)')
    .eq('id', reservationId)
    .maybeSingle()
  if (rowErr || !row) return json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 })

  const st = (row as { status: string }).status
  if (st === 'cancelled' || st === 'expired') {
    return json({ error: '취소·만료된 예약에는 시범 발송할 수 없습니다.' }, { status: 409 })
  }

  await applyParentFieldsToRowProducts([row], ['name'], admin)

  const typed = (body.locker_password ?? '').toString().trim()
  const password = typed || ((row as { locker_password: string | null }).locker_password ?? '')
  const typedNo = (body.locker_number ?? '').toString().trim()
  const lockerNumber = typedNo || ((row as { locker_number: string | null }).locker_number ?? '')
  if (!password || !lockerNumber) return json({ error: '무인함 번호와 비밀번호를 모두 입력해 주세요.' }, { status: 400 })
  if (!isValidLockerPassword(password)) return json({ error: LOCKER_PASSWORD_ERROR }, { status: 400 })
  if (!isValidLockerNumber(lockerNumber)) return json({ error: LOCKER_NUMBER_ERROR }, { status: 400 })

  // sendSms는 Solapi 키 미설정 시 조용히 건너뛴다 — "보냈다"고 거짓 보고하지 않도록 먼저 확인
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SMS_SENDER_PHONE) {
    return json({ error: '문자 발송 설정(Solapi)이 되어 있지 않습니다.' }, { status: 503 })
  }
  const testPhone = (env.SMS_TEST_PHONE || env.SMS_SENDER_PHONE).trim()

  const now = Date.now()
  const prev = lastSentAt.get(reservationId) ?? 0
  if (now - prev < COOLDOWN_MS) {
    return json({ error: '잠시 후 다시 시범 발송해 주세요.' }, { status: 429 })
  }
  lastSentAt.set(reservationId, now)

  const emb = (row as unknown as { products: { name?: string } | { name?: string }[] | null }).products
  const productName = (Array.isArray(emb) ? emb[0]?.name : emb?.name) ?? null
  const message = buildLockerGuideSms(productName, lockerNumber, password)

  try {
    await sendSms(testPhone, message)
  } catch {
    return json({ error: '시범 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 502 })
  }

  return json({ success: true, message, sent_at: new Date().toISOString(), to_masked: maskPhone(testPhone) })
}
