# rental-cms-settings.md — CMS 대여관리 설정 ↔ 장바구니 연동관계 전체 인덱스
# Harness Flow v3.2 | 2026-09-05 신설

---

## 이 문서의 목적

`/cms/set/rental`(CMS 대여관리 설정 화면)에서 관리자가 조작하는 값들이 실제로 장바구니
(`/cart`)의 어떤 판정 로직을 거쳐, 어떤 제한·동작을 만들고, 최종 "예약신청완료" 시점에
어느 RPC로 어떤 값이 DB에 저장되는지를 빠짐없이 인덱싱한다.

이 문서가 신설된 이유(2026-09-05): 같은 대여방식 플래그(`is_bulk_delivery`/
`is_courier_dependent`/`is_delivery_type`)를 둘러싼 설계가 최근 며칠 새(Migration
#339→#386→#440→#441→#443→#444) 5차례 뒤집혔고, 서로 다른 세션이 서로 다른 전제로 작업하며
실제로 최소 2건의 회귀(Production `visit`/`quick`이 의도치 않게 `is_bulk_delivery=true`가
되어 시간선택이 오락가락한 사고, "반납 배송선택 제한"과 "요청 A"가 같은 방식에 동시에
필요한데 상호배타로 막혀있던 사고)를 유발했다. 이 CMS 설정 화면의 15개 이상 설정 항목에
대한 공식 규칙 문서가 `rules/`·`rules-ref/` 어디에도 없었던 것이 근본 원인 — 이 문서로 그
공백을 채운다.

⛔ **정본 관계**: 대여요금 산식(12시간 블록 올림, deliveryLocked 우회, 수령→반납 조합별
청구방식 4종)의 상세 수식은 이 문서가 아니라 **`rental-fee-policy.md`가 정본**이다. 이
문서는 그 산식이 "어느 CMS 설정에 의해 트리거되는가"까지만 표로 연결하고, 산식 자체는
중복 서술하지 않는다 — 산식이 궁금하면 `@.claude/rules-ref/rental-fee-policy.md`를 호출할 것.

---

## 표 A — CMS `/cms/set/rental` 설정 전체 인벤토리

> 화면에 실재하는 최상위 섹션은 5개다(코드 주석 라벨 "섹션 4"가 두 곳에 중복 부여된 오기입이
> 있음 — 지점정보/공통안내문+필수동의문이 각각 별도 섹션).

| 섹션 | DB 테이블.컬럼 | CMS UI 요소(파일:라인) | 의미/용도 | 비고 |
|---|---|---|---|---|
| 대여 기간 제한 옵션 | `rental_period_options.name/display_order/is_active` | 텍스트입력+추가, 드래그정렬 (`+page.svelte` L244-276) | 상품 등록 시 선택 가능한 대여기간 라벨 후보 | ⛔ **죽은 설정 — 카트 미연동**(§표A-1 참고). 상품상세 정보성 칩 표시에만 쓰임 |
| 대여 방식 옵션 — 기본정보 | `rental_method_options.name/method_key/display_order/is_active` | 방식유형 칩(5종: visit/quick/delivery/locker/crazydelivery)+텍스트입력 (L316-349) | 카트 수령/반납 탭과 매핑되는 방식 코드. `method_key` 누락 시 카트 연동 불가 | 최대 10개 |
| 대여옵션(수령/반납) 일괄적용 | `rental_method_options.is_bulk_delivery` (Migration #339) | `s-chip` 토글, 방식별 반복 (L530-555) | **"요청 A"** — 이 방식이 **수령**일 때 반납 자동강제고정+시간선택숨김 (⚠️ 2026-09-06 — "순수일수청구"는 더 이상 이 플래그의 효과가 아님, 요금 산정은 `is_delivery_type`이 전담) | `isDeliveryLocked()`가 판정(표B 참고) |
| 휴무일 제한 방식 | `rental_method_options.is_courier_dependent` (Migration #386) | `s-chip` 토글 (L559-584) | 이 방식일 때 공휴일/일요일 날짜선택 차단 | `is_bulk_delivery`와 완전 독립 목적 |
| 배송 반납 허용 지정 | `rental_method_options.is_delivery_type` (Migration #440, 2026-09-04 라벨정정) | `s-chip` 토글 (L611-636) | 이 방식이 **수령이 아닐 때** 반납 콤보 목록에서 제외 | Migration #444로 `is_bulk_delivery`와 동시 ON 허용(과거 상호배타 가드 제거) |
| 배송 설정 — 요금 3종 | `rental_shipping_settings.enable_round_trip/round_trip_fee`, `.enable_delivery/delivery_fee`, `.enable_return/return_fee` | `s-chip`+숫자입력, blur 자동저장 (L410-493) | 배송대여 왕복/편도/반납 요금(원). 싱글톤 1행 | Stage: 왕복 8,000 / 배송 4,000 / 반납 4,000 (전부 활성) |
| 배송 안내문 | `rental_shipping_settings.shipping_guide` | textarea+저장버튼 (L497-522) | 고객노출 배송 안내 문구 | — |
| 배송료 우대설정 | `delivery_fee_discount_tiers.min_rental_amount/condition_types[]/discount_rate/is_active` | 금액입력+조건 다중선택(AND)+우대옵션 단일선택, 최대 5개 (L642-752) | 대여금액·조건 충족 시 배송비 할인. 다중매칭 시 최유리 1개만(스태킹 없음) | `long_term_rental`/`sale_only_purchase`/`rental_item` 3종 조건 |
| 휴무일 제어 옵션 | `delivery_cutoff_settings.enable_prev_day_check`(마스터)/`.enable_fixed_holidays`/`.enable_manual_holidays` | `s-chip` 3종, 마스터 off 시 하위 disabled (L772-796) | 택배 수령·반납 캘린더 휴무일 기반 제한 마스터+하위 스위치 | Stage: 3개 전부 false(배포 후 미사용 기본값) |
| 법정공휴일(읽기전용) | `public_holidays`(`holiday_type='national'`) | 읽기전용 리스트+"지금 동기화" 버튼(공공데이터포털 API) | 자동 동기화 국가 공휴일 | CMS에서 개별 삭제 불가 |
| 임시 휴무일 관리 | `public_holidays`(`holiday_type='manual'`) | 날짜+사유 입력, 개별 삭제 가능 | 관리자 수동 등록 임시 휴무일 | — |
| 지점 정보 등록 | `pickup_points.name/address/phone/contact_person/is_active` | 텍스트입력+추가(최대 20개), 아코디언 편집 (L968-1077) | 방문수령 지점 정보(고객 노출용) | — |
| 공통 대여 안내문 | `rental_guide_settings.guide_text`(싱글톤, 최대 1000자) | textarea+저장 (L1107-1130) | 대여 전반 공통 이용안내 문구 | — |
| 필수 동의문 항목 | `rental_consent_items.content/display_order/is_active` | 텍스트입력(최대 200자)+추가(최대 10개), 드래그정렬 (L1140-1199) | 체크아웃 필수 동의 문구 목록 | 카트에 실제 게이팅으로 연결됨(§표B "agreed" 참고) |
| **orphan 컬럼(CMS 조회·수정 경로 없음)** | `rental_method_options.fee_amount/fee_description/deadline_time/is_free_for_top_grade` (Migration #156) | 없음 — `+page.server.ts` load select 목록에서 누락 | 값은 존재하나(체크아웃 표시용 다른 경로로 채워진 것으로 추정) CMS로 갱신 불가 | ⚠️ `fee_amount`는 전부 0인데 `fee_description`엔 "3,500원" 등 문구 존재 — 값 불일치 |

> ⚠️ **Stage/Production 데이터 drift 주의**: 두 환경의 `rental_method_options` 행 구성(방식
> 종류·개수·플래그 조합)이 상당히 다르다. 이 표의 "Stage 현재값"은 스냅샷일 뿐 — 설정을
> 실험하기 전 반드시 어느 DB에 연결된 상태인지 재확인할 것(`core-rules.md` DB 환경 분리 원칙).

> ⚠️ **권한 비대칭**: `+page.server.ts`의 액션 20개 중 `syncHolidaysNow` 1개만
> `hasSettingsAccess`(manager+) 검사, 나머지 전부는 세션 존재만 확인 — partner 등급도 요금·
> 플래그·우대설정 등 대부분을 변경할 수 있는 상태(2026-09-05 시점, 별도 보안 검토 대상).

---

## 표 B — 인과사슬 (CMS 설정 → 판정함수 → 장바구니 동작)

| CMS 설정(테이블.컬럼) | 판정 함수 (file:line) | 장바구니 화면 효과 |
|---|---|---|
| `rental_method_options.is_bulk_delivery` | `isDeliveryLocked(m)` — `cart/+page.svelte:84-86` | ① 시간선택 버튼 숨김(`RentalForm` `{#if !locked && !courierRestricted}`) ② 반납방식 강제복사+잠금(`bulkHandleMethod`/`bulkHandleReturnMethod`) ③ 반납 콤보 UI `disabled`+회색 처리(`returnComboLocked`) — ⚠️ 2026-09-06 이전에는 ④ `calcShippingFee` 입력값(pickupIsDelivery/returnIsDelivery)도 이 플래그 기준이었으나, `is_bulk_delivery=false`인 실배송 방식을 선택해도 배송비가 0원으로 계산되는 CRITICAL 결함이 발견돼 `is_delivery_type` 기준으로 교체됨(아래 행 참고) — 이 플래그는 더 이상 배송비 계산에 관여하지 않음 |
| `rental_method_options.is_courier_dependent` | `isCourierDependent(m)` — `cart/+page.svelte:104-106` | 캘린더 휴무일 차단(`CalendarGrid.isDateDisabled`, `courierClosedMap` 대조). `is_bulk_delivery`와 독립이지만 시간선택 숨김 조건에도 함께 관여 |
| `rental_method_options.is_delivery_type` | `isDeliveryTypeMethod(m)`(`+page.svelte:97-99`) + `computeReturnVisibleTabs()`(`cartShippingFee.ts:161-171`) | 반납 콤보 목록 필터링(수령이 이 방식이 아닐 때만 제외) + `calcRentalFee`의 `deliveryLocked` 12h블록 우회 판정 + `calcShippingFee` 입력값(pickupIsDelivery/returnIsDelivery, `cart/+page.svelte:982-983` — 2026-09-06부터, 위 `is_bulk_delivery` 행 참고)(**요금 관련 판정은 전부 `is_bulk_delivery`가 아니라 이 플래그 기준** — `rental-fee-policy.md` §2 참고) |
| `rental_shipping_settings.{enable_round_trip,round_trip_fee,enable_delivery,delivery_fee,enable_return,return_fee}` | `calcShippingFee()` — `cartShippingFee.ts:40-65` | 3-way 배타 규칙으로 왕복/배송/반납 요금 중 최대 1개 산출 → `otShippingFee` |
| `delivery_fee_discount_tiers.{min_rental_amount,condition_types,discount_rate}` | `calcShippingDiscountRate()` — `cartShippingFee.ts:100-124` | `otShippingDiscountRate` → `otDeliveryFee = round(otShippingFee × (1-rate))` |
| `rental_consent_items.{content,is_active,display_order}` | `agreed` 파생 — `cart/+page.svelte:729-733` | 등록된 항목 전부 개별 체크해야 `canProceed`/`readyToSubmit=true`, 미충족 시 제출 버튼 비활성 |
| `rental_period_options.*` | 없음(카트 미소비, grep 0건) | 없음 — 상품상세 정보성 칩 표시 외 아무 영향 없음 |

---

## 표 C — 최종 "예약신청완료" 제출 시 RPC 체인과 저장값

제출 핸들러: `cart/+page.svelte:1747-1934`

| 순서 | RPC | 저장되는 값 |
|---|---|---|
| 1 | `promote_draft_reservation(p_reservation_id, p_start_date, p_end_date)` — draft 그룹만 대상 | `rental_reservations.product_id`(재고유닛 배정)·`start_date`·`end_date`·`status='hold'` |
| 2 | `set_reservation_shipment_method(...)` (via `saveShipmentMethod()`) | `pickup_method`/`return_method`/`pickup_time`/`return_time`/`pickup_address_road`/`pickup_address_detail`. 서버 최종가드: 반납만 배송(`is_delivery_type`) 방식이면 예외 |
| 3 | `set_reservation_duration(p_reservation_id, p_duration_type)` | `duration_type` (status='hold' 조건부) |
| 4 | `POST /api/checkout/notify-hold` | DB 저장 없음(채팅 알림 side-effect) |
| 5 | `POST /api/reservations/create-order` → `create_reservation_order(...)` | `orders`/`order_items` 생성, `orders.final_amount`에 화면 계산값(`otDeliveryFee` 등) 그대로 합산 |

서버 정본 재계산: `compute_reservation_line_amount` RPC(Migration #445)가 DB에 저장된
`rr.pickup_method` 기준으로 클라이언트와 동일한 12h블록 산식·`deliveryLocked` 판정을
재수행 — 클라이언트 미리보기와 산식·판정기준이 일치하도록 설계됨(`rental-fee-policy.md`
"동기화 원칙" 참고).

---

## 알려진 갭 / 미해결 이슈 (2026-09-05 기준)

```
✅ [해소 완료, 2026-09-05~06] hold 예약의 "대여예약옵션" 통합패널 변경이 저장되지 않던 문제
   — TASK.md "예약신청 확인/수정 진입경로 신설 + hold 예약 방식·날짜 변경 미저장 버그 근본
   해결" 태스크(GATE E 통과)로 해소됨. 단, 원래 이 표가 예상했던 해법(sync_cart_dates() RPC로
   기존 hold 행을 직접 갱신)이 아니라 **재발행(reissue) 방식**으로 구현됨에 유의:

   - 체크된 hold 그룹의 itemsState(방식·날짜·시간)가 서버 원본(CartLineGroup)과 하나라도
     다르면, 제출 시 확인토스트 후 `/api/checkout/reissue-reservation`을 호출 → 완전히
     새로운 hold 예약(신규 예약코드)을 `create_hold_reservation_with_shipment` RPC로
     생성하고, 옵션·주문연결(order_items)을 신규 예약으로 이관한 뒤 기존 예약을
     `cancelled` 처리한다(기존 행을 그 자리에서 UPDATE하지 않음).
   - `applyBulkToItems()`(cart/+page.svelte:625) 내부의 "sync_cart_dates() RPC — TASK-D
     연동 시 호출 예정" 주석은 이 재발행 경로가 도입된 뒤에도 코드에 그대로 남아있다 —
     죽은 계획 문구이니 오독 주의(이 주석을 근거로 "아직도 저장 안 됨"이라고 재조사하지
     말 것). 실제 저장 경로는 위 재발행 흐름이다.

⚠️ [정보성] orphan 컬럼 4종(fee_amount/fee_description/deadline_time/is_free_for_top_grade)
   — 표A 참고, CMS 갱신 경로 없음 + fee_amount·fee_description 값 불일치.

⚠️ [정보성] rental_period_options — 표A/표B 참고, 완전히 죽은 설정(카트 미연동).

⚠️ [보안 검토 대상] /cms/set/rental 액션 20개 중 19개가 세션 존재만 확인(manager+ 권한
   검사 없음) — 표A 하단 각주 참고.
```

---

## GATE C 확인 항목

```
[ ] 새 CMS 대여관리 설정(플래그·테이블 컬럼)을 추가했다면 표A에 행을 추가했는가?
[ ] 그 설정을 카트가 실제로 소비하도록 구현했다면 표B에 판정함수→동작 인과관계를 추가했는가?
[ ] 제출 시 새로 저장되는 값이 있다면 표C에 추가했는가?
[ ] is_bulk_delivery/is_courier_dependent/is_delivery_type 중 하나를 건드리는 변경이라면,
    세 플래그가 서로 완전히 독립적인 목적임을 재확인했는가(하나를 고치며 다른 것과
    혼동하지 않았는가)?
[ ] Stage에서 검증한 설정 실험을 Production에도 그대로 가정하지 않았는가(데이터 drift 주의)?
```

---

*rental-cms-settings.md v1.2 | Harness Flow v3.2 | 2026-09-05 신설 — CMS 대여관리 설정
15개 이상 항목에 대한 공식 문서 공백을 해소하기 위해 작성(같은 플래그를 둘러싼 설계가
최근 5일 새 5차례 뒤집히며 최소 2건의 실사용 회귀를 유발한 이력 대응). | 2026-09-06
표A·표B 정정 — `calcShippingFee`(왕복/배송/반납요금) 판정 기준이 `is_bulk_delivery`에서
`is_delivery_type`으로 교체된 것을 반영(`is_bulk_delivery=false`인 실배송 방식 선택 시
배송비가 0원으로 계산되던 CRITICAL 결함 수정에 따른 문서 갱신 — 코드 수정 자체는 이 문서
갱신 이전 세션에서 완료·검증됨). | 2026-09-06(같은 날 후속) "알려진 갭" 첫 항목을
✅ 해소 완료로 정정 — hold 예약 통합패널 미저장 문제가 이 문서 작성 이후 별도 세션의
"예약신청 확인/수정 진입경로 신설" 태스크(GATE E 통과)로 이미 해소돼 있었음(단, 원래
예상됐던 sync_cart_dates() RPC 직접갱신이 아니라 재발행(reissue) 방식으로 구현됨).*
