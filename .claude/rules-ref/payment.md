# payment.md — 결제·환불·PG 도메인 규칙
# Harness Flow v3.2 | M3 Payment Domain | 2026-08-31 전면 개정(v4.0) —
# 2026-08-29~31 TossPayments v2 실연동 이후의 실제 아키텍처로 재작성.

---

## ⛔ 이 문서는 실제 구현을 그대로 반영한다 — 예전 v3.1(processPaymentAndCreateOrder 등
## 실재하지 않는 RPC를 기술하던 버전)은 폐기됐다. 결제 코드를 새로 작성하기 전 이 문서를
## 먼저 확인할 것 — 상세 검증 경위는 `.claude/harness/learnings/
## toss_payments_pg_integration_2026-08-30.md` 참고.

---

## 핵심 원칙

```
가맹점(MID) 2개 — 절대 혼용 금지
  crazysfc8s   : 단건결제(주문서형·결제창형, .widgets() 임베드) — 계약서명 결제
  bill_crazyhevr: 정기결제(빌링/자동결제) — 구독 카드등록·재청구

주문(order) 1건 = Toss 결제 1회 → payment_transactions 1행(대표 예약에 연결)
  같은 주문에 묶인 나머지(형제) 예약은 결제 게이팅만 통과 — 별도 결제 행 생성 안 함
웹훅   = 수신 즉시 raw_webhook_logs 저장 → 200 OK 반환 → pg_cron 2분마다 안전망 대사
비밀키 = TOSS_SECRET_KEY(단건) / TOSS_BILLING_SECRET_KEY(빌링) 둘 다 $env/static/private
        또는 $env/dynamic/private 전용 (H-05) — 절대 서로 바꿔 쓰지 않는다
```

---

## 환경변수 — 2개 가맹점 완전 분리

```
# 단건결제(mid=crazysfc8s) — 계약서명 결제(/contract/[token])
PUBLIC_TOSS_CLIENT_KEY        (클라이언트, .widgets() 임베드용)
TOSS_SECRET_KEY                (서버 전용)

# 정기결제/빌링(mid=bill_crazyhevr) — 구독(/subscribe/[planId])
PUBLIC_TOSS_BILLING_CLIENT_KEY (클라이언트, requestBillingAuth용)
TOSS_BILLING_SECRET_KEY        (서버 전용)
```

> ⚠️ 2026-08-30 Toss 대시보드 직접 확인 결과, bill_crazyhevr의 "보안 키"·"머트 키"는 이번
> 구현(빌링키 발급 REST API + 결제위젯 SDK)에는 불필요하다고 확정됨 — 머트 키는 "구모듈
> (XPay) 연동 상점 전용", 보안 키는 정산지급대행·현금영수증 등 미사용 기능 그룹 소속.
> 배선하지 않는다(재확인 없이 다시 배선 시도 금지 — 2026-08-31 재확인 후에도 결론 동일).
>
> LIVE 키(live_*)는 로컬 `.env.local`에 의도적으로 저장하지 않는다 — Production 전환은
> Stephen이 Vercel 대시보드에서 직접 등록.

---

## 라이브 결제 흐름 — 단건(계약서명 결제)

```
1. /contract/[token]/+page.svelte
   → loadTossSDK() (CDN v2 standard SDK)
   → toss(PUBLIC_TOSS_CLIENT_KEY).widgets({ customerKey }) 로 위젯 인스턴스 생성
     (⛔ .payment().requestPayment() 오버레이 방식 아님 — 결제위젯 클라이언트 키와
     API 개별연동 방식을 혼용하면 타입/키 불일치 에러가 실브라우저 E2E에서만 드러남,
     2026-08-29 실제 발견)
   → tossWidgets.requestPayment({ successUrl, failUrl, ... }) 호출

2. successUrl: /contract/[token]/pay-result/+page.server.ts (토큰 기반, 로그인 세션 불필요)
   → 서명 완료 검증(contract_signings.signed_at)
   → order_items로 내부 주문ID(BIGINT) + 형제 예약 ID 목록 조회
   → 이중결제 방지 가드: payment_transactions에 idempotency_key/order_id 기존 행 있으면
     Toss confirm 호출 없이 바로 /contract/complete로 리다이렉트
   → Toss 결제 승인 API(POST /v1/payments/confirm, Basic auth = TOSS_SECRET_KEY)
   → confirm_order_payment_and_update_reservations RPC(Migration 378)
   → 알림(resolveApprovalNotifyPlan으로 묶음주문 통합/개별 판단)·푸시·쿠폰/포인트 소진
   → /contract/complete
```

## 라이브 결제 흐름 — 정기결제(빌링)

