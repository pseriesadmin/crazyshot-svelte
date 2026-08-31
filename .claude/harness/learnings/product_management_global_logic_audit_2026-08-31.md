# 상품등록관리(/cms/products, /cms/products/new) 전역 코드 감사

> ⚠️ **상태 업데이트(2026-09-01)**: 이 문서 작성 이후 신규 도입된 옵션 상품 전용(option_only,
> §2-12) 기능은 CMS 전역 정밀 검증 v5에서 별도로 전 계층 재검증됐다(이슈 없음, CLOSED) — 상세는
> `cms_global_verification_v5_synthesis_2026-08-31.md`(B-1절) 참고. 이 문서는 원본 그대로 보존한다.
2026-08-31 | 조사범위: +page.svelte/+page.server.ts(목록) · ProductDetailPanel.svelte ·
new/+page.svelte·+page.server.ts · loadSelectedProductDetail.ts · productSearchIndex.ts

Explore 에이전트 3개(목록화면 / ProductDetailPanel.svelte / 신규등록+공용RPC) 병렬 전수조사 +
HIGH·MEDIUM 항목 직접 코드 재확인 후 작성. 이번 세션에서 수정한 `option_only` 토글·가격
"0" 버그 수정·IME 안전 필터링·우측정렬·toggle-row 재구성 5건의 정합성도 함께 검증했다.

## 🔴 HIGH

**H-1. ProductDetailPanel.svelte:343-375 — content/keywords 재동기화 누락**
상품 prop 재동기화 `$effect`가 localImages·localSpecs·localComponents·localSlug·localBasic·
배송옵션·localPricing·localSaleOnly·기간/방법/픽업ID·localOptions는 전부 재동기화하지만
`localContentBlocks`/`localKeywords`(928-929행)만 누락돼 있었다. 부모(`+page.svelte` 644/733행)가
`{#key activeSelectedId}`로 감싸 "다른 상품 선택" 시나리오는 리마운트로 방어되지만, **같은
상품에서 다른 탭을 저장해 invalidateAll이 발생하는 경우**엔 리마운트가 없어 콘텐츠 탭의
미저장 로컬 편집이 조용히 그대로 남아 있었다 — products.md §4-2 "다른 탭 저장 시 미저장 내용
초기화 + 경고 토스트" 설계와 어긋남(토스트는 뜨지만 실제로는 초기화되지 않음).
→ **수정 완료**: `$effect` 안에 `localContentBlocks = parseContentBlocks(product)` /
`localKeywords = parseKeywords(product)` 2줄 추가.

## 🟡 MEDIUM

**M-1. ProductDetailPanel.svelte — isDirtyPricing damage_fee_percentage 타입 불일치**
`localPricing.damage_fee_percentage`는 `String(...)`로 초기화되지만 실제 입력은
`type="number" bind:value`라 사용자가 값을 건드리는 순간 런타임 타입이 number로 바뀐다.
`origPricing`은 항상 string이라 `!==` 비교가 저장 후에도 영구히 true가 될 수 있어 저장
버튼이 계속 "미저장" 상태로 보일 위험이 있었다.
→ **수정 완료**: `isDirtyPricing` 비교 시 `Number()`로 정규화.

**M-2. sale_price "0" 저장 시 조용히 null로 유실**
이번 세션에 12h/24h/monthly/보증금/연체료의 "0 입력 시 지워지는 버그"는 고쳤으나
`sale_price`는 서버에서 여전히 `parseInt(x,10) || null` 패턴이라 클라이언트가 이제 정확히
보존하는 "0"이 서버에서 null로 조용히 버려지고 있었다. 기존 상품수정 경로의 12h/24h/monthly
priceMap도 동일하게 `|| null`이라 24h 필수체크가 정당한 0을 blank와 혼동할 소지가 있었다.
→ **수정 완료**: 빈 문자열과 "0"을 구분하는 NaN 기반 파싱으로 양쪽 파일 모두 교체.

**M-3. +page.server.ts(목록) — price_rules/가격 UPDATE 다수 .error 미체크**
sale_price/sale_only UPDATE, duration_type별 update/insert/soft-delete 루프 전체가
`.error`를 확인하지 않아 부분 실패가 서버·클라 양쪽에서 보이지 않았다.
→ **수정 완료**: 각 DB 호출에 `.error` 체크 + 실패 시 `fail(500, ...)` 반환 추가.

