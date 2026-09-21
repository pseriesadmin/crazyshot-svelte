# rental-fee-policy.md — 대여요금 산정 정책 (장바구니 · CMS)
# Harness Flow v3.2 | 2026-09-04 신설 — Stephen 지시로 4가지 수령→반납 조합별 금액 검증
# 세션(Migration #440~445) 산출물을 정책 문서로 정리

---

## ⛔ 이 문서는 실제 코드를 그대로 반영한다

대여요금은 **클라이언트(장바구니 미리보기)와 서버(실제 결제금액 정본) 두 곳에서 동일한
산식을 각각 구현**한다 — 하나를 고치면 반드시 다른 하나도 함께 고쳐야 한다(2026-09-04
실제로 이 동기화가 깨져있던 CRITICAL 결함이 발견·수정된 이력 있음, 하단 "동기화 원칙" 참고).

```
클라이언트(미리보기) : src/lib/utils/cartRentalFee.ts (calcRentalMinutes/calcRentalFee/
                        computeCartTotalMinutes) + src/routes/cart/+page.svelte
                        (itemRentalFee/itemOptionsAmount/otTotalMinutes)
서버(결제금액 정본)   : compute_reservation_line_amount RPC
                        (calculate_cart_total·create_reservation_order가 위임 호출,
                        실제 결제(pay-mock)·Toss 웹훅 정산은 이 시점에 이미 확정된
                        값을 조회만 함 — 별도 재계산 경로 없음)
```

---

## 1. 수령→반납 방식 조합별 청구 조건 (Stephen 확정, 2026-09-04)

| # | 수령(pickup) | 반납(return) | 청구 방식 | 상태 |
|---|---|---|---|---|
| ① | 배송 | 배송 | **1day(N일) 강제청구** — 시각 무시, 수령일+반납일 모두 포함 일수 × 24h요율 | ✅ 구현·검증 완료 |
| ② | 배송 | 배송 아님(방문·퀵·무인함·택배) | **1day(N일) 강제청구** — ①과 완전히 동일 | ✅ 구현·검증 완료 |
| ③ | 배송 아님 | 배송 | **선택 자체가 불가능** — UI(반납 콤보 노출 제외) + 서버(RAISE EXCEPTION) 이중 차단 | ✅ 구현·검증 완료 |
| ④ | 배송 아님 | 배송 아님 | **12시간 블록 올림 산식** — 12h 미달 시 12h요율만, 12h 초과 시 24h요율(+잔여 12h요율 가산) | ✅ 구현·검증 완료 |

> **핵심**: 1day 강제청구(①·②) 여부는 **수령(pickup) 방식 단 하나만으로 판정**한다 — 반납
> 방식이 무엇이든 무관하다. ③이 이미 "수령 아님+배송" 조합을 원천 차단하므로, 실제로
> 도달 가능한 조합은 ①·②·④ 셋뿐이다.

---

## 2. "배송" 판정 — 두 개의 완전히 분리된 플래그 (혼동 주의)

`rental_method_options` 테이블에 방식(수령/반납 옵션)마다 붙는 boolean 플래그 2개가 있는데,
**이름이 비슷해 보여도 서로 완전히 다른 목적**이며 각자 독립적으로 켜고 끌 수 있다
(2026-09-04 Migration #444로 상호배타 제약 제거 — 동시에 켜는 것도 가능, 동시에 꺼두는
것도 가능).

| 플래그 | CMS 표시 이름 | 담당 기능 | 판정 기준 |
|---|---|---|---|
| `is_bulk_delivery` | 대여옵션(수령/반납) **일괄적용** | "요청 A" — 수령을 이 방식으로 고르면 **반납도 자동으로 같은 방식으로 강제고정** + 시간선택 UI 숨김(00:00/24:00로 고정 표시) | `isDeliveryLocked(m)` |
| `is_delivery_type` | **배송 반납 허용 지정** | ① 반납 콤보에서 이 방식을 노출/제외할지(수령이 배송 아닐 때만 제외) ② **대여요금 1day 강제청구 여부**(위 표 ①·②) | `isDeliveryTypeMethod(m)` (클라이언트) / `rmo.is_delivery_type = true`(서버) |

```
⛔ 과거(2026-09-04 이전) 결함 — 절대 재발시키지 말 것:
   1day 강제청구 판정을 is_bulk_delivery 하나로만 했던 적이 있다. 그 결과 "요청 A"(반납
   강제고정)를 켜야만 1day 청구가 됐는데, 그러면 반납이 무조건 배송으로 고정돼버려 조건②
   (배송+배송아님) 자체가 UI에서 선택 불가능해지는 구조적 충돌이 있었다. 지금은 완전히
   분리돼 있으니 — 앞으로 이 영역 코드를 수정할 때 절대로 이 둘을 다시 하나로 합치지 말 것.
```

### CMS 설정 위치

```
/cms/set/rental → "대여 제한옵션" 카드
  ├─ 대여옵션(수령/반납) 일괄적용   → is_bulk_delivery per-방식 토글 (?/toggleBulkDelivery)
  ├─ 휴무일 제한 방식               → is_courier_dependent (이 문서와 무관, 별개 기능)
  └─ 배송 반납 허용 지정            → is_delivery_type per-방식 토글 (?/toggleDeliveryType)
                                      ⛔ 별도 마스터 on/off 스위치 없음 — ON 지정한 방식이
                                      있다는 사실 자체가 곧 활성화 조건(2026-09-04, 기존
                                      "대여옵션 제한" 전역 토글은 UX 혼란으로 완전 삭제됨,
                                      Migration #443)
```

