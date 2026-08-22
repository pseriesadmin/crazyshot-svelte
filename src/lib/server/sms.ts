import { env } from '$env/dynamic/private'

// SMS 발송: Aligo REST API (multipart/form-data)
// env 미설정 시 SMS 미전송 (graceful skip) — api/profile/send-otp에서 이동(2026-08-20,
// 무인보관함 안내 발송과 공유하기 위해 메시지 본문을 인자로 받는 범용 형태로 일반화).
export async function sendSms(to: string, message: string): Promise<void> {
  const apiKey      = env.ALIGO_API_KEY
  const userId      = env.ALIGO_USER_ID
  const senderPhone = env.SMS_SENDER_PHONE

  if (!apiKey || !userId || !senderPhone) {
    return
  }

  const form = new FormData()
  form.append('key',      apiKey)
  form.append('user_id',  userId)
  form.append('sender',   senderPhone)
  form.append('receiver', to)
  form.append('msg',      message)

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