**M-4. cloneProduct N+1 쿼리 패턴**
`add_inventory`/`new_product` 두 분기 모두 항목당 슬러그유니크루프+INSERT+코드RPC(+재시도)+
가격+옵션링크로 5~7회 순차 쿼리 — 20개 일괄등록 시 100회 이상 쿼리. 정합성 문제는 아니라
이번 세션에서는 구조를 바꾸지 않고 현황만 기록한다(슬러그 유니크 검사·코드 채번은 순서
보장이 필요해 단순 배치화가 위험할 수 있음 — 별도 세션에서 전용 리팩터링 검토 권장).

**M-5. products.md §2-12 문서 공백 (확인됨)**
`products.md`는 §2-9→§2-10→§2-11 다음 바로 §3으로 넘어가 §2-12 자체가 없었다. 그런데
`new/+page.svelte`, `ProductDetailPanel.svelte` 두 코드 주석이 이 존재하지 않는 절을 근거로
인용 중이었다. `option_only` 기능(의미·카탈로그 제외 범위·부모자식 상속 규칙) 자체가
products.md 어디에도 문서화되어 있지 않았다.
→ **수정 완료**: products.md에 §2-12 신설.

## 🟢 LOW / 정보성 (백로그 — 이번 세션에서 미수정)

- L-1. `deleteProduct`(+page.server.ts) — 대상 존재 확인 없이 진행, 없는 productId 호출도
  success 반환
- L-2. 권한 게이팅 비일관 — `reassignCodeSeries`만 manager+ 체크, delete/clone 등 파괴적
  액션은 세션만 체크 (security-auth.md 대조 필요)
- L-3. "부모 재고 0개 시 자동 OFF" 로직이 부모별 순차 count+update 쿼리(배치화 가능)
- L-4. Orphaned CSS — `ProductDetailPanel.svelte` 21개 클래스(btn-cancel/btn-edit/field-row
  등 구 뷰/편집 폼 레이아웃 잔재로 추정), `new/+page.svelte` 2개(`.field-hint`/`.f-textarea`,
  이번 세션 이전부터 존재)
- L-5. `damage_fee_percentage` 필드가 `name="_unused_dmg"`로 명명되어(hidden input과 충돌
  방지 목적, 의도적) 유지보수 시 혼동 소지
- L-6. `blockChildInputFocus`가 BUTTON 요소는 막지 않음 — 현재는 TABS 필터링으로 자식상품이
  해당 탭에 도달 자체가 불가해 실질 위험 없음, 향후 게이팅 완화 시 재점검 필요

## ✅ 확인 결과 문제없음

- `$state(prop)` 초기화 안티패턴 없음(`searchInput` 등 전부 `$effect` 재동기화 정상)
- PAGE-SCOPE-1(페이지네이션 범위 밖 대표상품 집계 오류) 재발 없음
- 8개 form action 전부 호출 지점 존재, 고아 액션 없음
- `option_only`/`sale_only` 부모→자식 상속이 항상 함께 처리됨(`loadSelectedProductDetail.ts`,
  `cloneProduct` 양쪽 분기)
- 이번 세션 수정 5건(option_only 배선, 가격 기본값 `''` 복원, IME-safe 필터링 6개 필드,
  우측정렬 6개 필드, toggle-row 구조 변경) 전부 코드와 설명이 정확히 일치, 상호 회귀 없음
- `toggle-btn`/`toggle-wrap`/`toggle-thumb` CSS는 이번에 추가한 두 토글 외 다른 용도로
  재사용되지 않아 충돌 없음
- pricing/option_only 관련 `.find()` 호출 전부 옵셔널 체이닝 + 기본값 처리, 무가드 접근 없음
- 자식(재고) 상품 선택 시 history 탭 제외 읽기전용 게이팅 정상 유지, 이번 세션 편집으로 인한
  회귀 없음

## 이번 세션 처리 결과

H-1 + M-1 + M-2 + M-3 + M-5 수정 완료(아래 참고). M-4는 구조 변경 없이 현황만 기록.
L-1~L-6은 백로그로 유지 — 별도 확인 후 진행.