**실제로 "배송"인 방식은 보통 하나뿐**(예: 크레이지샷배송/크레이지배송)이므로, 정상 운영
시 그 방식 하나에 `is_delivery_type=true`만 지정하면 된다. `is_bulk_delivery`(요청 A)를
같은 방식에 함께 켤지는 **별개의 운영 판단**이다 — 켜면 그 방식을 수령으로 고른 고객은
반납도 자동으로 배송 고정(조건①만 발생, 조건②는 그 방식에 한해 불가능해짐), 꺼두면
고객이 반납을 자유롭게 골라 조건①·② 둘 다 자연스럽게 발생할 수 있다.

---

## 3. 12시간 블록 올림 산식 (조건④, 그리고 조건①·②의 "N일" 계산 공통 기반)

```
BLOCK_MINUTES = 720 (12시간)

deliveryLocked = false(조건④, 수령이 배송 아님)인 경우:
  총분 = (반납일-수령일)×1440 + 반납시각(분) - 수령시각(분)
  블록수 = ceil(총분 / 720)
  일수 = floor(블록수 / 2)
  반나절가산 = (블록수 % 2 == 1)
  요금 = 일수 × 24h요율 + (반나절가산 ? 12h요율 : 0)

  예) 9시간   → 1블록 → 0일 + 반나절   → 12h요율만
      20시간  → 2블록 → 1일           → 24h요율만
      25시간  → 3블록 → 1일 + 반나절   → 24h요율 + 12h요율 (24시간을 1시간만 넘어도 즉시 가산)
      36시간  → 3블록 → 1일 + 반나절   → 경계값도 동일

deliveryLocked = true(조건①·②, 수령이 배송)인 경우 — 시각을 완전히 무시:
  일수 = GREATEST(반납일-수령일, 0) + 1   (수령일·반납일 두 날짜 모두 온전한 하루로 청구)
  요금 = 일수 × 24h요율                   (반나절 가산 없음 — 항상 짝수 블록으로 딱 떨어짐)

  예) 수령 9일 · 반납 10일(날짜차 1) → 2일 × 24h요율
```

**옵션상품**도 본상품과 **동일한 일수/반나절 가산 여부**를 그대로 적용하되, 옵션 자체의
12h/24h 요율(`price_rules`, `option_product_id` 기준)을 독립적으로 조회해 곱한다. 옵션에
12h 요율 자체가 없으면 블록 가산 없이 `unit_price × qty`로 flat 폴백한다.

**판매전용(sale_only) 상품**은 이 산식 자체가 적용되지 않는다 — 대여기간 개념이 없으므로
`sale_price`를 그대로 청구(옵션도 flat), 보증금 없음.

---

## 4. 구현 파일 참조

```
클라이언트 순수함수 : src/lib/utils/cartRentalFee.ts
  calcRentalMinutes(startDate, endDate, pickupTime, returnTime, deliveryLocked?)
  calcRentalFee(input: RentalFeeInput)              — 12h 블록 올림 → 금액
  calcRentalPeriodParts(totalMinutes)                — "총 대여기간" 표시 라벨(12시간/N일/N일 12시간)
  computeCartTotalMinutes(hasQualifyingItem, ...)    — 장바구니 전체 "총 대여기간" 1회 계산
                                                        (상품 개수를 받지 않는 시그니처로
                                                        배수 합산을 구조적으로 차단, 2026-09-04)

클라이언트 판정함수 : src/routes/cart/+page.svelte
  isDeliveryLocked(m)      — is_bulk_delivery 기준, "요청 A" 전용(반납강제고정·시간선택숨김)
                              — 요금(대여요금·배송비) 계산에는 더 이상 관여하지 않음
  isDeliveryTypeMethod(m)  — is_delivery_type 기준, 요금계산 전용(itemRentalFee/
                              itemOptionsAmount/otTotalMinutes + checkedShippingItems의
                              pickupIsDelivery/returnIsDelivery, 2026-09-06부터 총 4곳에서
                              사용 — is_bulk_delivery 기준일 때 배송비가 0원으로 잘못
                              계산되던 CRITICAL 결함을 이 플래그로 통일해 해소)
  computeReturnVisibleTabs — 반납 콤보 노출 제외(is_delivery_type 기준, $lib/utils/
                              cartShippingFee.ts) — 요금과는 별개 함수, 조건③ 차단 담당

서버 정본 RPC        : compute_reservation_line_amount(p_reservation_id)
  → calculate_cart_total, create_reservation_order가 위임 호출(자체 판정 로직 없음)
서버 반납선택 차단   : set_reservation_shipment_method(7-param) — 조건③ 서버 최종방어선

CMS 판정설정 화면    : src/routes/cms/set/rental/+page.svelte, +page.server.ts
  ?/toggleBulkDelivery    → toggle_rental_method_bulk_delivery RPC
  ?/toggleDeliveryType    → toggle_rental_method_delivery_type RPC
  (2026-09-04 Migration #444로 두 RPC의 상호배타 가드 제거 — 동시 지정 허용)
```

### 관련 마이그레이션 (전부 Stage+Production 적용 완료, 2026-09-04)

| # | 내용 |
|---|---|
| #440 | `rental_method_options.is_delivery_type` 컬럼 신설 |
| #441 | `toggle_rental_method_delivery_type` 신규 RPC + 상호배타 가드(이후 #444로 제거됨) |
| #443 | 반납콤보 제외 판정을 `is_delivery_type` 단독 기준으로 단순화 + 전역 마스터 토글(`restrict_return_delivery`) 완전 삭제 + 서버 `set_reservation_shipment_method` 동기화 |
| #444 | `is_bulk_delivery`/`is_delivery_type` 상호배타 가드 제거(동시 지정 허용) |
| #445 | `compute_reservation_line_amount`(실제 결제금액)의 1day 강제청구 판정을 `is_bulk_delivery`→`is_delivery_type`로 교체 |