```
1. /subscribe/[planId]/+page.svelte
   → toss(PUBLIC_TOSS_BILLING_CLIENT_KEY).payment({ customerKey }).requestBillingAuth({
       method: 'CARD',   -- ⛔ v2 SDK 객체형 API는 영문 대문자 enum 'CARD' 고정.
                          -- v1 SDK의 위치인자 방식(tossPayments.requestBillingAuth('카드', ...))
                          -- 과 혼동 금지 — '카드'(한글) 전달 시 Toss가 즉시
                          -- "method 파라미터에 사용할 수 없는 enum 값입니다" 거부
                          -- (2026-08-31 실사용 중 발견·수정)
       successUrl, failUrl,
     })

2. successUrl: /subscribe/success/+page.server.ts
   → authKey + customerKey(=session.user.id) → POST /v1/billing/authorizations/issue
     (Basic auth = TOSS_BILLING_SECRET_KEY) → billingKey 발급
   → create_user_subscription RPC → chargeSubscription()(최초 청구, 공유 헬퍼)

3. /api/cron/subscription-billing (Vercel Cron, 매일)
   → claim_subscriptions_due_for_billing RPC(Migration 259, FOR UPDATE SKIP LOCKED +
     billing_claimed_at stale 재선점)로 원자적 선점 → chargeSubscription() 재사용
   → chargeSubscription(): POST /v1/billing/{billingKey}(Basic auth = TOSS_BILLING_SECRET_KEY)
     → record_subscription_charge_result RPC → subscription_payment_logs INSERT
     (payment_transactions와 완전히 별개 테이블·별개 상태 어휘: succeeded/failed)
```

---

## 웹훅 처리 패턴

```typescript
// +server.ts — /api/webhooks/toss
export const POST = async ({ request }) => {
  const rawBody = await request.text()
  const signature = request.headers.get('toss-payments-signature')

  // 1. HMAC-SHA256 서명 검증 (raw body 기준, JSON.stringify 재직렬화 아님)
  if (!verifyTossSignature(rawBody, signature, TOSS_SECRET_KEY)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. 즉시 raw_webhook_logs에 저장 (service_role, 비동기 — 실패해도 200 반환)
  admin.from('raw_webhook_logs').insert({ source: 'toss', event_type, payload, signature, processed: false })

  // 3. 즉시 200 반환 (1초 이내 필수)
  return new Response('OK', { status: 200 })
  // 4. pg_cron(toss-webhook-reconcile, 2분마다)이 백그라운드에서 대사
}
```

**웹훅 페이로드 구조**(실측): `{ eventType, data: { orderId, status, paymentKey, ... } }` —
최상위가 아니라 `data` 안에 중첩. `payload -> 'data' ->> 'orderId'`로 파싱해야 함
(Migration 380 최초 구현은 최상위에서 파싱해 항상 no-op이었음 — 383에서 수정).

---

## 웹훅 대사(reconcile) — 안전망일 뿐, 능동 교정 없음

```
process_pending_toss_webhooks() (pg_cron, 2분마다, 최대 50건/사이클, FOR UPDATE SKIP LOCKED):
  payment_transactions.order_id = 웹훅 orderId로 대사
  ├─ 매칭 행 없음                                  → no_matching_payment_transaction
  │  (빌링 청구 웹훅·Toss 대시보드 테스트 발송 핑은 payment_transactions 자체가 없어
  │   항상 이 분기 — 버그 아님. 실주문 orderId는 CSHOT-*, 빌링은 SUB-*, 테스트 핑은
  │   ORDER-TEST-* 접두사로 구분 가능)
  ├─ pt_status=cancelled AND wh_status=DONE          → STATUS_MISMATCH_WARN (방향 A)
  ├─ pt_status=done AND wh_status∈{CANCELED,
  │  PARTIAL_CANCELED,ABORTED,EXPIRED}               → STATUS_MISMATCH_WARN (방향 B,
  │                                                     Migration 388 — 카드사 이의제기 등
  │                                                     PG단 단독 역전 탐지용)
  └─ 그 외                                           → reconciled

⛔ 1차 범위(안전망)만 — 불일치를 감지해 로그만 남길 뿐, 예약 상태를 자동으로 되돌리거나
   재처리하는 능동적 자동화는 없다. 확장은 별도 승인 필요.
```

---

## 결제상태 조회 — CMS "결제정보" 탭

```
get_rental_list RPC의 payment_status 컬럼은 payment_transactions.status를 반영한다
(Migration 387부터 — 그 이전엔 orders.status를 노출했는데, orders.status는 INSERT
시점에 항상 'pending' 고정이고 이후 어떤 코드 경로도 갱신하지 않아 실제 결제 상태와
무관하게 영구히 'pending'만 표시되는 결함이 있었다).

대표 예약(payment_transactions.reservation_id 직접 매칭) 우선, 없으면 order_items
경유로 같은 주문의 형제 예약이 가진 결제 기록을 찾는다. 결제 시도 자체가 없는 예약
(HOLD 등)은 NULL — CMS는 이를 '-'로 표시(orders.status의 stale 'pending'을 더 이상
잘못 노출하지 않음).
```

---

## 환불 처리 — CMS

