# PG 결제 연동 화면 전역 감사 — 종합 리포트

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서가 지목한 결제 재설계 회귀(Migration 387·388·396·
> 397·398·399 관련)는 CMS 전역 정밀 검증 v5에서 소비 앱코드 실배선까지 재확인됐다 — 최신
> 판정은 `cms_global_verification_v5_synthesis_2026-08-31.md` 참고. 이 문서는 원본 그대로
> 보존한다.
# 작성일: 2026-08-31 | 대상: /cms/reservation, /account/rental/[id]/contract, /account
# 방법: 4개 병렬 조사 에이전트(CMS·고객계약서·마이페이지·실데이터 교차검증) + 직접 검증/TDD 수정

---

## 0. 배경

같은 날 세션에서 이미 F1(결제상태 orders.status 버그)·F2(고아 코드)·F3(웹훅 대사 보완)·
배송비 실결제 반영·계약서 "예약(=주문) 단위 통일"(init-contract API 수정)을 처리했다.
Stephen이 "이번 세션 수정항목은 물론, PG 결제 연동되는 대여관리(/cms/reservation)와
사용자 정보(/account/rental/[id]/contract, /account) 화면 전역"을 완벽 리뷰·테스트·
검수하라고 지시 — 이 문서는 그 결과다.

**중요한 발견**: 4개 조사 에이전트가 서로 다른 화면에서 **독립적으로 같은 근본원인**에
도달했다 — 이번 세션 앞부분에서 계약서를 "예약 단위"에서 "주문 단위"로 통일한 수정
(init-contract API, service-operations.md §4)이, 그 전제를 미처 따라가지 못한 다른
코드 지점들을 전부 깨뜨렸다. 즉 **이번 감사 자체가 같은 세션 안에서 내가 만든 회귀를
같은 세션 안에서 잡아낸 사례**다.

---

## 1. 🔴 CRITICAL — 계약서 주문단위 통일이 만든 연쇄 회귀 (전부 수정 완료)

### 1-1. 결제확정 게이팅이 형제 예약을 영원히 hold에 가둠 (가장 심각)

**증상**: `try_confirm_reservation`(Migration 284)의 서명완료 판정이
`WHERE c.reservation_id = p_reservation_id`로 "그 예약 자신이 직접 소유한 계약"만
확인한다. init-contract가 계약을 대표 예약 1건에만 anchor하도록 바뀐 뒤로는, 형제
예약(같은 주문의 다른 상품)은 결제+서명이 전부 끝나도 이 조건을 절대 만족할 수 없어
**영원히 `hold` 상태에 갇히고, 30분 HOLD 자동만료 크론에 의해 결제까지 끝난 예약이
만료 처리될 수 있는** 결제 무결성 CRITICAL 버그.

추가로 `/api/contracts/[token]/sign`·`/api/contracts/[token]/pay-mock`도 계약의
대표 예약 하나에만 결제확정 재시도를 호출해, 형제 예약은 애초에 재시도 대상에도
포함되지 않았다.

**수정(Migration 397 + 398, TDD 20케이스)**:
- `try_confirm_reservation`의 서명 확인을 "직접 소유 OR 같은 주문(order_items 경유)
  형제 예약이 소유한 계약"으로 확장.
- 신규 RPC `try_confirm_reservation_order`(순수 재확인, 결제 부수효과 없음) —
  `/api/contracts/[token]/sign`이 사용.
- 신규 RPC `mark_reservation_payment_confirmed_order`(결제확인 기록 + 재확인, 주문
  전체 순회) — `/api/contracts/[token]/pay-mock`이 사용.

