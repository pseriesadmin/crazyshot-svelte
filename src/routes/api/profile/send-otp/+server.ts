import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'
import { createClient } from '@supabase/supabase-js'

// SMS 발송: Aligo REST API (multipart/form-data)
// env 미설정 시 개발 콘솔 출력 (실제 SMS 미전송)
async function sendSms(to: string, code: string): Promise<void> {
  const apiKey      = process.env.ALIGO_API_KEY      ?? ''
  const userId      = process.env.ALIGO_USER_ID      ?? ''
  const senderPhone = process.env.SMS_SENDER_PHONE   ?? ''

  if (!apiKey || !userId || !senderPhone) {
    return
  }

  const form = new FormData()
  form.append('key',      apiKey)
  form.append('user_id',  userId)
  form.append('sender',   senderPhone)
  form.append('receiver', to)
  form.append('msg',      `[크레이지샷] 휴대폰 인증번호: ${code} (5분 내 입력)`)

  const res = await fetch('https://apis.aligo.in/send/', {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    throw new Error(`Aligo HTTP 오류: ${res.status}`)
  }

  const data = await res.json() as { result_code: number; message: string }
  if (data.result_code !== 1) {
    throw new Error(`SMS 발송 실패: ${data.message} (code ${data.result_code})`)
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const { session } = await locals.safeGetSession()
  if (!session) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  let phone: string
  try {
    const body = await request.json() as { phone?: string }
    phone = (body.phone ?? '').replace(/[^0-9]/g, '')
  } catch {
    return json({ ok: false, error: '잘못된 요청입니다.' }, { status: 400 })
  }

  if (!/^010\d{8}$/.test(phone)) {
    return json({ ok: false, error: '올바른 휴대폰 번호를 입력해 주세요. (010-XXXX-XXXX)' }, { status: 400 })
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

  // service_role 클라이언트로 phone_otps 삽입 (RLS bypass)
  const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 기존 미인증 OTP 만료 처리 (동일 user+phone)
  await admin
    .from('phone_otps')
    .update({ expires_at: new Date().toISOString() })
    .eq('user_id', session.user.id)
    .eq('phone', phone)
    .is('verified_at', null)

  const { error: insertErr } = await admin.from('phone_otps').insert({
    user_id: session.user.id,
    phone,
    code,
    expires_at: expiresAt,
  })

  if (insertErr) {
    console.error('[send-otp] insert error:', insertErr)
    return json({ ok: false, error: '인증번호 생성 실패' }, { status: 500 })
  }

  try {
    await sendSms(phone, code)
  } catch (err) {
    console.error('[send-otp] sms error:', err)
    return json({ ok: false, error: 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }

  return json({ ok: true })
}