```
PUT /api/cms/reservations/[id]/payment (manager 이상, security-auth.md 매트릭스)
  1. payment_transactions.status='done' 더블가드(이미 취소됐거나 결제 미완료면 차단)
  2. rental_reservations.status='cancelled' 더블가드
  3. Toss 전액취소 API(POST /v1/payments/{paymentKey}/cancel, Basic auth=TOSS_SECRET_KEY)
     — Toss 취소가 먼저, DB 갱신은 그 다음(Toss 실패 시 DB 변경 없음)
  4. cancel_reservation_payment RPC(Migration 379/384)
     — "주문 전체 전액환불"(Stephen 확정): payment_transactions 1행만 cancelled 처리하고,
       같은 주문(order_items 경유)에 묶인 모든 예약을 함께 cancelled 전환(멱등 — 이미
       cancelled인 예약은 스킵)
     — cancel_reason·cancelled_by 감사 컬럼 기록(Migration 384)
  5. 취소된 예약 각각에 알림(reservation_cancelled)·브라우저 푸시·두발히어로 배송취소를
     fail-soft로 처리(환불 자체는 이미 완료됐으므로 여기서 실패해도 롤백 안 함)
```

**혼동 주의**: `cancel_payment_and_release_hold`(결제 전 HOLD 포기용)와
`cancel_reservation_payment`(결제 후 Toss 환불용, Migration 379)는 이름이 비슷한
완전 별개 RPC다. 2026-08-31 확인 결과 전자는 현재 라이브 코드 어디서도 호출되지 않는
고아 상태(→ 아래 "삭제된 레거시 경로" 참고) — 신규 코드에서 재사용하지 말 것.

---

## ⛔ 삭제된 레거시 경로 (2026-08-31)

다음 4개 파일은 사용처 0건(전수 grep 확인) + 그중 하나는 존재하지 않는 컬럼을 조회해
도달 시 확정적으로 크래시함을 확인 후 삭제됐다. 카트(cart)가 더 이상 이 경로로 연결되지
않는다 — 실제 결제 확정은 전부 위 "라이브 결제 흐름" 절의 `/contract/[token]/pay-result`
(단건) 또는 `/subscribe/success`(빌링) 경유다.

```
src/routes/payment/success/+page.server.ts   (삭제됨 — cart_items 테이블 컬럼명을
src/routes/payment/fail/+page.server.ts       삭제됨   착각해 존재하지 않는 rental_start_date/
src/routes/api/payment/confirm/+server.ts     삭제됨   rental_end_date/special_requests 조회)
src/routes/api/checkout/initiate/+server.ts   삭제됨
```

이 라우트들이 전용으로 쓰던 RPC(`confirm_payment_and_update_reservation`,
`cancel_payment_and_release_hold`, `atomic_reserve_asset`, `calculate_cart_total`)는
DB에서 삭제하지 않고 남겨뒀다(별도 승인 필요 항목) — `payment.test.ts`의 RPC 레벨
테스트가 계속 이 RPC들의 동작을 검증한다. `/payment/success/dev`(장바구니 "신청완료"
안내 화면, mock)는 별개이며 삭제되지 않았다 — 이름에 "dev"가 들어있지만 라이브 경로다.

---

## GATE C 확인 항목 (M3 관련)

```
[ ] 단건결제(crazysfc8s)와 빌링(bill_crazyhevr) 키를 서로 바꿔 쓰지 않았는가?
[ ] .widgets() 임베드 방식을 유지하는가? (.payment().requestPayment() 오버레이 재도입 금지)
[ ] requestBillingAuth의 method가 'CARD'(영문 대문자)인가? ('카드' 한글 금지 — v1/v2 혼동)
[ ] 웹훅 핸들러가 200 OK를 1초 이내에 반환하는가?
[ ] raw_webhook_logs에 웹훅 원본이 먼저 저장되는가? (payload -> 'data' ->> 'orderId' 파싱)
[ ] 신규 결제 확정 RPC를 추가한다면 confirm_order_payment_and_update_reservations
    (주문 그룹, Migration 378) 패턴을 따르는가? (레거시 단일예약용 confirm_payment_and_
    update_reservation을 새로 호출하는 코드를 추가하지 않았는가 — 고아 RPC로 남겨진 것)
[ ] 환불은 "주문 전체 전액환불" 원칙을 따르는가? (부분 환불 UI를 임의로 추가하지 않았는가)
[ ] payment_status를 새로 노출하는 지점이 있다면 orders.status가 아니라
    payment_transactions.status 기준인가?
[ ] TOSS_SECRET_KEY/TOSS_BILLING_SECRET_KEY → $env/static/private 또는 dynamic/private?
[ ] 결제 성공 후 예약 반드시 confirmed로 전환? (계약서명 게이팅과 AND 조건,
    service-operations.md §9)
```

---

*payment.md v4.0 | Harness Flow v3.2 | 2026-08-31 전면 개정 — 2026-08-29~31 TossPayments v2
실연동(주문 그룹 결제·빌링·CMS 환불·웹훅 안전망) 이후의 실제 아키텍처로 재작성. 예전 v3.1
(processPaymentAndCreateOrder 등 실재하지 않는 RPC 기술)은 폐기. 상세 검증 경위·발견된
버그 타임라인은 `.claude/harness/learnings/toss_payments_pg_integration_2026-08-30.md` 참고.*