**⚠️ 수정 중 자체 발견한 2차 결함(같은 세션에서 즉시 재수정)**: 최초 구현에서
`try_confirm_reservation_order`가 형제 예약을 순회하며 `mark_reservation_payment_
confirmed`(결제를 **무조건 기록해버리는** 부수효과 있는 함수)를 호출하도록 잘못
설계해, "결제 없이 서명만 해도 confirmed로 전환되는" 훨씬 더 위험한 결함을 만들 뻔했다
— TDD 테스트(EC-1, 결제 전 서명만 완료 시나리오)가 즉시 재현해 발견, Migration 398로
"순수 재확인"과 "결제 기록"용 RPC를 완전히 분리해 해소했다.

### 1-2. 형제 예약의 서명완료 계약서를 마이페이지에서 열람할 방법이 없음

**증상**: `src/lib/server/account/loadRentalContractStatus.ts`(/account, /account/rental
공유 헬퍼)와 `src/routes/account/rental/[id]/contract/+page.server.ts`가 둘 다
`contracts.reservation_id`를 그 예약 자신의 ID로만 조회한다. 실제로는 이미 확정
(`confirm_order_payment_and_update_reservations`가 형제 전체를 confirmed 처리)됐어도,
계약을 직접 소유하지 않은 형제 예약 카드는 "전자계약 확인" 버튼 자체가 뜨지 않고, URL을
직접 열어도(`/account/rental/{형제id}/contract`) "계약 없음" 안내만 표시된다 — 고객이
이미 서명한 계약서를 다시 볼 방법이 없는 CRITICAL UX 결함.

**수정(TDD 6케이스)**:
- `loadRentalContractStatus.ts` — order_items 경유로 입력 예약들의 주문을 찾고, 그
  주문의 형제 예약 전체를 함께 조회해 계약 상태를 판정하도록 재작성(N+1 방지 위해 벌크
  쿼리 유지).
- `account/rental/[id]/contract/+page.server.ts` — 계약 조회를 `.eq(...)`에서
  `.in(...)`(같은 주문의 예약 전체)로 확장. 기존에 중복 실행되던 order_items 조회 1건도
  함께 제거(쿼리 재사용으로 최적화).

### 1-3. CMS "계약서" 탭이 형제 예약을 "계약서 미생성"으로 오판

**증상**: `get_rental_list`(Migration 387·369)의 contracts/contract_signings LATERAL
조인도 동일하게 `c2.reservation_id = rr.id`만 봐서, 형제 예약 행은 CMS에서
`contract_id=NULL`로 나와 `RentalContractViewer.svelte`가 "계약서 미생성" 배너를
잘못 띄운다 — 관리자가 승인 준비 상태를 오판할 수 있음.

**수정(Migration 399, TDD 3케이스)**: contracts LATERAL 조인에 동일한 주문단위 폴백
추가. 부수적으로 `delivery_fee` 서브쿼리도 `ORDER BY` 없이 비결정적이던 것 + 형제 매칭
누락을 `payment_status`와 동일 패턴으로 통일.

### 1-4. CMS "결제정보" 탭이 형제 예약을 "결제 정보 없음"으로 오판 + 환불 버튼 비활성

**증상**: `GET/PUT /api/cms/reservations/[id]/payment`가 `payment_transactions`를
`reservation_id` 직접매칭만으로 조회한다. 실제 결제 행은 대표 예약에만 있으므로, 형제
예약의 "결제정보" 탭은 항상 "결제 정보가 없습니다"로 뜨고, 환불 처리 버튼도
`paymentDetail?.status==='done'` 게이트에 걸려 영구히 비활성화된다 — 관리자가 형제
예약 화면에서는 환불을 시도조차 할 수 없음(`cancel_reservation_payment` RPC 자체는
1a/1b 폴백이 이미 있어 실제로는 정상 동작했을 것이라 자금 손실 위험은 아니지만, 그
경로에 도달할 방법이 UI에 없었음).

**수정(TDD 3케이스)**: `findOrderPaymentTransaction` 공유 헬퍼 신설 — 직접매칭 실패
시 order_items 경유 형제 매칭(`cancel_reservation_payment`의 1a/1b와 동일 패턴).
GET과 PUT 둘 다 이 헬퍼로 통일.