---

## 5. 휴무일 포함 배송 연장 요금 (2026-09-12 설계, 2026-09-15 병합·재통합)

```
대상: is_courier_dependent=true(§2의 is_delivery_type/is_bulk_delivery와는 완전히 별개
      플래그 — "휴무일 제한 방식" 용도로만 쓰이던 기존 플래그를 그대로 재사용)인 방식으로
      수령/반납을 선택했을 때, 택배기사가 실제로 반출/회수하는 기준일(수령일 전날 / 반납일
      다음날)이 휴무일이면 예약 자체를 막는 대신 그 날을 자동으로 건너뛰어 수령/반납일을
      연장한다.
```

⚠️ **병합 경위(2026-09-15)**: 이 기능은 2026-09-12 별도 세션이 설계·구현했으나 화면 코드가
격리된 git worktree에만 존재하고 stage 브랜치에 병합되지 않은 채, DB 마이그레이션만 Stage에
적용된 "반쪽 배포" 상태로 8일간 방치돼 있었다(2026-09-15 CMS 휴무일 옵션 정밀검증 중 발견 —
그 사이 실사용 경로에서 반납일이 조용히 밀리는 부작용이 이미 발생 중이었음). 2026-09-15
세션이 worktree 코드를 stage 최신본 위에 수동 재통합해 병합 완료.

### 연장 판정 기준일 (양쪽 leg 통일)

```
수령(pickup) leg : 수령일 전날부터 역방향으로 휴무일을 건너뛴다
반납(return) leg : 반납일 "다음날"부터 순방향으로 휴무일을 건너뛴다
  ⛔ 과거(이 기능 이전)에는 반납측 판정 기준이 "반납일 당일"이었다(캘린더 차단 로직 기준)
  — Stephen 확정으로 다음날(+1) 기준으로 통일됨. 기존 캘린더 차단 코드도 함께 교체
  (cart/+page.svelte isDateDisabled/onDisabledClick)했으므로 신규/기존 구분 없이 전부
  다음날(+1) 기준 하나만 존재한다.

연속 휴무일(연휴 등): 첫 영업일이 나올 때까지 전부 건너뛴다(안전판: 최대 14회 반복 후
  강제 중단).
```

### 요금 공식 — 한쪽/양쪽 구분 없이 단일 규칙 (2026-09-19 Stephen 재확정 — 아래 §5-2 참고)

```
⛔⛔⛔ 이 절의 "N 중 하루 무료" 규칙은 2026-09-19 Stephen이 "심각한 변경정책 미적용
오류"로 지적하며 완전히 폐기했다(Migration #509). 아래는 폐기된 과거 버전(2026-09-04
3차 최종 확정) 기록만 남긴 것 — 현재 유효한 공식은 §5-2를 볼 것.

N = pickup_holiday_extra_days + return_holiday_extra_days (수령측+반납측 연장일수 합산)

holiday_extra_fee = GREATEST(N - 1, 0) × daily요율 × 0.5   ← ⛔ 폐기됨, 되돌리지 말 것

즉: 연장일수 전체(N, 한쪽이든 양쪽이든 구분 없음) 중 딱 하루만 무료, 나머지(N-1)일은
각각 하루요금의 50%씩 부과. N=0(연장 없음)→0 / N=1→0(그 하루는 무료로 끝) / N=3→2일×daily×0.5

한쪽/양쪽을 구분하는 분기 코드를 추가하면 안 된다는 원칙만은 §5-2에서도 그대로 유지된다.
```

### 이중할인 방지 — delivery_fee와 완전히 동일한 패턴

```
holiday_extra_fee는 rental_fee(쿠폰·회원등급 % 할인 대상)에서 분리된 별도 값으로 계산되어,
할인 계산 기준(v_total)에는 절대 포함되지 않고 v_final 계산 맨 끝(할인·포인트 차감 이후)에
delivery_fee와 나란히 가산된다 — "이미 확정된 고정금액"이라 할인이 중복 적용되지 않는다.
```

### 재고 이중배정 방지 — create_hold_reservation 시점에 이미 확장된 날짜로 배정

```
create_hold_reservation/promote_draft_reservation에 p_pickup_method/p_return_method
(DEFAULT NULL) 파라미터를 추가해, 방식이 NOT NULL로 전달되면 재고 가용성 체크 이전에
먼저 compute_holiday_extended_period로 연장일을 계산하고 이미 확장된 날짜 범위로 재고를
잠근다(FOR UPDATE SKIP LOCKED 대상 자체가 연장 반영 후 범위). NULL이면 완전히 기존 동작
그대로(하위호환) — set_reservation_shipment_method는 start_date/end_date를 건드리지
않으므로 이후 방식이 확정되는 별도 호출과 충돌하지 않는다.
```

### ⚠️ 최종금액 합산 지점 — create_reservation_order가 아니라 sync_order_after_composition_change

