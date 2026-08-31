# TossPayments PG 연동 — 전역 기능 로직 정밀 작동 검증 리포트

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서가 "수정완료 기록"으로 남긴 F1·F2·F3 및 배송비·
> 계약중복 갭은 CMS 전역 정밀 검증 v5에서 소비 앱코드 실배선까지 재확인됐다 — 최신 판정은
> `cms_global_verification_v5_synthesis_2026-08-31.md` 참고. 이 문서는 원본 그대로 보존한다.
# 작성일: 2026-08-31 | plan_source: /Users/stevenmac/.claude/plans/golden-snacking-shore.md

---

## 0. 이 문서의 성격

이 문서는 원래 플랜(`golden-snacking-shore.md`)이 "다음 세션이 실행할 체크리스트"로
설계했던 항목들을, **실제로 이번 세션에서 코드 직접 대조 + Stage DB(ezyvffjvuwmtuhpxdjrw)
라이브 쿼리로 실행·검증한 결과**를 기록한다. 즉 "확인 필요" 나열이 아니라 각 항목의 실제
결론(CONFIRMED / 문제없음 / 추가발견)을 담고 있다.

검증 방법: 코드 정독(전체 PG 관련 라우트 10개 파일 + 핵심 마이그레이션 5개 SQL 전문) +
`information_schema` 컬럼 직접 조회 + `orders`/`payment_transactions`/`raw_webhook_logs`
실데이터 교차조회(Stage DB, 읽기 전용 SELECT만 사용, 쓰기 없음).

---

## 1. 배경 — mock → 실연동 전환 개요 (기존 GSD_LOG 요약, 변경 없음)

2026-08-29~30 세션에서 TossPayments v2 PG 결제 모듈을 처음으로 실연동했다(계약서명 결제·
구독 빌링·CMS 환불·웹훅 후속처리, Phase 1~5). 핵심 설계:
- 주문(order) 1건 = Toss 결제 1회 → `payment_transactions` 1행(대표 reservation 연결),
  나머지 형제 예약은 `mark_reservation_payment_confirmed` 루프로 §9 게이팅 통과
  (Migration 378 `confirm_order_payment_and_update_reservations`).
- "주문 전체 전액환불"(Stephen 확정) — `cancel_reservation_payment`(Migration 379/384)가
  같은 order의 전체 reservation을 취소.
- `.widgets()` 임베드 방식 채택(`.payment().requestPayment()` 오버레이 방식에서 교체 —
  결제위젯 클라이언트 키와 API 개별연동 방식의 혼용 버그를 실브라우저 E2E로 발견해 교체).
- 단건결제(`crazysfc8s`, `TOSS_SECRET_KEY`)와 정기결제(`bill_crazyhevr`,
  `TOSS_BILLING_SECRET_KEY`)는 서로 다른 상점의 별개 시크릿 키 — 코드 레벨에서 완전 분리
  확인됨(`subscribe/success/+page.server.ts`, `subscribe/[planId]` cron 모두
  `TOSS_BILLING_SECRET_KEY` 전용 사용, 단건결제 경로는 `TOSS_SECRET_KEY`만 사용).

실제 라이브 결제 흐름(현재 유일하게 살아있는 경로):
```
/contract/[token] (.widgets().requestPayment())
  → successUrl: /contract/{token}/pay-result
  → Toss confirm API → confirm_order_payment_and_update_reservations RPC(#378)
  → 알림/푸시 + 쿠폰·포인트 소진 → /contract/complete

/subscribe/[planId] (requestBillingAuth)
  → successUrl: /subscribe/success?planId=…
  → billingKey 교환 → create_user_subscription → chargeSubscription()
  → record_subscription_charge_result (subscription_payment_logs INSERT)

/api/cron/subscription-billing (Vercel Cron, 매일)
  → claim_subscriptions_due_for_billing(#259, 원자적 선점) → chargeSubscription() 재사용
```

---

## 2. 이번 세션 검증 결과 — CONFIRMED 발견 사항 (우선순위 순)

### 🔴 F1. `orders.status`("결제 상태" 필드)가 영구히 'pending' — CMS 화면에 실제로 잘못된 값 표시 중 (라이브 데이터로 재현 확인)

