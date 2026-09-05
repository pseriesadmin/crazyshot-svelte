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
```

---

*rental-fee-policy.md v1.1 | Harness Flow v3.2 | 2026-09-04 신설 — 4가지 수령→반납 조합별
금액 검증 세션(Migration #440~445) 산출물을 정책 문서로 정리. is_bulk_delivery/
is_delivery_type 혼동이 실제 CRITICAL 결함으로 이어졌던 이력을 재발방지 목적으로
명문화(§2 박스). | 2026-09-06 §4·GATE C 정정 — `calcShippingFee`(배송비) 판정기준이
`is_bulk_delivery`에서 `is_delivery_type`으로 교체된 것을 반영(`is_bulk_delivery=false`인
실배송 방식 선택 시 배송비가 0원으로 계산되던 CRITICAL 결함 수정에 따른 문서 갱신 — 코드
수정 자체는 이 문서 갱신 이전 세션에서 완료·GATE E 검수 통과·`rental-cms-settings.md`
동시 정정 완료됨).*