```
2026-09-12 원설계는 create_reservation_order 내부에서 holiday_extra_fee를 직접 누적·가산
했으나, 2026-09-14 완전히 무관한 다른 세션(Migration #497)이 그 최종금액 계산(v_total/
v_discount/v_coupon_discount/v_final 산출 + orders UPDATE) 전체를 create_reservation_order
밖으로 빼내 sync_order_after_composition_change 공용 함수로 리팩터링했다 — create_
reservation_order·cms_add_reservation_product_unit·cms_remove_reservation_product_unit
3곳이 전부 이 함수를 공유한다. 2026-09-15 병합 시 원설계를 그대로 되살리면 9/14 리팩터링이
되돌아가는 회귀였으므로, holiday_extra_fee 집계를 sync_order_after_composition_change
쪽에 새로 재통합했다(Migration #502) — 이 덕분에 create_reservation_order뿐 아니라 CMS
예약 구성 변경(상품 추가/제거) 경로에서도 자동으로 함께 반영된다.

집계 방식: v_total과 동일하게 "그 주문에 연결된 order_items 전체를 매번 재조회"해
compute_reservation_line_amount(oi.reservation_id).holiday_extra_fee를 합산(부분 재호출 시
유실 방지 — 개별 RPC 호출마다 새로 계산·누적하는 방식은 재발행 등으로 일부 예약만 남는
경우 기존 연결 예약의 연장요금을 덮어써 유실시키는 결함으로 이어지므로 금지).

⚠️ create_reservation_order에 새 holiday_extra_fee 관련 로직을 직접 추가하지 말 것 —
그 함수는 이미 sync_order_after_composition_change를 호출해 위임하므로, 수정이 필요하면
반드시 sync_order_after_composition_change 쪽을 고칠 것(정본 단일화 원칙).
```

### §5-2. 요금 공식 — 2026-09-19 전면 개정판 (현재 유효, Stephen 확정) ⛔ 정본

```
배경: 실사용 검증 중(장바구니 실제 캡처 화면 분석) Stephen이 2가지를 CRITICAL로 지적·확정:
  1) "N 중 하루 무료" 예외가 심각한 정책 미적용 오류 — 완전 폐기.
  2) 옵션상품도 무조건 포함해 50% 할인요금이 부과돼야 함 — 과거엔 옵션에 이 특례
     자체가 없어(§5 "폐기됨" 표기 참고) 연장일도 정상가 그대로 청구되고 있었음
     (실제 발견 사례: 본상품 70,000+옵션 30,000, N=1 상황에서 옵션이 연장된 3일치
     정상가로 청구돼 대여요금이 기대보다 30,000원 더 계산됨).

새 공식(한쪽/양쪽 구분 없는 단일 규칙 원칙은 유지, "첫날 무료"만 삭제):

  N = pickup_holiday_extra_days + return_holiday_extra_days

  본상품 holiday_extra_fee = N × daily(본상품 24h요율) × 0.5
    N=0→0 / N=1→daily×0.5 / N=3→daily×1.5  (과거 GREATEST(N-1,0) 아님)

  옵션별 holiday_extra_fee = N × unit_price(그 옵션 24h요율) × 0.5 × qty
    12h요율이 없는 flat 옵션(구매·단가고정형)은 "일" 단위 개념이 없어 제외
    (rental_fee/options_fee의 넷팅 로직과 동일 폴백 원칙)

  반환값(compute_reservation_line_amount)의 holiday_extra_fee 컬럼 = 본상품분 +
  옵션 전체 합산분을 하나의 값으로 통합(이중할인 방지 원칙상 둘 다 v_total 밖에서
  가산돼야 하므로 컬럼을 나눌 이유가 없음 — 클라이언트도 otHolidayExtraFee 하나로 통합)

  rental_fee/options_fee 자체의 넷팅(연장 전 "원래 요청 일수" 기준으로 계산 후
  extension_days×daily를 빼는 방식)은 무변경 — 옵션도 이번에 처음으로 이 넷팅이
  적용됨(과거엔 옵션에 넷팅 자체가 없어 연장일도 정상가 그대로 청구되고 있었음).

⛔ "첫날 무료"를 다시 추가하거나(GREATEST(N-1,0) 부활), 옵션을 이 계산에서 다시
빼는 방향으로 되돌리지 말 것 — 둘 다 2026-09-19 Stephen이 명시적으로 뒤집은 결정이다.
```

**구현 파일(§5-2 반영)**
```
서버 : compute_reservation_line_amount(Migration #509) — v_holiday_extra_fee 산식 교체
       (GREATEST(N-1,0)→N) + 옵션 넷팅·50% 가산 신규(v_options_holiday_extra_fee)
클라이언트 : src/lib/utils/cartRentalFee.ts
  calcHolidayExtraFee — GREATEST(N-1,0)→N으로 교체
  calcOptionsHolidayExtraFee(신설) — 옵션별 동일 산식(옵션 자체 요율 기준)
  src/routes/cart/+page.svelte
    itemOptionFee — 옵션 기본요금도 본상품과 동일하게 연장일수만큼 넷팅하도록 교체
    otHolidayExtraFee — 본상품분 + calcOptionsHolidayExtraFee(옵션분) 합산
TDD(RED→GREEN) : src/__tests__/services/holidayExtensionFee.test.ts(기존 EC-HF-*를 새
  공식으로 갱신 + EC-OPT-* 8건 신규) · src/__tests__/services/holidayExtraFeePolicyReversal.test.ts
  (신규, Stage 라이브 통합테스트 — compute_reservation_line_amount 자체를 4개 시나리오로 검증)
Production 데이터 보정 : reservation id=132/order id=28(migration #508 때 이미 보정했던
  건, 아직 미결제) — 새 공식으로 재동기화(holiday_extra_fee 20,000→30,000, final_amount
  46,600→56,600), sync_order_after_composition_change(28) 재호출로 반영.
```

### 구현 파일 참조