---

## 2. 🟡 MEDIUM — 수정 완료

**결제상태 영문 원문 노출**: Migration 387 이후 `row.payment_status`가
`payment_transactions.status`의 영문 코드(`done`/`cancelled`/`partial_cancelled`/
`failed`)를 그대로 노출하고 있었다(다른 모든 라벨은 `PAYMENT_METHOD_LABELS`처럼 한글
매핑을 거치는데 이것만 누락). `PAYMENT_STATUS_LABELS` 맵 추가로 해소.

---

## 3. 🟢 MEDIUM/LOW — 확인만 하고 이번엔 수정하지 않음(Stephen 판단 필요)

1. **"기본 이용요금" 라벨 의미 불일치**: `row.order_amount`(=`orders.final_amount`)가
   이제 배송비를 포함하는데(Migration 395), CMS 라벨은 여전히 "기본 이용요금"이라
   할인·배송비 반영 여부가 헷갈릴 수 있음. 라벨 문구 변경은 디자인/문구 결정이라 보류.
2. **"주문번호" 필드가 로딩 시점에 따라 다른 형식으로 바뀜**: `paymentDetail` 로드 전엔
   `row.order_key`(`ORD-YYYYMMDD-NNNNN`), 로드 후엔 `payment_transactions.order_id`
   (Toss용 `CSHOT-...` 문자열)로 바뀐다 — 이번 세션 변경과 무관한 기존 설계.
3. **`src/lib/services/supabase.ts`의 죽은 `rpc` 객체 4종**
   (`atomicReserveAsset`/`batchAtomicReserve`/`calculateCartTotal`/
   `processPaymentAndCreateOrder`) — 전부 실사용처 0건(전수 grep 확인), v5.46 스키마
   시절 스캐폴딩으로 추정. 이 파일은 core-rules.md가 "Frozen 파일"로 지정해 변경 시
   CRITICAL 게이트가 필요해 이번엔 건드리지 않음. 참고로 `process_payment_and_create_
   order`라는 이름의 RPC 자체는 DB에 여전히 존재하는 것으로 추정됨(PGRST202 에러의
   "did you mean" 힌트로 확인) — 별도 조사 필요.
4. **`loadRentalContractStatus.ts`가 `contract_signings.expires_at`을 조회하지 않음**:
   만료된 서명링크도 `pendingToken`으로 노출될 수 있음(TASK.md에 이미 기록된 기존
   LOW 항목, 이번 수정과 무관하게 미해결 상태 유지).
5. **HOLD 30분 자동만료 예약이 마이페이지 어디에도 안 보임**: `/account`·
   `/account/rental`의 상태 필터가 `expired`를 포함하지 않아, 자동만료된 예약은 "대여"
   목록에도 "취소" 목록에도 안 뜬다 — 고객이 자기 체크아웃이 왜 사라졌는지 알 방법이
   없음(기존 설계 공백, service-operations.md §10과 화면 노출 사이의 갭).

---

## 4. ✅ 확인 완료 — 문제없음 (감사에서 검증만 하고 종결)

- `approveReservation`/`updateStatus` form action은 결제 상태와 무관하게 정상 동작
  (service-operations.md §9 관리자 우회 원칙 그대로 유지).
- `get_dashboard_today_stats`(매출 KPI)는 `payment_transactions.status='done'` 직접
  필터라 이번 스키마 변경들의 영향 없음.
- `order-siblings`/`rental-siblings`/`contract-data` 엔드포인트, `/cms/reservation`·
  `/cms/rentals`·`/cms/mobile/rentals` 타입 정의 전부 최신 RPC 반환 shape과 일치.
