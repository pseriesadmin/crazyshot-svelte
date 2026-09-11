import { env } from '$env/dynamic/private'
import { SolapiMessageService } from 'solapi'

// SMS 발송: Solapi SDK (HMAC 서명 인증 — IP 등록 불필요, Vercel 서버리스에 최적)
// env 미설정 시 SMS 미전송 (graceful skip) — api/profile/send-otp에서 이동(2026-08-20,
// 무인보관함 안내 발송과 공유하기 위해 메시지 본문을 인자로 받는 범용 형태로 일반화).
// 2026-09-10: Aligo(IP 화이트리스트 필수) → Solapi(HMAC 인증, IP 제약 없음)로 전면 교체.
export async function sendSms(to: string, message: string): Promise<void> {
  const apiKey      = env.SOLAPI_API_KEY
  const apiSecret   = env.SOLAPI_API_SECRET
  const senderPhone = env.SMS_SENDER_PHONE

  // 키 미설정 시 graceful skip — 로컬 개발 중 OTP 발송 경로가 에러 없이 통과되도록 보장
  if (!apiKey || !apiSecret || !senderPhone) {
    return
  }

  const service = new SolapiMessageService(apiKey, apiSecret)

  // 수신번호·발신번호 양쪽 모두 하이픈 제거 필수 (Solapi 공식 예제 명시 요건)
  const toClean   = to.replace(/-/g, '')
  const fromClean = senderPhone.replace(/-/g, '')

  const res = await service.send({
    to:   toClean,
    from: fromClean,
    text: message,
  })

  if (res.failedMessageList.length > 0) {
    const first = res.failedMessageList[0]
    throw new Error(`SMS 발송 실패: ${JSON.stringify(first)}`)
  }
}

// SMS 폴백 문구 — FCM 푸시를 받지 못한 고객에게 예약 크리티컬 이벤트를 SMS로 보조 전달.
// reservation_approval·return_remind 2종만 대상(서비스 계약·반납 핵심 알림).
// 새 이벤트 추가 시 push.ts CUSTOMER_LIFECYCLE_PUSH_COPY와 동기화하고 Stephen 확인 필요.
const CRITICAL_SMS_FALLBACK_COPY: Record<string, (productName: string) => string> = {
  reservation_approval: (p) =>
    `[크레이지샷] ${p} 예약이 승인됐어요! 수령 안내는 crazyshot.kr에서 확인해 주세요.`,
  return_remind: (p) =>
    `[크레이지샷] ${p} 반납예정일이 다가와요. crazyshot.kr에서 반납 방법을 확인해 주세요.`,
}

/**
 * 예약 라이프사이클 SMS 폴백 — 고객에게 FCM 푸시 전달이 안 된 경우
 * (no_token: 토큰 미등록 / delivery_failed: FCM 전달 실패)에 보조 SMS를 발송한다.
 * 발송 대상: reservation_approval, return_remind (크리티컬 2종만)
 * 실패해도 절대 throw하지 않음 — 호출부(push.ts)의 흐름에 영향을 주지 않기 위해.
 * SOLAPI_API_KEY/SOLAPI_API_SECRET 미설정 시 sendSms 내부에서 graceful skip됨.
 */
export async function sendReservationLifecycleSmsFallback(
  phone: string,
  productName: string,
  notifyType: string,
): Promise<void> {
  const msgFn = CRITICAL_SMS_FALLBACK_COPY[notifyType]
  if (!msgFn) return
  try {
    await sendSms(phone, msgFn(productName))
  } catch {
    // SMS 발송 실패는 무시 — 푸시 폴백 시도 자체는 이미 완료됨
  }
}