```
신규 컬럼  : rental_reservations.pickup_holiday_extra_days/return_holiday_extra_days,
             orders.holiday_extra_fee
신규 SQL 함수 : is_courier_holiday(date) — courierClosedDates.ts와 동일 로직
               compute_holiday_extended_period(start, end, pickup_method, return_method)
RPC 변경   : create_hold_reservation·promote_draft_reservation(파라미터 확장, DROP+CREATE)·
             create_hold_reservation_with_shipment(1줄 전달)·
             compute_reservation_line_amount(4번째 컬럼 holiday_extra_fee 추가)·
             sync_order_after_composition_change(holiday_extra_fee 집계+가산 — 위 절 참고,
               create_reservation_order 자체는 무변경)
             ⚠️ calculate_cart_total(Migration 251)은 이번 변경 대상 아님 — compute_
               reservation_line_amount의 4번째 컬럼(holiday_extra_fee)을 구조분해하지
               않고 rental_fee/options_fee/deposit 3개만 사용하며, 그 결과값(calcTotal 등)
               자체도 cart/+page.svelte에서 렌더링되지 않는 dead prop이다 — "당연히
               연동됐을 것"이라고 오판하지 말 것
클라이언트 : src/lib/utils/cartRentalFee.ts
             calcHolidayExtension(startDate, endDate, pickupCourierDependent,
               returnCourierDependent, closedDatesSet) — 서버 compute_holiday_extended_
               period와 동일 워크 로직
             calcHolidayExtraFee(pickupExtraDays, returnExtraDays, dailyPrice) — 서버
               free/50% 공식 그대로 미러링
             src/routes/cart/+page.svelte — itemHolidayExtension/otHolidayExtraFee,
               isDateDisabled/onDisabledClick(차단 제거+자동조정 안내로 교체)
             src/lib/components/common/CalendarGrid.svelte — highlightDates prop(순수
               시각 하이라이트, 선택 가능 여부와 무관) + warnSelected prop(2026-09-16 신설,
               아래 참고)
⛔ 폐기됨(2026-09-19, §5-2 참고) : 옵션상품(reservation_options)에는 이 특례 미적용
             (본상품만) — 이제는 옵션도 반드시 포함해 계산해야 한다. ·
             create_checkout_order(레거시 confirm-mock 경로) — 실제 fetch 호출부가
             코드베이스에 전혀 없어 체크아웃 흐름에서 도달 불가능함을 확인, 반영 불필요
마이그레이션 : supabase/migrations/20260915010000_501_holiday_extension_reintegration.sql
             (컬럼·is_courier_holiday·compute_holiday_extended_period·create_hold_
             reservation류·compute_reservation_line_amount — 8일간 DB에만 살아있던
             정의를 그대로 역커밋),
             supabase/migrations/20260915020000_502_sync_order_holiday_extra_fee.sql
             (sync_order_after_composition_change 재통합, 신규 로직)
```

### 2026-09-16 후속 — 달력 색상 재설계 + CMS 안내 스크립트 (계획서 `wobbly-cuddling-marble.md`)

⛔ 이 절은 **순수 프론트 시각 로직 + CMS 안내문 신설**만 다룬다 — 위 요금 계산(무료 1일+
나머지 50% 할인, `calcHolidayExtraFee`/`compute_reservation_line_amount`/
`sync_order_after_composition_change`)은 단 한 줄도 무변경.

```
색상 규칙(Stephen 확정): 선택일(수령/반납 중 자동연장을 유발한 날짜) = 레드
  (--cs-red-badge) · 구간 밖 첫 정상 영업일(경계 하루) = 퍼플(--cs-purple-light) ·
  흡수되는 휴무일 자체(연속이어도 전체) = 무색(색상 배경 없음)

CalendarGrid.svelte 변경:
  highlightDates prop의 의미가 "흡수되는 모든 날짜"에서 "경계 하루(구간 밖 첫 정상
    영업일)"로 변경됨 — 호출부는 항상 최대 1개 날짜만 담아 전달
  warnSelected?: boolean 신규 prop(미전달 시 기존 호출부 전부 동작 100% 불변) — true면
    선택된 날짜(cal-day-sel)를 레드로 오버라이드. .cal-day-sel과 .cal-day-range-start/
    end::after 두 레이어를 모두 오버라이드해야 카트 화면에서 실제로 보인다(카트의
    RentalForm 두 호출부는 selectedDate를 항상 rangeStart/rangeEnd와 동일 값으로 전달하므로
    선택된 날짜 칸은 항상 cal-day-sel + cal-day-range-start/end가 동시에 적용됨)

cart/+page.svelte RentalForm 스니펫: holidayHighlightDates 계산을 "연장일수만큼 반복
  addDays"에서 "addDays(effectiveStart, -1)(수령) / addDays(effectiveEnd, +1)(반납) 딱
  1개"로 교체 + warnSelected = holidayExtraDays > 0 신규 추가. calcHolidayExtension의
  while 루프가 "휴무 아님"을 확인한 그 즉시 break하므로 이 경계일 계산은 연장일수(N)가
  몇 일이든 별도 분기 없이 항상 정확하다(증명: calcHolidayExtension 주석 참고).

CMS 안내 스크립트 신설(delivery_cutoff_settings.holiday_guide_text, Migration #505):
  /cms/set/rental "휴무일 제어 옵션" 섹션에 shipping_guide와 동일 패턴의 textarea 추가
  (200자, upsert_delivery_cutoff_settings RPC 4-param 확장 — 구 3-param DROP + REVOKE/
  GRANT 재하드닝 필수, §GATE C 참고). cart/+page.server.ts load()가 rentalGuideText와
  동일 패턴으로 독립 조회해 holidayGuideText로 전달 — loadCourierClosedDates()(휴무일 Set
  계산 전용 유틸)의 책임 밖이라 그 함수에 합치지 않음. cart/+page.svelte는 달력이 열려있고
  (isCalOpen) 자동연장이 발동된(holidayExtraDays>0) 동안에만 .form-note로 노출(기존
  onselect의 csToast.info(...) 이벤트성 토스트와 공존 — 대체 아님).

마이그레이션: supabase/migrations/20260916000000_505_delivery_cutoff_holiday_guide_text.sql
```

