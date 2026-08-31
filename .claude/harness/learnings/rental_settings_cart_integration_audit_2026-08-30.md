# 대여관리(`/cms/set/rental`) ↔ 사용자 장바구니(`/cart`) 전역 정합성 정밀 감사 — 2026-08-30

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서의 CRITICAL 미해결 항목(CART-C1~C4)은 CMS 전역
> 정밀 검증 v5에서 전수 재검증됐다 — 최신 판정은 `cms_global_verification_v5_synthesis_
> 2026-08-31.md`(A절) 참고. C1·C3·C4는 FIXED, **C2(대여기간 제한 미연동)는 Stephen 확인으로
> 통합편집기 완성까지 의도적 보류 확정**. 이 문서는 원본 그대로 보존한다.

감사 범위: `/cms/set/rental` 화면의 전체 9개 기능 섹션(대여 기간 조건·대여 방식 옵션·배송
설정·대여옵션 일괄적용/제한·배송료 우대설정·휴무일 제어 옵션·지점 정보 등록·이용안내)이
각각 `/cart`(사용자 장바구니·체크아웃)에서 실제로 그 의도대로 소비되는지 전수 대조.

감사 방법: general-purpose 에이전트 4개 병렬(read-only, 코드 수정 없음) — 각 에이전트가
CMS 설정 화면과 카트 화면 양쪽의 실제 최신 코드(+page.server.ts, +page.svelte, 관련
supabase/migrations/*.sql, src/lib/server/*.ts)를 파일:라인 단위로 직접 대조. 전부 "지금
이 순간의 코드"를 근거로 판정했으며 과거 세션 기록은 재검증 없이 신뢰하지 않았다.

배경: Stephen 요청 — "각 기능성 검진 누락으로 인한 실제 테스트에서 안되는 사용자 기능에서
오류나 버그가 발생하는 일이 절대 없어야 할 것." 이번 감사는 그 목적을 위해 표면적으로
"작동하는 것처럼 보이는" 설정이 아니라 "실제로 카트 계산·렌더링에 연결돼 있는가"를
기준으로 판정했다.

---

## 종합 요약

```
🔴 CRITICAL(즉시 확인 필요) : 4건 — 그중 1건은 법적/약관 동의 리스크
🟡 BOUNDARY(운영 리스크)    : 4건
🟢 ROUTINE(참고/잠재)       : 3건
✅ 정합 확인               : 18개 지점(아래 "정합 확인 전체 목록" 참고 — 전체 커버리지 증빙)
```

가장 시급한 것은 **RSC-C1(필수 동의문 항목 완전 미사용)** — 관리자가 CMS에 동의문을
등록·관리할 수 있는 화면이 멀쩡히 존재하고 DB에 "공개 조회" RLS까지 부여돼 있지만, 실제
체크아웃 어디에도 그 내용이 노출되지 않는다. 법적 근거로 이 기능을 신뢰하고 있었다면
실제로는 전혀 작동하지 않았던 것이므로 최우선 확인이 필요하다.

그다음은 **RSC-C2~C4** — "설정했다고 믿지만 실제로는 카트 계산에 반영되지 않는" 죽은
설정 3건(대여 기간 조건, 방식별 기본 배송비, 배송설정의 "배송요금"). 이 셋은 기능
자체가 고장난 게 아니라 **애초에 카트와 연결된 적이 없는** 구조적 공백이라, "버그 재현"
형태로는 드러나지 않고 관리자가 설정을 바꿔도 아무 변화가 없다는 형태로만 드러난다.

---

## 🔴 CRITICAL

### RSC-C1: 필수 동의문 항목(`rental_consent_items`)이 체크아웃 어디에도 연결되지 않음

```
CMS: src/routes/cms/set/rental/+page.server.ts:43-48, 111-114, 440-480
     (addConsent/deleteConsent/reorderConsents 액션, RPC 3종)
DB : supabase/migrations/20260721000126_126_rental_settings_tables.sql:96-121
     (테이블 생성 시점부터 "공개 조회" RLS 정책 부여 — 애초에 고객 노출 의도로 설계됨)
카트: 없음 — src/routes/cart/+page.server.ts, +page.svelte 전체 grep 결과
     `rental_consent_items`/`RentalConsentItem` 참조 0건
저장소 전역: cms/set/rental 밖의 어떤 라우트(체크아웃·결제·상품상세·계약서)에서도
     이 테이블/타입을 참조하는 코드 없음(전수 grep 확인)
```

체크아웃 화면의 동의 체크박스(`cart/+page.svelte:488, 1154-1159`)는 개별 항목이 아니라
"이용안내에 모두 동의합니다" 형태의 단일 범용 체크박스 하나뿐이며, 그 옆 링크는
`rental_guide_settings.guide_text`(공통 안내문) 모달만 연결돼 있다. 관리자가 CMS에서
"파손 시 배상 책임에 동의합니다" 같은 개별 필수 동의문을 아무리 등록·활성화해도 고객은
그 내용을 한 번도 보지 못한 채 결제까지 진행한다.

**영향**: 이 기능을 약관·법적 동의 근거로 쓰고 있었다면 그 근거 자체가 실제로 작동한 적이
없는 상태다. 코드 수정 없이 리포트만 하며, 원래 의도(체크아웃에 개별 동의문을 노출해야
하는지, 다른 화면을 위해 만들어진 것인지)는 Stephen 확인이 필요하다.

---

### RSC-C2: 대여 기간 제한 옵션(`rental_period_options`)이 카트에 대해 완전히 죽은 설정

```
CMS: src/routes/cms/set/rental/+page.server.ts:154-195 (addPeriod/deletePeriod/reorderPeriods)
카트: src/routes/cart/+page.server.ts, +page.svelte 전체 grep 결과
     `rental_period_options` 참조 0건
```

이 테이블은 `products.allowed_period_ids`(`ProductDetailPanel.svelte:1862`)를 거쳐
오직 **상품상세 화면**(`products/[id]/+page.server.ts:108-119`)에만 흘러가고, 거기서도
`policy-chip` 텍스트 라벨(`products/[id]/+page.svelte:743-754`)로 안내 표시만 될 뿐 실제
선택 가능한 대여기간을 게이팅하는 로직이 아니다. 카트 화면의 대여기간 탭
(`DUR_TYPES`, `cart/+page.svelte:557, 1381-1390`)은 `disabled` + `aria-hidden="true"`인
**읽기전용 UI**이며, CMS 기간 조건과 완전히 무관하게 `12h/24h/1day/purchase` 4개 고정값을
그대로 표시한다.

**영향**: 관리자가 "대여 기간 제한 옵션"에서 항목을 추가/삭제/비활성화해도 카트 화면의
대여기간 표시나 선택지는 전혀 바뀌지 않는다. 관리자는 이 섹션이 카트의 실제 대여기간
정책을 통제한다고 오인할 수 있다.

---

### RSC-C3: `rental_method_options.fee_amount`가 CMS 입력 UI 없이 항상 0 — 그런데 카트는 여전히 이 값으로 방식별 배송비를 계산

```
CMS: +page.svelte 전체 / +page.server.ts:198-217(addMethod) / 
     upsert_rental_method_option RPC(supabase/migrations/20260727000175_175_...sql:4-8)
     — 어디에도 fee_amount·is_free_for_top_grade 입력 파라미터 자체가 없음
DB : fee_amount INTEGER NOT NULL DEFAULT 0
     (supabase/migrations/20260724000156_156_rental_method_options_config.sql:11)
카트: src/routes/cart/+page.server.ts:21(select에 fee_amount는 포함, is_free_for_top_grade는
     select에서 누락) → src/routes/cart/+page.svelte:623, 626-632
     (deliveryFee()가 opt.fee_amount·opt.is_free_for_top_grade를 1순위로 참조)
```

이중 결함이다.
1. `fee_amount`는 CMS에 입력 UI가 아예 없어 항상 DB 기본값 0으로 고정된다. 과거 세션
   기록에 "왕복/반납요금은 rental_shipping_settings로 대체 완료"라는 언급이 있었으나,
   이는 왕복·반납요금(`calcRoundTripFee`/`calcReturnFee`)에만 해당하고 **`deliveryFee()`가
   반환하는 방식별 기본 배송비 자체는 대체되지 않은 채 여전히 fee_amount 의존 상태**다.
   즉 등록된 배송방식이 하나라도 있으면 그 방식의 기본요금은 항상 0원으로 계산된다.
2. `is_free_for_top_grade` 컬럼(Migration #156)은 DB에 존재하고 `deliveryFee()` 코드도
   참조하지만, `cart/+page.server.ts:21`의 select 문자열에 포함돼 있지 않아
   `opt.is_free_for_top_grade`는 런타임에 항상 `undefined`(falsy)다 — 사실상 도달 불가능한
   죽은 분기.

**영향**: 관리자가 "퀵서비스"·"무인보관함" 등 새 방식을 추가해도 그 방식 자체의 기본
배송료를 설정할 CMS 화면이 없다. 실제 청구되는 배송비는 오직 "배송 설정"(RSC-C4 참고,
왕복/반납요금)에만 좌우되며, 관리자가 "이 방식은 5000원인데 왜 카트에서 0원으로 뜨는지"
의아해할 수 있는 구조다.

---

### RSC-C4: "배송 설정"의 `enable_delivery`/`delivery_fee`(편도 배송요금)가 카트 결제 금액에 전혀 반영되지 않음

```
CMS: src/routes/cms/set/rental/+page.server.ts:331-333, 343-351(저장 로직) + +page.svelte
     596 섹션(입력 UI 존재)
카트: src/routes/cart/+page.server.ts:54-67(select·타입 정의만 존재) →
     src/routes/cart/+page.svelte:638-644(타입 선언만 존재)
     → otDeliveryFee 계산식(cart/+page.svelte:772-778)이나 그 어떤 파생 계산에도
     참조되지 않음(전수 grep 확인)
참고 불일치: src/routes/products/[id]/+page.server.ts:151-152의 "예상 배송비" 안내에서는
     이 값이 정상적으로 사용되고 있어, 상품상세 화면엔 안내 문구가 뜨는데 실제 카트
     결제에는 반영 안 되는 안내-실제 불일치 발생 가능
```

`shipping_delivery`(products 테이블, 상품별 플래그)도 서버에서 조회·부모상속까지
정상적으로 이뤄지지만(`cart/+page.server.ts:204, 235, 261-262`), 클라이언트는 타입
선언(`+page.svelte:454`) 외에는 이 값을 전혀 사용하지 않는다.

**영향**: 관리자가 CMS에서 "배송요금(편도)"을 활성화하고 금액을 설정해도 장바구니
결제 금액에는 절대 반영되지 않는다 — 관리자는 설정했다고 믿지만 고객은 그 요금을
청구받지 않는다(매출 누락 방향의 결함). 게다가 상품상세 페이지에는 "예상 배송비"로
안내되는 값이라, 고객이 상품상세에서 본 예상 금액과 실제 결제 금액이 다를 수 있다.

---

## 🟡 BOUNDARY

### RSC-B1: `method_key`를 선택하지 않고 등록된 대여 방식은 카트에서 완전히 비노출되고, 그 위의 "일괄적용" 토글도 무효과

```
CMS: src/routes/cms/set/rental/+page.svelte:329(method_key 미선택 시 ''→NULL 저장 가능)
카트: src/routes/cart/+page.svelte:73-75(isDeliveryLocked, method_key 일치 필수),
     757-762(deliveryTabs 필터도 `o.method_key &&` 조건 필수)
```

관리자가 대여 방식을 추가할 때 5개 칩(방문/퀵서비스/택배·배송/무인보관함/크레이지배송)
중 아무것도 선택하지 않고 이름만 입력해 저장하면 `method_key=NULL`인 레코드가 생긴다.
이런 레코드는 카트의 `deliveryTabs`에 애초에 노출되지 않고, 그 옆의 "대여옵션 일괄적용"
칩으로 `is_bulk_delivery`를 켜봐도 `isDeliveryLocked()`가 `method_key` 일치를 요구하므로
절대 효과가 없다.

**영향**: 관리자가 "방식을 추가했는데 카트에 안 보인다"는 문의를 할 수 있는 지점.
CMS UI에서 method_key 미선택 저장을 막거나 경고하는 처리는 없음.

---

### RSC-B2: 신규/드래프트 카트 아이템의 로컬 기본 수령·반납 방식이 `'crazydelivery'`로 하드코딩 — `restrict_return_delivery` ON 시 체크아웃 마지막 단계에서 원인불명 에러

```
카트: src/routes/cart/+page.svelte:59-64(defaultOptions()),
     111-126(newItemState() — seed?.pickupMethod가 null이면 'crazydelivery'로 폴백)
연관: 상품상세(products/[id]/+page.svelte:471, 488-489)에서 hold/draft 생성 시
     set_reservation_shipment_method를 호출하지 않아 DB에 method가 항상 NULL로 남은
     채 카트에 진입(주석: "체크아웃 승격 시점에 호출")
```

상품상세에서 "예약하기/장바구니"로 담은 모든 신규 항목은 카트 진입 시 로컬 상태값으로
`crazydelivery`(배송 계열)를 갖게 된다. `restrict_return_delivery`가 ON이면 이 값은
`visibleTabs`에서 제외돼 화면상 **어떤 탭도 활성화 표시가 안 되는 애매한 상태**로
남는데, `canProceed`(`cart/+page.svelte:494-517`)는 수령/반납 방식이 실제로 선택됐는지
검증하지 않는다. 사용자가 다른 탭을 명시적으로 클릭하지 않고 날짜·시간만 채워 "예약신청
완료"를 누르면 `saveShipmentMethod`가 `'crazydelivery'`를 그대로 전송 →
`set_reservation_shipment_method`의 서버 가드(Migration #373)가 거부 → "수령/반납 방식
저장에 실패했습니다. 방식을 다시 선택해주세요." 에러로 체크아웃이 막힌다.

**영향**: 완전한 silent failure는 아니지만(에러 메시지는 뜸), 사용자 입장에선 "아무것도
잘못 고른 적 없는데 왜 막히는지" 원인 파악이 어려운 UX 데드엔드다. `restrict_return_
delivery`를 켠 이후 신규 유입 고객 전원이 겪을 수 있는 구조적 리스크.

---

### RSC-B3: 휴무일 캘린더 제한이 "택배 여부"가 아니라 `is_bulk_delivery`(요청 A 토글) 플래그 하나에 완전히 종속

```
CMS: rental_method_options.is_bulk_delivery — "대여옵션(수령/반납) 일괄적용" 칩
     (+page.svelte:533, {#each methods as m} — 등록된 모든 방식이 대상, courier
     여부 필터 없음)
카트: cart/+page.svelte:1637(locked = isDeliveryLocked(props.method)),
     1716-1718(isDateDisabled가 !locked면 무조건 통과)
```

휴무일 캘린더 제한은 원래 "택배사(courier) 의존 방식"에 걸려야 한다는 설계 의도(각
배송방식마다 별도 마감시각이 존재하는 정책과 일맥상통)와 달리, 실제로는 원래 다른 목적
(수령=배송 선택 시 반납을 강제로 같은 값으로 복사하는 "요청 A")을 위해 만들어진
`is_bulk_delivery` 플래그 하나에 완전히 종속돼 있다.

① 관리자가 `crazydelivery`만 bulk 토글하고 `epost`/`quick`/`delivery` 등 실제 택배사
배송 방식은 토글하지 않으면, 그 방식들은 공휴일·일요일에도 날짜 선택이 막히지 않아
고객이 택배가 오지 않는 날짜를 정상 선택할 수 있다.
② 반대로 관리자가 실수로 "방문수령(visit)" 같은 무관한 방식을 bulk 토글하면(UI가 이를
막지 않음), 택배와 무관한 방문 방식에까지 공휴일 휴무 캘린더 제한이 잘못 걸려 방문
가능일이 부당하게 차단될 수 있다.

**영향**: 실제 발현 여부는 현재 운영 DB의 `is_bulk_delivery` 설정값 조합에 좌우된다 —
설정을 잘못하면 고객이 배송 불가능한 날짜에 주문하거나, 반대로 정상 가능한 방문일에
주문을 못 하게 될 수 있다.

---

### RSC-B4: 상품 조합에 따라 `allowed_method_ids` 교집합이 완전히 비어(`'none'`) 카트에 배송방식 탭이 하나도 안 뜰 수 있음

```
카트: cart/+page.svelte:740-752(computeAllowedMethodIds — 여러 상품의
     allowed_method_ids 교집합, 하나라도 비지 않으면 'none' 가능)
```

상품이 대여정책을 아예 설정하지 않은 경우 카트는 전체 배송방식을 노출한다(`'all'`
폴백, 의도된 설계). 하지만 서로 다른(겹치지 않는) `allowed_method_ids`를 가진 상품
여러 개가 한 카트에 담기면(예: A상품=방문만 허용, B상품=택배만 허용) 교집합이
`'none'`이 되어 `deliveryTabs`가 완전히 비고, 카트 화면에는 배송방식 탭 자체가 하나도
뜨지 않는다. 코드상 이 상황을 안내하는 별도 문구는 없다.

**영향**: 극단적이지만 실제로 발생 가능한 UX — 고객은 왜 배송방식을 하나도 선택할 수
없는지 이해하지 못한 채 체크아웃이 막힌다.

---

## 🟢 ROUTINE / 참고

### RSC-R1: `pickup_points.contact_person`은 어떤 고객 화면에도 select되지 않음 — 의도된 설계로 확인, 문제 아님

카트(`cart/+page.server.ts:31`)와 상품상세(`products/+page.server.ts:98`,
`new/+page.server.ts:55`) 모두 select 문자열에 `contact_person`을 포함하지 않아 노출
경로가 구조적으로 없다. 관리자 내부 참고용 필드로만 설계된 것이 코드로 확인됨 —
버그 아님.

### RSC-R2: 임시휴무일 "수정" RPC 경로에서 `name` 컬럼 미갱신 — 현재는 도달 불가능, 향후 UI 추가 시 잠재 결함

```
DB: Migration 335:102-110 — UPDATE ... SET date=p_date, note=p_note ... (name 컬럼 미포함)
CMS: addManualHoliday/deleteManualHoliday 액션만 존재, p_id≠null(수정) 경로를 호출하는
     UI 없음(+page.server.ts:375-402)
```

현재는 이 RPC의 "수정" 분기를 트리거하는 CMS 버튼이 없어 실사용자 영향은 없다. 다만
향후 "임시휴무일 수정" UI가 추가되면, 수정 시 `note`만 갱신되고 `name`은 갱신 안 돼
카트의 휴무 사유 문구가 옛 값(또는 기본값 '임시휴무일')으로 고착되는 잠재 결함이 된다.
참고용으로만 기록.

### RSC-R3: 마이그레이션 파일명 번호 충돌(383) — 이미 해소 완료(기록용)

이번 세션 중 "배송료 우대설정 최대5개" 마이그레이션이 같은 날 다른 세션의 파일과 번호
383을 완전히 동일하게 사용한 충돌이 발견돼, `385_delivery_fee_discount_tiers_max5.sql`로
즉시 재명명 완료(DB 함수 내용 자체는 무변경). 이 리포트 작성 시점 기준으로는 이미 해결된
사안이라 조치 불필요, 이력 기록용으로만 남김.

---

## 정합 확인 전체 목록 (✅ — 전체 커버리지 증빙)

문제가 발견되지 않은 지점도 "검진 누락"이 없었음을 보이기 위해 전부 기록한다.

| # | 기능 | CMS 지점 | 카트 지점 | 비고 |
|---|---|---|---|---|
| 1 | 대여 방식 `method_key` 매칭 | `+page.svelte:26-32`(고정 5칩 강제) | `cart/+page.svelte:30,67`(`DeliveryMethod` 유니언) | CMS가 자유 텍스트를 허용하지 않아 카트가 모르는 값이 생성될 수 없음 |
| 2 | `is_bulk_delivery` 토글(병합 후) | `+page.svelte:526-585`(병합된 `.bulk-delivery-section`) | `cart/+page.svelte:73-75, 331-368, 763-771` | 2026-08-30 레이아웃 병합 후에도 개별 `<form>`·상태 바인딩 유지 확인 |
| 3 | `allowed_method_ids` ID 체계 | `cms/products/+page.server.ts:97`, `ProductDetailPanel.svelte:260,1863` | `cart/+page.server.ts:19-25`, `+page.svelte:740-752` | 동일 테이블·동일 PK(UUID) 공유, 다른 ID 체계 참조 없음 |
| 4 | 자식(재고) 상품의 `allowed_method_ids` 상속 | products.md §4-1 부모전용 원칙 | `cart/+page.server.ts:222-267`(부모 폴백 조회) | 폴백 없으면 전체 상품이 오판정될 위험 있었으나 방어됨 |
| 5 | `allowed_method_ids` 미설정 폴백 | — | `cart/+page.svelte:740-752`(`'all'`) | 의도된 폴백(단, RSC-B4 극단 케이스 존재) |
| 6 | `allowed_pickup_ids` ↔ `pickup_points.id` | 동일 패턴 | `cart/+page.svelte:789-806` | ID 체계 일치 |
| 7 | 지점 비활성화/삭제 즉시 반영 | `+page.server.ts:309-319` | `cart/+page.server.ts:29-35` | 캐시 없이 매 SSR 요청 실시간 재조회 |
| 8 | 왕복요금(`enable_round_trip`/`round_trip_fee`) | `+page.server.ts:343-351` | `cartShippingFee.ts:28-39` | null-safety·OR판정·보수적 미적용 규칙 전부 코드 일치 |
| 9 | 반납요금(`enable_return`/`return_fee`) | 동일 | `cartShippingFee.ts:46-57` | 왕복요금과 완전 독립 판정 |
| 10 | 상품별 `shipping_round_trip`/`shipping_return` 플래그 | `ProductDetailPanel.svelte:1865-1867` | `cart/+page.svelte:646-656` | `?? true` 기본값 + 부모상속 정상 |
| 11 | `restrict_return_delivery` 양쪽 콤보 숨김 | `+page.server.ts:255-261` | `cart/+page.svelte:642, 769-771` | 수령·반납 둘 다 배송류 제외, 데드엔드 재발 없음 |
| 12 | "요청 A" 강제복사 vs restrict 충돌 방지 | 동일 | `cart/+page.svelte:331-342` | 배송류 탭 자체가 없어 강제복사 트리거 불가 |
| 13 | `set_reservation_shipment_method` 서버 가드 | Migration #373:36-50 | `cart/+page.svelte:693-699` | 수령·반납 둘 다 검증, API 직접호출 우회도 방어 |
| 14 | `saveShipmentMethod` 실패 시 UI 알림 | 동일 RPC | `cart/+page.svelte:203-214, 1236-1240` | 과거 silent-failure 수정 유지 확인 |
| 15 | `sale_only` 컬럼 전파(3곳) | — | `cart/+page.server.ts:204,235-245,263` | select·부모상속·클라이언트 타입 전부 연결 |
| 16 | `discount_rate` 문자열↔숫자 매핑 | `+page.server.ts:508-510` | `cartShippingFee.ts:74` | 문자열은 서버 액션에서만 다루고 DB·카트는 항상 숫자 |
| 17 | `otDeliveryFee` 최종 계산식 순서 | — | `cart/+page.svelte:772-778` | (방식별+왕복+반납) × (1-할인율) 순서 정확 |
| 18 | 조건 다중선택 AND결합 + 항목별 OR판정 | — | `cartShippingFee.ts:94-95,105` | `some()`/`every()` 조합 정확히 구현 |
| 19 | 마스터 휴무토글(`enable_prev_day_check`) 위계 | `+page.svelte:723-729,734,741` | `courierClosedDates.ts:26` | 마스터 OFF시 하위값 무관하게 완전 스킵 |
| 20 | 법정공휴일 `is_active=false` 배제 | `+page.svelte:787-789`(비활성 배지) | `courierClosedDates.ts:38` | 안내 문구와 실제 쿼리 조건 일치 |
| 21 | 국경일/임시휴무 사유 병합 | Migration 335 | `courierClosedDates.ts:37-44` | 뒤바뀜·빈문자열 없음 |
| 22 | 일요일 자동 휴무 + 기존 사유 우선순위 | `+page.svelte:736` | `courierClosedDates.ts:46-58` | 대체공휴일 사유가 일요일 표시보다 우선 유지 |
| 23 | 공통 대여 안내문(`guide_text`) | `+page.server.ts:424-437` | `cart/+page.server.ts:43-47`, `+page.svelte:1321-1332` | 이용안내 모달에 정상 렌더링 |

---

## 권장 조치 우선순위

```
1순위(법적 리스크 확인) : RSC-C1 — 필수 동의문 항목이 애초에 체크아웃과 연결될 계획이었는지
                          Stephen 확인 필요. 만약 그렇다면 별도 구현 아젠다로 분리 필요.
2순위(설정 무효 확인)   : RSC-C2·C3·C4 — 세 죽은 설정 중 실제로 운영에서 값을 넣어둔 게
                          있는지 먼저 DB 조회로 확인(값이 없으면 당장 실피해는 없음, 있다면
                          관리자가 "설정했는데 안 먹힌다"를 이미 겪고 있었을 가능성).
3순위(운영 설정 점검)   : RSC-B1·B3 — 현재 rental_method_options의 method_key·
                          is_bulk_delivery 실제 값을 점검해 RSC-B1(NULL method_key 방식
                          존재 여부)·RSC-B3(courier 아닌 방식에 bulk 토글이 잘못 켜져
                          있는지) 즉시 확인 가능.
4순위(UX 보완 검토)     : RSC-B2·B4 — 코드 변경이 필요한 사안, 별도 아젠다로 분리해 GATE 0
                          거쳐 진행 권장.
참고만                  : RSC-R1·R2·R3 — 조치 불필요.
```

---

*rental_settings_cart_integration_audit_2026-08-30.md | 감사 대상: `/cms/set/rental`
전체 9개 섹션 ↔ `/cart` 연동 | read-only 정적 코드 감사(4개 병렬 에이전트) | 코드 수정
없음 — 발견사항 전부 Stephen 확인·판단 대기*
