# payment.md — 결제·환불·PG 도메인 규칙
# Harness Flow v3.1 | M3 Payment 도메인

---

## 핵심 원칙

```
결제창 = atomic_reserve_asset 성공 확인 후 열기 (재고 없이 결제창 열기 금지)
웹훅   = 수신 즉시 raw_webhook_logs 저장 → 200 OK 반환 → pg_cron 처리
멱등성 = idempotency_key로 중복 결제 방지 (DB UNIQUE 제약)
비밀키 = TOSS_SECRET_KEY $env/static/private 전용 (H-05)
실결제 = payment_transactions / 보증금 = deposit_holds (테이블 분리)
```

---

## 결제 플로우

```
1. atomic_reserve_asset RPC → HOLD 획득
2. calculate_cart_total RPC → 금액 확정 + calc_at 타임스탬프 기록
3. TossPayments.requestPayment() 호출 (클라이언트)
4. 결제 완료 → /api/payment/confirm 서버 라우트 호출
5. 서버에서 Toss 결제 승인 API 호출
6. 성공: reservation confirmed + payment_transactions INSERT (RPC 경유)
7. 실패: HOLD 해제 (reservation cancelled)
```

---

## 웹훅 처리 패턴 (필수)

```typescript
// +server.ts — /api/webhooks/toss
export const POST = async ({ request }) => {
  const body = await request.json()
  const signature = request.headers.get('toss-payments-signature')

  // 1. HMAC-SHA256 서명 검증
  if (!verifyTossSignature(body, signature)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. 즉시 raw_webhook_logs에 저장 (처리 전)
  await supabase.from('raw_webhook_logs').insert({
    payload: body,
    processed: false,
    received_at: new Date().toISOString()
  })

  // 3. 즉시 200 반환 (1초 이내 필수 — Vercel 타임아웃 위험)
  return new Response('OK', { status: 200 })
  // 4. pg_cron이 백그라운드에서 9단계 계산 처리
}

// ❌ 금지: 동기로 9단계 계산 후 반환 (10초+ → Vercel 타임아웃)
```

---

## 9단계 금액 계산 (pg_cron 백그라운드)

```
1. 기본 렌탈료 (기간 × 단가)
2. 멤버십 할인
3. 쿠폰 할인
4. 포인트 차감
5. VAT 역산
6. 배송비 (CRAZY 등급 → 0)
7. 보증금 계산 (크레이지스코어 기반)
8. 혼합결제 분리 (실결제 vs 포인트 vs 보증금)
9. 최종 금액 검증 (calc_at 30초 유효성)
```

---

## calc_at 유효성 체크

```typescript
// 결제 승인 시 금액이 바뀌지 않았는지 검증
const CALC_VALIDITY_SECONDS = 30
const calcAge = (Date.now() - new Date(calc_at).getTime()) / 1000
if (calcAge > CALC_VALIDITY_SECONDS) {
  // 재계산 요청 (금액 변동 가능성)
  return { error: 'PRICE_EXPIRED', message: '금액이 만료되었습니다. 다시 확인해주세요.' }
}
```

---

## 환불 처리

```
전액 환불: TossPayments 취소 API → reservation cancelled → 보증금 release
부분 환불: 쿠폰/포인트 복원 규칙 적용 (비례 복원)
보증금 환불: deposit_holds.status = 'released' → 별도 계좌 이체 프로세스
```

---

## RPC 함수 참조

```typescript
// 장바구니 금액 계산 (서버사이드)
await supabase.rpc('calculate_cart_total', {
  p_user_id: string,
  p_reservation_ids: string[],
  p_coupon_code?: string,
  p_points_to_use?: number
})
// 반환: { total: number, breakdown: PriceBreakdown, calc_at: string }

// 결제 완료 + 예약 확정 (원자적)
await supabase.rpc('processPaymentAndCreateOrder', {
  p_payment_key: string,
  p_order_id: string,
  p_amount: number,
  p_idempotency_key: string
})
```

---

## TDD 필수 케이스 (M3 테스트 작성 시)

```
Happy:
- 정상 결제: HOLD → 결제 승인 → confirmed + payment 기록
- 웹훅 수신 → 1초 이내 200 OK 반환
- 동일 웹훅 재전송 → 중복 처리 안 됨 (processed 컬럼)

Edge:
- calc_at 30초 초과 → PRICE_EXPIRED 에러
- 결제 금액 불일치 → 승인 거부
- 부분 취소 후 나머지 결제

Error:
- 결제 실패 → HOLD 자동 해제 확인
- 토스 서버 다운 → 웹훅 재시도 처리
- 같은 idempotency_key 두 번 → 두 번째 무시 확인
```

---

## GATE C 확인 항목 (M3 관련)

```
[ ] 웹훅 핸들러가 200 OK를 1초 이내에 반환하는가?
[ ] raw_webhook_logs에 웹훅 원본이 먼저 저장되는가?
[ ] pg_cron 백그라운드에서 9단계 계산이 처리되는가?
[ ] 동일 웹훅 재전송 시 중복 처리 안 되는가? (processed 컬럼)
[ ] idempotency_key → 같은 결제 두 번 불가?
[ ] 결제 성공 후 예약 반드시 confirmed로 전환?
[ ] TOSS_SECRET_KEY → $env/static/private import?
[ ] calc_at 30초 유효성 체크?
[ ] 할인순서: 기본료→멤버십→쿠폰→포인트→VAT역산→배송비
```

---

*payment.md v3.1 | Harness Flow v3.1 | M3 Payment Domain*