### 2026-09-19 후속 — 달력 색상 재설계 2차 (경계 하루 방식 폐기, 흡수 전체 표시로 전환)

⛔ 이 절도 위와 마찬가지로 **순수 프론트 시각 로직만** 다룬다 — 요금 계산 자체는 이 세션에서
단 한 줄도 무변경(다만 §5 본문의 "휴무일 연장요금" 실제 청구가 `set_reservation_shipment_
method`의 재계산 누락으로 한 번도 발동한 적이 없던 완전히 별개의 CRITICAL 결함은 같은 시기에
Migration #508로 수정됨 — 계산 로직 결함이었고 이 절이 다루는 달력 시각 로직과는 무관).

```
배경: 2026-09-16 "경계 하루만 하이라이트" 설계가 실사용 중 3가지 문제로 이어짐(Stephen
CS 피드백, 2026-09-19):
  ① 실제로 흡수되는 날짜(연휴 자체) 자체는 전혀 표시되지 않고, 구간 밖의 "정상 영업일로
     돌아가는 경계일" 단 하루만 표시돼 "휴무일 며칠이 포함됐는지"를 달력만 보고 알 수 없었음.
  ② 흡수 취소선(cal-day-delivery-closed, 2026-09-18 신설분)이 "이 날짜는 아예 대여가 안
     된다"는 인상을 줘 실제로는 선택 가능하다는 사실과 충돌.
  ③ 경계 하루 계산이 "현재 선택된 날짜" 하나를 기준으로만 동작해, 연휴 중간의 날짜를
     선택하면(예: 3일 연휴 중 가운데 날) 경계일 계산 자체가 그 날짜 기준으로 다시 이뤄져
     실제 흡수 범위의 뒤쪽 날짜가 하이라이트에서 누락되는 것처럼 보임("사용한 날로
     지정된 것처럼" 오인 유발).

색상 규칙 전면 교체(Stephen 확정, 2026-09-19):
  ⛔ 위 2026-09-16 규칙("선택일=레드·경계 하루=퍼플·흡수일=무색")은 완전히 폐기.
  · 정적 휴무일(선택되지도 흡수되지도 않은, 달력에 그냥 보이는 휴무일) = 빨간 글자만
    (일요일과 동일 취급, 원형배경·취소선 전부 없음) — cal-day-delivery-closed
  · 선택된 날짜 자체가 휴무일 = 진한 빨간 원(cal-day-warn 재사용, 조건만 교체) — 연장을
    유발하는지 여부와 무관하게 "휴무일을 사용일로 선택"이라는 사실 자체로 판정
  · 자동연장으로 흡수된 날짜(연속이어도 전체) = 연한 빨간 원, 수령측/반납측 서로 다른 톤
    (수령측 cal-day-pickup-absorbed = red-5, 반납측 cal-day-return-absorbed = red-30)

CalendarGrid.svelte 변경:
  highlightDates prop(경계 하루 전용) 완전 삭제, publicHolidayDates prop(2026-09-19 오전
    세션에서 국경일 전용 원형표시로 신설됐다가 반나절만에 폐기 — 아래 참고) 완전 삭제.
  pickupAbsorbedDates?: Set<string> / returnAbsorbedDates?: Set<string> 신규 — "실제
    흡수되는 날짜 전체"(경계 하루가 아님)를 각각 받는다.
  warnSelected 의미 재정의 — "선택이 연장을 유발하는지"에서 "선택된 날짜 자체가
    deliveryClosedDates 멤버인지"로 교체(더 넓은 조건 — 전후가 모두 영업일인 고립된
    휴무일을 선택해도 강조).
  deliveryClosedDates prop 자체는 유지(임시휴무+공휴일+일요일 통합, 2026-09-18 신설
    그대로)하되 CSS만 취소선→빨간 글자색(!important 필요 — 토요일 퍼플 규칙이 이 규칙보다
    specificity가 높아 덮어쓰는 결함이 cal-day-adj-holiday 최초 도입 때와 동일하게 재발할
    뻔함, 즉시 방지).

cart/+page.svelte RentalForm 스니펫: holidayHighlightDates(경계 하루 1개)를
  holidayAbsorbedSet(흡수되는 날짜 전체 — 수령측: effectiveStart~선택일 직전 /
  반납측: 선택일 다음날~effectiveEnd, addDays 루프)로 교체. warnSelected를
  `courierClosedSet.has(props.selectedDate)`로 재정의.

⛔ 폐기된 중간 설계(같은 날 오전, 반나절만 존재): "법정공휴일(national)만 원형표시,
  임시휴무·일요일은 표시 안 함"(publicHolidayDates prop, courierClosedDates.ts의
  isPublicHoliday 플래그) — Stephen이 국경일만 원형으로 강조해달라고 요청해 구현했으나,
  같은 날 후속 CS 피드백에서 "흡수되는 모든 날짜"(휴무일 종류 무관, 일요일 포함)를
  표시해야 한다는 것으로 요구사항이 확장돼 완전히 대체됨. isPublicHoliday 필드도 이
  세션에서 함께 제거(사용처 없는 죽은 데이터가 되므로) — 향후 세션에서 "법정공휴일만
  따로 표시"류 요청이 다시 들어오면 이 이력을 참고할 것(courierClosedDates.ts git
  히스토리에 두 버전 다 남아있음).

마이그레이션: 없음(순수 프론트 변경, DB 스키마·RPC 무관)
```

---

## GATE C 확인 항목 (이 영역 코드 수정 시)

```
[ ] 1day 강제청구(deliveryLocked) 판정에 is_bulk_delivery를 다시 섞지 않았는가?
    (is_delivery_type 단독 기준 유지 — §2 결함 재발 금지 박스 참고)
[ ] "요청 A" 관련 코드(force-copy, 반납잠금, 시간선택숨김, copyToReturn 강제고정)를
    실수로 is_delivery_type 기준으로 바꾸지 않았는가? (isDeliveryLocked 그대로 유지)
[ ] 배송비(왕복요금, calcShippingFee) 계산의 pickupIsDelivery/returnIsDelivery는
    is_delivery_type 기준(isDeliveryTypeMethod)을 그대로 쓰는가? (2026-09-06 이전에는
    is_bulk_delivery 기준이었으나, 그 상태에서 is_bulk_delivery=false인 실배송 방식을
    선택해도 배송비가 0원으로 계산되는 CRITICAL 결함이 있어 is_delivery_type으로 교체됨
    — isDeliveryLocked()로 다시 되돌리지 말 것)
[ ] 클라이언트(cartRentalFee.ts/cart+page.svelte)와 서버(compute_reservation_line_amount)
    양쪽을 항상 세트로 수정했는가? 한쪽만 고치면 미리보기 금액과 실제 청구액이 어긋난다.
[ ] 서버 RPC 수정 시 calculate_cart_total·create_reservation_order·결제(pay-mock)·Toss
    웹훅 정산(process_pending_toss_webhooks) 중 독립적으로 금액을 재계산하는 경로가
    새로 생기지 않았는가? (전부 compute_reservation_line_amount에 위임하는 구조 유지)
[ ] 옵션상품 요금도 본상품과 동일한 일수/반나절가산을 적용하는가? (옵션 자체 12h요율은
    독립 조회, 12h요율 없으면 flat 폴백 — §3 참고)
[ ] Stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 후 Production(vnbpmvxruyciuuaermyh) 적용
    순서를 지켰는가?
[ ] 휴무일 연장 요금(§5-2) 수정 시 — holiday_extra_fee 계산에 한쪽/양쪽 구분 분기를
    추가하지 않았는가? (N=전체 연장일수 합산 기준 단일 공식만 존재해야 함)
[ ] (2026-09-19부터 폐기) ~~holiday_extra_fee = GREATEST(N-1,0)×daily×0.5(첫날 무료)~~ —
    이 형태가 다시 보이면 §5-2에서 폐기된 규칙이 되살아난 것. 지금은 N×daily×0.5(예외 없음).
[ ] (2026-09-19) 옵션상품이 holiday_extra_fee 계산에서 빠지지 않았는가? — 옵션도
    본상품과 동일하게 (a) 연장일수만큼 정상가에서 넷팅 + (b) 그 연장일수에 옵션 자체
    요율의 50%를 가산해야 한다(calcOptionsHolidayExtraFee / SQL v_options_holiday_extra_fee).
    "옵션은 이 특례 미적용"이라는 옛 서술이 다시 나타나면 §5(폐기 표기) 참고해 즉시 의심할 것.
[ ] holiday_extra_fee가 v_total(할인 계산 기준)에 섞여 들어가지 않았는가? (delivery_fee와
    동일하게 할인·포인트 차감 이후에만 가산)
[ ] create_hold_reservation/promote_draft_reservation에 p_pickup_method/p_return_method를
    NULL로 호출하는 기존 경로가 여전히 기존 동작 그대로인가? (하위호환 필수)
[ ] 반납측 휴무일 판정 기준일이 "반납일 당일"이 아니라 "반납일 다음날(+1)"로 캘린더 UX·
    연장 로직 양쪽 모두 통일돼 있는가?
[ ] holiday_extra_fee 관련 수정이 필요할 때 create_reservation_order를 직접 고치지 않고
    sync_order_after_composition_change(정본)를 고쳤는가? (§5 "최종금액 합산 지점" 참고 —
    9/14 리팩터링 이후 3개 호출부가 이 함수를 공유하므로 create_reservation_order를 다시
    건드리면 사일로 로직이 재발한다)
[ ] 격리된 git worktree/다른 세션에서 DB에 직접 적용한 마이그레이션이 있다면, 그 화면
    코드가 실제로 stage 브랜치에 병합돼 있는지 확인했는가? ("DB엔 있는데 코드엔 없는"
    드리프트가 이번 사안의 근본 원인이었다)
[ ] (2026-09-16) CalendarGrid.svelte에 새 prop을 추가할 때 기본값을 지정해 미전달 시
    기존 호출부(CmsDatePicker.svelte·ProfileTabContent.svelte) 동작이 100% 불변인가?
[ ] warnSelected 관련 CSS를 수정할 때 .cal-day-sel뿐 아니라 .cal-day-range-start/
    end::after도 함께 오버라이드했는가? (카트 화면은 selectedDate가 항상 rangeStart/
    rangeEnd와 동일값이라 실제로 그려지는 건 ::after 원 — .cal-day-sel만 고치면
    시각적으로 아무 효과가 없다)
[ ] (2026-09-19부터 폐기) ~~highlightDates에 "흡수되는 모든 날짜"가 아니라 "경계 하루"만
    담기는가~~ — 이 규칙은 2026-09-19 CS 피드백으로 정반대로 뒤집혔다. 지금은 반대로
    pickupAbsorbedDates/returnAbsorbedDates에 "흡수되는 날짜 전체"가 담겨야 한다(경계
    하루만 담으면 회귀). highlightDates prop 자체가 삭제됐으므로 이 항목이 다시 보이면
    옛 prop이 되살아난 것 — 즉시 의심할 것.
[ ] delivery_cutoff_settings.holiday_guide_text 관련 RPC를 DROP+CREATE했다면 REVOKE ALL
    FROM PUBLIC, anon + GRANT TO authenticated 재하드닝을 빠뜨리지 않았는가? (2026-09-15
    CRITICAL 실사고 재발 방지 원칙 — 새로 생성된 함수 객체는 구버전의 권한 하드닝 이력을
    전혀 물려받지 못한다)
[ ] (2026-09-19) warnSelected를 "선택이 연장을 유발하는지"로 되돌리지 않았는가? — 지금은
    "선택된 날짜 자체가 deliveryClosedDates 멤버인지"가 정의다(더 넓은 조건).
[ ] (2026-09-19) cal-day-delivery-closed의 color 규칙에 !important가 유지되는가? (토요일
    cal-day-sat:not(.cal-day-past)이 specificity로 이겨 퍼플이 되는 결함 재발 방지)
[ ] (2026-09-19) pickupAbsorbedDates/returnAbsorbedDates 계산이 "현재 선택된 날짜" 하나만
    기준으로 방향(수령=역방향/반납=순방향)을 정확히 지키는가? 반대 방향으로 계산하면
    연휴 중간 날짜 선택 시 뒤쪽 흡수일이 다시 누락되는 2026-09-19 이전 결함이 재발한다.
```

---

*rental-fee-policy.md v1.5 | Harness Flow v3.2 | 2026-09-19(같은 날 후속) §5-2 신설 —
휴무일 연장요금 공식 전면 개정(Migration #509, Stephen CRITICAL 확정): "N 중 하루 무료"
예외 완전 폐기(N×daily×0.5로 교체) + 옵션상품도 무조건 포함해 50% 할인요금 부과(과거엔
특례 자체가 미적용이라 연장일도 정상가 청구). 실사용 캡처 화면 분석으로 발견(본상품+
옵션 구성 예약에서 대여요금이 기대보다 30,000원 더 계산됨). TDD: holidayExtensionFee.
test.ts 기존 공식 갱신+EC-OPT-* 8건 신규, holidayExtraFeePolicyReversal.test.ts(Stage
라이브 통합) 4건 신규 — 전부 GREEN. Stage·Production 적용 완료, Production 미결제
예약(id=132/order=28, Migration #508 때 이미 보정했던 건) 새 공식으로 재동기화
(holiday_extra_fee 20,000→30,000). §5 옛 공식·옵션제외 서술은 폐기 표기로 유지(삭제
안 함 — 회귀 감지용), GATE C 3건 추가. | 2026-09-19 §5 2차 후속 절 추가 — 달력
색상 재설계 2차(CS 피드백): "경계 하루만 하이라이트"(2026-09-16 설계) 완전 폐기, 실제
흡수되는 날짜 전체를 수령측/반납측 다른 톤으로 표시하는 방식으로 교체
(`pickupAbsorbedDates`/`returnAbsorbedDates` 신규, `highlightDates`/`publicHolidayDates`
prop 삭제, `warnSelected` 의미를 "선택이 연장을 유발하는지"→"선택된 날짜 자체가 휴무일인지"로
재정의). 같은 CS 신고에서 "휴무일 연장요금 일수가 안 맞는다"는 계산 버그 의심도 제기됐으나
Production `compute_holiday_extended_period` 직접 SQL 검증으로 계산 자체는 정확함을
확인 — 실제 원인은 달력이 흡수 전체가 아닌 경계 하루만 표시해 육안 확인 시 일수가 적어
보인 시각 문제였음(계산 로직 무변경). GATE C 4건 갱신/추가. | 2026-09-04 신설 — 4가지 수령→반납 조합별
금액 검증 세션(Migration #440~445) 산출물을 정책 문서로 정리. is_bulk_delivery/
is_delivery_type 혼동이 실제 CRITICAL 결함으로 이어졌던 이력을 재발방지 목적으로
명문화(§2 박스). | 2026-09-06 §4·GATE C 정정 — `calcShippingFee`(배송비) 판정기준이
`is_bulk_delivery`에서 `is_delivery_type`으로 교체된 것을 반영(`is_bulk_delivery=false`인
실배송 방식 선택 시 배송비가 0원으로 계산되던 CRITICAL 결함 수정에 따른 문서 갱신 — 코드
수정 자체는 이 문서 갱신 이전 세션에서 완료·GATE E 검수 통과·`rental-cms-settings.md`
동시 정정 완료됨). | 2026-09-15 §5 신설 — 휴무일 포함 배송 연장 요금 로직(2026-09-12
별도 세션 설계) 병합 반영. 화면 코드가 격리된 git worktree에만 존재하고 DB 마이그레이션만
Stage에 적용된 8일간의 드리프트를 발견·해소, worktree 원설계(create_reservation_order
직접 가산)가 9/14 무관한 세션의 리팩터링(sync_order_after_composition_change 공용화)에
덮여 사라진 것을 확인해 정본 위치를 sync_order_after_composition_change로 재조정.
Migration #501·#502로 병합, GATE C 6건 추가. | 2026-09-16 §5 후속 절 추가 — 달력 색상
재설계(선택일=레드·경계일 1개=퍼플·휴무일 자체=무색, `CalendarGrid.svelte` `warnSelected`
prop 신설 + `highlightDates` 의미 변경) + CMS 안내 스크립트 신설
(`delivery_cutoff_settings.holiday_guide_text`, Migration #505). 요금 계산 로직은 단 한
줄도 무변경 — 계획서 `wobbly-cuddling-marble.md` PART A(CMS)+PART B(front) 전체 반영,
Stage 실데이터(추석 9/24~26)로 라이브 검증 완료(선택 9/25→25=레드·24=무색·23=퍼플 확인).*
