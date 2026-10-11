import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

// ⛔ 비활성화(2026-10-03, CRITICAL — Stephen 승인): PG 미연동 시절의 "임시 자동 예약승인" 경로.
// 로그인한 고객이 본인 신청대기(hold) 예약번호로 호출하면 서버 금액 검증 없이 결제완료(payment_confirmed_at)로
// 기록하고, 요청 본문의 couponIds·pointsUsed를 그대로 소진하는 구멍이 있었다
// (payAmountServerVerification.test.ts 의 pay-mock 재현과 같은 종류).
// 어떤 화면도 호출하지 않는다(cart는 create-order만 호출, 실결제 확정은
// contracts/[token]/pay-mock·pay-result와 checkout/pay/[orderId]/result 로 이동됨 — Phase C, 2026-08-21).
// 복구가 필요하면 git 이력(이 변경 직전 버전)을 참고하되, 반드시 서버 저장 orders.final_amount 대조를 포함해야 한다.
export const POST: RequestHandler = async () => {
  return json(
    { success: false, error: '더 이상 사용되지 않는 경로입니다. 결제는 계약서 결제 단계에서 진행해 주세요.', code: 'GONE' },
    { status: 410 },
  )
}