**증상**: `RentalDetailPanel.svelte` "결제정보" 탭 "주문 정보" 섹션의 **"결제 상태"**
필드(1339~1340행, `row.payment_status`)가 실제 결제 완료·환불 여부와 무관하게 항상
"pending"만 표시한다.

**근거(코드)**:
- `get_rental_list` RPC(최신: Migration #369)가 `payment_status`를 `o.status`(orders 테이블의
  status 컬럼) 그대로 매핑한다(125행: `o.status AS payment_status`).
- 전체 마이그레이션에서 `orders.status`를 변경하는 `UPDATE` 문은 단 한 곳도 없다(존재하는
  3곳의 `UPDATE orders`는 전부 `total_amount/discount_amount/final_amount/selected_coupon_id/
  selected_points`만 갱신 — status는 건드리지 않음). INSERT 시점에 항상 `'pending'`으로
  고정 삽입(`VALUES (..., 'pending')`, Migration #251/280/340 3곳 동일).
- 이 값은 **4개 CMS 진입점이 전부 동일한 `get_rental_list` RPC + 동일한
  `RentalDetailPanel.svelte` 컴포넌트를 공유**해서 노출된다: `/cms/reservation`,
  `/cms/rentals`, `/cms/mobile/rentals`, `src/lib/components/chat/AdminChatPanel.svelte`
  임베드 모달(`/api/cms/reservations/[id]/detail`도 동일 RPC 재사용, Migration #327 패턴).
  → 원 플랜이 "4개 화면 각각의 리스크"로 프레이밍했던 것과 달리, 실제로는 **단일 RPC +
  단일 컴포넌트를 공유하는 구조**라 코드 드리프트 위험은 없다(수정 지점도 1곳). 다만
  노출 범위(관리자가 이 값을 보는 화면 수)는 원 플랜 그대로 4곳 맞음.

**근거(실데이터, Stage DB 직접 쿼리)**:
```sql
-- orders.status 분포
{"status":"pending","count":139}, {"status":"paid","count":5}
-- (5건 'paid'는 초기 더미시드 — INSERT문 전수조사 결과 앱코드가 'paid'를 넣는 경로 없음)

-- 실제 라이브 Toss 결제 1건(reservation_id=4688, order_id='CSHOT-1788066656936')과
-- 그 주문의 orders.status 교차조회
{"order_status":"pending","pt_status":"done","count":1}
```
→ **이번 세션 이전에 Stephen이 직접 실카드 결제까지 완주해 검증했던 그 예약(4688)** 이
Stage DB에 현재도 남아있고, `payment_transactions.status='done'`(실제 결제 완료)인데
`orders.status`는 `'pending'`으로 남아있음을 라이브 데이터로 직접 재확인했다. 즉 지금 이
순간 CMS에서 예약 4688을 열면 "결제 상태: pending"이 표시된다.

**추가 확인된 모순**: 같은 "결제정보" 탭 안에서, "결제 상태"(위, 틀림) 바로 아래
섹션의 환불 버튼 활성화 조건(`paymentDetail?.status === 'done'`, 1422행)은 **다른
정확한 소스**(`payment_transactions.status`, `/api/cms/reservations/[id]/payment` GET)를
쓴다 — 즉 예약 4688을 열면 "결제 상태: pending"이라고 쓰여 있는데 바로 그 아래에 "환불
처리" 버튼은 활성화되어 있는, **같은 화면 안에서 서로 모순된 정보**가 동시에 보인다.

**영향도**: 관리자가 "결제 상태" 필드만 보고 미결제로 오인해 재결제 유도·문의 응대를
잘못할 수 있음. 실제 환불 가능 여부·CS 응대는 아래쪽 "환불 처리" 버튼(정확한 소스) 기준으로
는 정상 동작하므로 **자금 처리 자체가 잘못되지는 않으나, 표시 정보는 확정적으로 틀렸다.**

**권고(미실행 — Stephen 확인 필요, 결제 도메인 CRITICAL)**: `get_rental_list`의
`payment_status` 컬럼 소스를 `orders.status` 대신 `payment_transactions.status`(대표
reservation 또는 order_items 경유 최신 행) 기준으로 재정의. 결제 CRITICAL 도메인이라 이번
세션에서는 수정하지 않고 발견만 기록.

---

### 🟡 F2. 레거시 단건결제 체크아웃 라우트 4개 — 완전한 고아 코드(사용처 0) + 그중 1개는 실행 시 확정적으로 크래시

**대상 4개 파일**(전부 실사용 호출부 0건, `grep` 전수조사로 확인):
- `src/routes/payment/success/+page.server.ts`
- `src/routes/payment/fail/+page.server.ts`
- `src/routes/api/payment/confirm/+server.ts`
- `src/routes/api/checkout/initiate/+server.ts`

**"사용처 0건" 근거**: 코드베이스 전체에서 `successUrl`을 `/payment/success`로 설정하는
곳, `/api/checkout/initiate`나 `/api/payment/confirm`으로 `fetch()`하는 곳이 **테스트
파일의 주석 외에는 전무**함을 확인(`reservation.test.ts` 자체 주석: "S1-M3 결제 통합
BLOCKED 당시 만들어진 /api/checkout/initiate 전용, 프론트 미연결"). 현재 라이브 결제는
전부 `/contract/[token]/+page.svelte`(`.widgets().requestPayment()`) 경유이며 이
4파일과는 완전히 분리된 별도 코드 경로다.

**`/payment/success/+page.server.ts`는 도달 시 100% 크래시 확정** — Stage DB
`information_schema.columns` 직접 조회로 검증:
```sql
-- rental_reservations 테이블의 실제 %date% 컬럼: end_date, start_date, updated_at 뿐
-- special_requests 컬럼은 아예 존재하지 않음(빈 결과)
```
그런데 88행이 `.from('rental_reservations').select('id, rental_start_date,
rental_end_date, special_requests, product_id, status')`를 실행 — `rental_start_date`/
`rental_end_date`/`special_requests` 3개 컬럼 전부 존재하지 않아 Postgres 42703
(undefined_column) 즉시 발생. (참고: `rental_start_date`/`rental_end_date`는
`cart_items` 테이블의 실제 컬럼명이라, 다른 테이블 스키마를 착각해 그대로 옮겨 쓴 것으로
추정.) **단, 이 지점 이전에 Toss confirm API 호출과 `confirm_payment_and_update_reservation`
RPC(결제 확정)는 이미 성공한 뒤라 — 만약 이 죽은 경로가 실제로 도달된다면 "고객 카드는
결제되고 예약도 confirmed 처리됐는데 결과 화면만 500 에러로 깨지는" 시나리오가 된다.**
현재는 사용처가 없어 위험이 잠재적(latent)일 뿐, 활성 위험은 아니다.

**이 죽은 4파일이 쓰는 RPC 중 3종은 정말 고아 상태**(다른 라이브 코드 어디서도 호출 안 됨,
전수 grep 확인): `confirm_payment_and_update_reservation`, `cancel_payment_and_release_hold`,
`atomic_reserve_asset`.
- `atomic_reserve_asset`/`confirm_payment_and_update_reservation`은 이 죽은 4파일
  외 호출처가 전혀 없음(완전 고아 RPC — 함수 자체는 살아있으나 아무도 안 부름).
- `cancel_payment_and_release_hold`도 마찬가지로 고아 상태 — 살아있는 "카트 HOLD 취소"
  경로(`/api/reservations/cancel-hold/+server.ts`)는 자체 주석으로 "이 RPC는 status IN
  ('temp','pending','confirmed')만 처리해 'hold' 상태에는 적용 안 됨(Stage DB로 직접
  확인)"이라며 의도적으로 `update_reservation_status`를 대신 쓰고 있음 — 즉 살아있는
  코드는 이 RPC를 **의도적으로 회피**하고 있다.

⚠️ **정정(2026-08-31, 삭제 실행 직전 재검증으로 발견)**: 처음에 `calculate_cart_total`도
같은 고아 그룹으로 분류했으나 **오판이었다** — `(supabase.rpc as unknown as CalcRpcFn)
('calculate_cart_total', ...)` 형태의 타입캐스팅 호출 패턴 때문에 최초 조사의
`grep "rpc('calculate_cart_total'"` 패턴이 실제 호출부(`src/routes/cart/+page.server.ts:358`,
카트 화면 금액계산에 현재도 사용 중)를 놓쳤다. **`calculate_cart_total`은 삭제하지 않는다**
— 삭제 대상은 위 3종(`confirm_payment_and_update_reservation`·
`cancel_payment_and_release_hold`·`atomic_reserve_asset`)으로 한정.

**권고(→ 2026-08-31 Stephen 승인 후 실행 완료, 아래 §7 참고)**: 위 3개 고아 RPC 삭제.

---

### 🟢 F3. 웹훅 대사(reconcile) 로직 — 현재 실트래픽 기준으로는 정상, 단 코드 레벨 비대칭 존재

Migration #380/#383(`process_pending_toss_webhooks`) 실데이터 조회:
```sql
select process_result->>'note', count(*) from raw_webhook_logs where source='toss' group by 1;
→ {"no_matching_payment_transaction": 71}  (전체 71건)
```
71건 전부 `order_id`가 `ORDER-TEST-...` 패턴 — Toss 개발자센터의 **웹훅 테스트 발송**
기능이 보낸 합성 핑(우리 실제 주문번호 체계 `CSHOT-...`/`SUB-...`와 무관)임을 payload
직접 조회로 확인. 즉 "71건 전부 미매칭"은 버그가 아니라 **테스트 핑이 매칭 안 되는 게
정상**인 상태 — 실제 결제 웹훅(진짜 `CSHOT-...` 주문)이 아직 이 로그에 없다.

다만 코드 레벨에서 비대칭 갭 1건 확인(현재까지 실트래픽으로는 드러난 적 없음 — 추후
발생 가능한 잠재 결함): `process_pending_toss_webhooks`의 불일치 판정은
`pt_status='cancelled' AND wh_status='DONE'` 방향만 `STATUS_MISMATCH_WARN`으로
탐지한다. 반대 방향(`pt_status='done'`인데 Toss 쪽 웹훅은 `CANCELED`/
`PARTIAL_CANCELED`/`ABORTED`/`EXPIRED` 등 — 예: 카드사 이의제기로 PG단에서 결제가
역전된 경우)은 `ELSE` 분기로 떨어져 `'reconciled'`(정상 대사 완료)로 잘못 표기된다.
이 함수 자체 주석이 "1차 범위(안전망): 불일치 로그 + processed=true 마킹만"이라 의도적
축소 스코프일 가능성이 있으나, 판정 방향이 편도(one-way)라는 점은 명시적으로 기록해둔다.

---

### 🟢 F4. 확인만 하고 문제없음으로 종결된 항목

- **주문 금액 조회 로직 중복 구현 2곳** — `src/routes/account/rental/[id]/contract/
  +page.server.ts`(143~162행)와 `src/routes/api/cms/reservations/[id]/contract-data/
  +server.ts`가 각각 독립적으로 `order_items → orders` 조인을 재구현. 두 곳 다 단순
  `SELECT`(금액 표시용)이고 상태 변경 로직은 없어 버그 위험은 낮음 — 다만 유지보수 시
  두 파일을 항상 같이 확인해야 하는 중복은 그대로 존재.
- **`subscription_payment_logs`는 `payment_transactions`와 완전히 분리된 별도 시스템**
  확인 — `CustomerDetailPanel.svelte` "구독이력" 탭은 `/cms/customers/subscriptions`
  전용 엔드포인트로 `subscription_payment_logs`(status: succeeded/failed 어휘)를 별도
  조회하며, `payment_transactions`(status: pending/done/cancelled 등 어휘)와는 코드
  경로가 겹치지 않음 — 혼동 위험 없음, 명명 규칙만 서로 다름을 인지하면 됨.
- **매출 KPI 카드**(`get_dashboard_today_stats`)는 `payment_transactions.status='done'`을
  직접 필터하므로 F1(orders.status 버그)·F3(웹훅 대사)의 영향을 받지 않음 — 별도
  독립 확인 완료.
- **정기결제 이중청구 방지**(Migration #259 `claim_subscriptions_due_for_billing`) —
  `FOR UPDATE SKIP LOCKED` + `billing_claimed_at` stale 재선점 메커니즘 코드 검토 결과
  견고함. 크론 중복 실행·겹침에도 같은 구독이 두 번 청구되지 않는 구조 확인, 별도 이슈 없음.
- **`cancel_payment_and_release_hold`(결제 전 HOLD 포기) vs `cancel_reservation_payment`
  (Toss 결제 후 환불, Migration #379)** — 이름은 비슷하나 실제 별개 RPC이고 현재 코드에서
  혼동해 쓰는 지점은 없음을 확인(단, 전자는 F2에서 밝혀졌듯 고아 상태).

---

## 3. 문서 스테일니스(부수 발견)

`.claude/rules-ref/payment.md`(v3.1)가 이번에 실연동된 아키텍처를 전혀 반영하지 못하고
있음을 확인 — 문서는 `processPaymentAndCreateOrder`라는, 현재 코드베이스 어디에도 존재하지
않는 RPC명을 "결제 완료 + 예약 확정" RPC로 안내하고 있고, 주문 그룹핑(order_items)·
`.widgets()` 임베드·크레이지스코어 기반 보증금·9단계 계산 로직 등 실제 구현과의 괴리가
크다. `CLAUDE.md`가 "결제·웹훅(M3) 작업 시 `@.claude/rules-ref/payment.md` 로드"를
명시하고 있어, 다음에 결제 도메인을 건드리는 세션이 이 문서를 그대로 신뢰하면 잘못된
RPC명으로 구현을 시도할 위험이 있다. **범위 외 수정이라 이번 세션에서 갱신하지 않음 —
별도 승인 필요.**

---

## 4. 미해결·후속 필요 항목

1. ✅ **F1(orders.status 버그) — 수정 완료(2026-08-31)**: Migration 387로 `get_rental_list`의
   `payment_status`를 `payment_transactions.status` 기준(대표+형제 예약)으로 교체. TDD
   4케이스(대표/형제/환불/미결제) 전부 GREEN, Stage 적용 완료.
2. ✅ **F2(레거시 4파일 + 고아 RPC 3종) — 전부 삭제 완료(2026-08-31)**: `/payment/success`,
   `/payment/fail`, `/api/payment/confirm`, `/api/checkout/initiate` 파일 삭제(1차) +
   `confirm_payment_and_update_reservation`·`cancel_payment_and_release_hold`·
   `atomic_reserve_asset` RPC 3종 삭제(2차, Migration 396, Stephen 승인 후 Stage+Production
   양쪽 DROP FUNCTION). `payment.test.ts`의 RPC 직접호출 테스트도 함께 제거.
   ⚠️ `calculate_cart_total`은 처음에 같은 고아 그룹으로 오판했으나, 삭제 실행 직전
   재검증에서 `cart/+page.server.ts`가 타입캐스팅 호출 패턴(`(supabase.rpc as unknown as
   CalcRpcFn)(...)`)으로 여전히 사용 중임을 발견해 삭제 대상에서 제외 — 최초 grep이
   이 호출 패턴을 놓쳤던 것.
3. ✅ **F3(웹훅 대사 편도 판정) — 확장 완료(2026-08-31)**: Migration 388로 `pt_status='done'`
   + 웹훅 취소류 상태(`CANCELED`/`PARTIAL_CANCELED`/`ABORTED`/`EXPIRED`) 조합도
   `STATUS_MISMATCH_WARN`으로 분리. TDD 2케이스(신규 불일치 탐지 + 기존 정상 케이스
   무회귀) GREEN.
4. ✅ **`.claude/rules-ref/payment.md` 문서 갱신 — 완료(2026-08-31)**: v4.0으로 전면
   재작성(실제 아키텍처·삭제된 레거시 경로·양쪽 가맹점 키 분리 원칙 반영).
5. ✅ **신규 발견·수정(2026-08-31, Stephen 실사용 중 제보)**: `/subscribe/[planId]`
   구독 카드등록 버튼이 "method 파라미터에 사용할 수 없는 enum 값입니다" 에러로 완전히
   막혀 있었음 — v2 SDK 객체형 `requestBillingAuth({method:...})`는 영문 대문자 enum
   `'CARD'`가 필요한데 v1 SDK의 위치인자 관례(한글 `'카드'`)를 그대로 썼던 것이 원인.
   Toss 공식 enum-codes 문서로 확인 후 `'CARD'`로 수정.
6. ✅ **Production(vnbpmvxruyciuuaermyh) 마이그레이션 8건 적용 완료(2026-08-31)**:
   378/379/380/383/384/387/388/395 전부 적용 후 함수 시그니처·신규 컬럼·pg_cron job을
   직접 재조회해 Stage와 일치함을 확인. 적용 중 발견한 기존 결함(이번 세션 발생 아님):
   `create_reservation_order`가 Production에 2-param·4-param 오버로드가 둘 다 남아있던
   상태(Migration 340의 마지막 DROP 구문이 Production엔 반영 안 됐던 것으로 추정) —
   395 적용 시 둘 다 명시적으로 DROP해 Stage와 동일한 단일 시그니처로 수렴. 단, 이
   RPC들을 소비하는 앱 코드는 아직 git commit 전이라 실제 배포되지 않은 상태 —
   Production DB는 새 컬럼/함수를 갖췄지만 커밋·배포 전까지는 실트래픽에 영향 없음.
7. 구독 빌링(`bill_crazyhevr`) 실브라우저 E2E는 이번 세션에서도 미실시(위 5번 수정 후
   Stephen이 직접 재시도 예정).
8. git commit 대기(Stephen 직접 실행).

## 6. 2026-08-31 후속 — Stephen 재지적: F1 수정이 드러낸 더 깊은 구조 공백 2건 (수정 완료)

F1(payment_status 소스 교체) 자체는 옳았으나, Stephen이 "장바구니 정책 로직이 혼돈되서
발생한 건"이라며 상위 계층(주문 합산·전자계약 단위)을 재검증하라고 지적 — 재조사 결과
실제로 2건의 구조적 공백을 확인·수정했다.

**공백 A — 배송비가 실결제 금액에서 누락**: 장바구니 화면(`otTotal`)은 "대여료+배송비-
쿠폰-포인트"를 고객에게 총액으로 보여주지만, `create_reservation_order`가 계산하는
`orders.final_amount`에는 배송비 항목 자체가 없었고, 계약서명 결제 화면의 실제 Toss
청구금액(`payTotal`)에도 반영되지 않았다. Stage DB 실측(유일한 실결제 건, reservation
4688)으로 `payment_transactions.delivery_fee=NULL`을 직접 확인해 재현.
✅ 수정(Migration 395): `orders.delivery_fee` 컬럼 신설, `create_reservation_order`가
`p_delivery_fee` 파라미터(장바구니가 이미 계산한 값 그대로, 배송비 로직 자체는 SQL로
재구현하지 않음)를 받아 `final_amount = 대여료합계 - 등급할인 + 배송비`로 계산. 배송비
계산 로직(등급별 우대할인 등, Migration 374/375/381/382/385)은 그대로 재사용 — 값만
주문에 합산.

**공백 B — 계약서가 '예약(=주문)' 단위가 아니라 개별 상품(rental_reservations 행) 단위로
생성될 수 있었음**: Stephen 지적 — "'예약' 단위는 상품이 몇 개 담기든 하나의 예약신청
실행으로 예약코드가 발행된 상태를 가리키는 것, '예약'과 '주문'은 동일어, 형제 예약단위는
있으면 안 됨". 코드 확인 결과 `init-contract` API가 `reservation_id` 하나만 보고 계약을
생성해, 관리자가 같은 주문의 다른 상품(형제 예약 행)에 대해 각각 "계약서 발송"을 누르면
계약서·서명링크·결제 트리거가 여러 개로 쪼개질 수 있는 구조였다(그 payment 트리거 각각이
같은 주문의 전체 합산 금액을 청구 대상으로 계산 — `contracts.reservation_id` NOT NULL
단일 FK 스키마 + `RentalContractViewer.svelte`가 예약 1건 단위로 마운트되는 구조가 원인).
✅ 수정: `init-contract`가 이 예약이 속한 주문(order_items 경유)에 이미 다른 예약(형제
상품) 쪽에서 발행된 계약이 있으면 새로 만들지 않고 재사용하도록 변경 — "1주문 = 계약서
정확히 1건" 보장.

검증: 신규 TDD 6케이스(create_reservation_order 배송비 3종 + init-contract 주문단위
재사용 3종) 전부 GREEN, 기존 스위트(tossPaymentGroupRpc/paymentContractOrderRedesign/
reservationApprovalNotify/contractAuthGates/contractCanvasPublishFix/payment/
contractDataLineItems, 총 133개) 무회귀. Stage 적용 완료. `npm run check` 신규 에러
0건(계약 배송비 표시 추가 중 `ContractSubstitutionData` 타입에 `배송비` 필드 누락으로
발생한 타입에러 1건 즉시 수정).

신규 마이그레이션: `20260831020000_395_orders_delivery_fee.sql`
수정 파일: `src/routes/api/cms/reservations/[id]/init-contract/+server.ts`,
`src/routes/api/reservations/create-order/+server.ts`, `src/routes/cart/+page.svelte`,
`src/routes/contract/[token]/+page.server.ts`, `src/routes/contract/[token]/+page.svelte`,
`src/routes/account/rental/[id]/contract/+page.server.ts`,
`src/routes/account/rental/[id]/contract/+page.svelte`,
`src/routes/api/cms/reservations/[id]/contract-data/+server.ts`,
`src/lib/types/contract-module.ts`
신규 테스트: `src/__tests__/services/contractOrderLevelDedup.test.ts`
(`src/__tests__/services/tossPaymentGroupRpc.test.ts`, `src/__tests__/server/
contractAuthGates.test.ts`에 케이스 추가)

---

## 5. 참고 파일 인덱스

**이번 세션에서 직접 대조한 파일**:
```
src/routes/payment/success/+page.server.ts        (F2 — 크래시 확정 코드)
src/routes/payment/fail/+page.server.ts            (F2 — 고아)
src/routes/payment/success/dev/+page.ts            (라이브 — 장바구니 신청완료 표시 화면, 오해 주의)
src/routes/api/payment/confirm/+server.ts          (F2 — 고아)
src/routes/api/checkout/initiate/+server.ts        (F2 — 고아)
src/routes/api/reservations/cancel-hold/+server.ts (라이브 — cancel_payment_and_release_hold 의도적 회피 확인)
src/routes/contract/[token]/pay-result/+page.server.ts (라이브 결제 확정 경로, 이중결제 가드 확인)
src/routes/api/webhooks/toss/+server.ts            (라이브)
src/routes/api/cms/reservations/[id]/payment/+server.ts (라이브 환불 엔드포인트, GET/PUT 둘 다 확인)
src/routes/subscribe/success/+page.server.ts       (라이브)
src/routes/api/cron/subscription-billing/+server.ts (라이브)
src/lib/server/subscriptions/chargeSubscription.ts (공유 청구 진입점)
src/lib/components/cms/RentalDetailPanel.svelte    (F1 — 1339~1340행 + 1422행 모순 확인)
src/routes/account/rental/[id]/contract/+page.server.ts (F4 — 중복 로직)
supabase/migrations/20260829050000_378_confirm_order_payment_rpc.sql
supabase/migrations/20260829060000_379_cancel_reservation_payment_rpc.sql
supabase/migrations/20260829070000_380_toss_webhook_reconcile_cron.sql
supabase/migrations/20260830000000_383_toss_webhook_reconcile_payload_fix.sql
supabase/migrations/20260830010000_384_payment_transactions_cancel_audit.sql
supabase/migrations/20260815000259_259_subscription_billing_claim.sql
supabase/migrations/20260828040000_369_get_rental_list_dedupe_contract_signings.sql (payment_status 소스 확인)
```

**Stage DB(ezyvffjvuwmtuhpxdjrw) 실쿼리 근거**: `orders` status 분포, `rental_reservations`
컬럼 목록(`information_schema.columns`), `orders ⋈ order_items ⋈ payment_transactions`
교차조회, `raw_webhook_logs` process_result 분포 및 payload 샘플 20건.