- `isCouponEligible` 자격조건 검증은 배송비 제외 순수 대여료 기준으로 정상 동작.
- `pay-result` 이중결제 방지 가드·§9 재검증 정상.
- PC(`PcRentalPanel.svelte`)·모바일(`account/rental/+page.svelte`) 로직이 완전히
  동일 — 한쪽만 고친 정황 없음. 채팅 FAB "transform+position:fixed" 재발 없음.
- `/account`는 구독(subscription) 정보를 표시하지 않아 구독 카드등록 버그와 무관.
- Stage DB 실측(reservation 2654, 4688 포함): `orders.delivery_fee` 계산 불일치 0건,
  형제 계약 중복 생성 이력 0건, `payment_transactions.delivery_fee`는 여전히 항상
  NULL(confirm_order_payment_and_update_reservations가 이 컬럼을 안 채움 — 별개의
  기존 갭, `orders.delivery_fee`와 혼동 주의).

---

## 5. 검증 요약

**신규/확장 마이그레이션**: 397(`try_confirm_reservation` 주문단위 확장), 398(부수효과
분리 — 397의 2차 결함 긴급수정), 399(`get_rental_list` 계약조회 주문단위 확장). 전부
Stage → Production 순서로 적용, 적용 후 함수 정의 재조회로 양쪽 일치 확인.

**신규 테스트 파일**: `loadRentalContractStatus.test.ts`(5), `accountRentalContractPage.
test.ts`(1), `cmsReservationPaymentSiblingFallback.test.ts`(3). 기존 파일 확장:
`paymentContractOrderRedesign.test.ts`(+4, 형제 예약 결제확정 게이팅), `tossPaymentGroupRpc.
test.ts`(+3, get_rental_list 계약조회).

**전체 회귀**: 관련 스위트 13개 파일, 178 passed + 7 skipped(무관 skip), 0 failed.
`npm run check` 신규 에러 0건(기존 vite.config.ts 1건만 유지).

**수정 파일 전체 목록**:
```
supabase/migrations/20260831040000_397_try_confirm_reservation_order_wide.sql
supabase/migrations/20260831050000_398_fix_try_confirm_reservation_order_no_payment_side_effect.sql
supabase/migrations/20260831060000_399_get_rental_list_contract_order_wide.sql
src/routes/api/contracts/[token]/sign/+server.ts
src/routes/api/contracts/[token]/pay-mock/+server.ts
src/lib/server/account/loadRentalContractStatus.ts
src/routes/account/rental/[id]/contract/+page.server.ts
src/routes/api/cms/reservations/[id]/payment/+server.ts
src/lib/components/cms/RentalDetailPanel.svelte (PAYMENT_STATUS_LABELS 추가)
src/__tests__/services/paymentContractOrderRedesign.test.ts
src/__tests__/services/tossPaymentGroupRpc.test.ts
src/__tests__/services/loadRentalContractStatus.test.ts (신규)
src/__tests__/services/accountRentalContractPage.test.ts (신규)
src/__tests__/services/cmsReservationPaymentSiblingFallback.test.ts (신규)
```

---

## 6. 남은 것

1. git commit 대기(Stephen 직접 실행) — 이번 CRITICAL 수정들은 DB에는 이미 반영됐지만
   앱 코드가 커밋·배포되기 전까지는 sign/pay-mock 엔드포인트가 여전히 구 RPC를 호출한다.
   **DB 마이그레이션(397/398/399)은 이미 Production에 적용됐고 새 RPC와 구 RPC가 당분간
   공존하므로 즉시 서비스 장애로 이어지지는 않지만, 형제 예약 CRITICAL 버그 자체는
   이 앱 코드가 배포돼야 실제로 해소된다** — 우선순위 높게 커밋·배포 권장.
2. `process_payment_and_create_order`(죽은 wrapper가 참조하는 RPC) 실존 여부·용도
   별도 확인 필요.
3. §3의 MEDIUM/LOW 5개 항목은 문구·설계 판단이 필요해 보류 — Stephen 확인 후 진행.
