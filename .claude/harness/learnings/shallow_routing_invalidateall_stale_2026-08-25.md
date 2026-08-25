# shallow-routing + invalidateAll() 상호작용 — overrideDetail 낡음 버그 (2026-08-25)

## 증상

`/cms/products`에서 상품 A를 카드 클릭으로 shallow-select(PERF-6, `replaceState` 기반)한 뒤,
그 화면에서 "빠른 재고 등록"(또는 저장·토글·삭제 등 `invalidateAll()`을 호출하는 어떤 동작이든)을
실행하면:
- 서버 데이터는 정상 반영됨(메인 카드 목록의 수량 배지는 정확히 증가)
- 그런데 상세 패널이 A가 아니라 **다른(이전에 봤던) 상품 B의 정보로 튀어버림**
- 정작 A의 재고 목록은 "재고 미등록" 문구가 뜨며 텅 비어 보임

## 근본 원인

`invalidateAll()`이 `load()`를 재실행하는 동안, `+page.svelte`의
`activeSelectedId = $derived('selectedId' in page.state ? page.state.selectedId : data.selectedId)`가
읽는 `page.state`가 **일시적으로 비워진다**(콘솔 계측으로 직접 재현·확인 — `console.log`를
`$effect`/`selectProduct`/`handleInventoryCreated`에 심어 실제 값 추적). 그 순간
`activeSelectedId`가 `data.selectedId`(=원래 `load()`가 기준으로 삼았던 상품, replaceState
연타로 인해 실제 화면과 무관하게 "멈춰있을" 수 있음 — SvelteKit shallow routing은 URL/주소창은
갱신하지만 `load()`가 참조하는 내부 URL은 안 바뀜)로 되돌아가 버려, `overrideDetail`(현재
실제로 보고 있던 상품의 캐시)이 아닌 `data`(엉뚱한 상품)를 직접 노출하는 분기로 빠진다.

## 실패한 접근 2가지 (다시 시도하지 말 것)

1. **`data` 객체 참조 자체를 비교**(`fetchedForData === data`를 캐시 무효화 신호로 사용) —
   `$props()`로 받은 `data`는 참조가 예측 불가능하게 흔들려(Svelte
   `state_proxy_equality_mismatch` 콘솔 경고 발생) 매 렌더마다 재요청되는 무한루프
   (`effect_update_depth_exceeded`)로 즉시 크래시.
2. **`afterNavigate()`로 증가시키는 tick 카운터를 캐시 키에 포함** — 이론상 더 안전해 보였으나
   실제로도 `effect_update_depth_exceeded`로 즉시 크래시. `afterNavigate`가 이 상황에서 예상보다
   훨씬 자주(또는 재귀적으로) 발동하는 것으로 추정 — 정확한 원인은 규명하지 않았으나, 이 패턴
   자체가 위험하다는 결론.

**공통 교훈**: 이 `$effect`(overrideDetail 캐시 관리)에 새로운 반응형 의존성(`data` 참조,
`afterNavigate` tick 등)을 추가해 "언제 재조회해야 하는가"를 일반화하려는 시도는 전부
무한루프 위험이 매우 높다. **effect 자체는 절대 건드리지 말 것.**

## 실제로 통한 최소 수정 (안전, 검증 완료)

effect는 원본 그대로 유지. 대신 "재고 등록이 실제로 일어난 상품 id"를 **`invalidateAll()`이
실행되기 전, 즉 폼 제출이 시작되는 시점**(`ProductDetailPanel.svelte`의 `handleCloneProduct()`
바깥쪽 동기 코드, `const sourceProductId = product.id`)에 **일반 JS 지역변수로 고정**해 콜백
인자로 넘기고, `+page.svelte`의 `handleInventoryCreated(ids, expectedProductId)`가 그 고정된
id로 `selectProduct(expectedProductId)`(기존에 이미 검증된 shallow-routing 선택 함수)를
재호출해 선택 상태를 명시적으로 복구한다.

⛔ 처음엔 `oninventorycreated={(ids) => handleInventoryCreated(ids, rp.id)}`처럼 **템플릿의
reactive `{@const rp}` 참조를 콜백 안에서 그대로 읽는 방식**으로 시도했다가 실패했다 — 이
화살표 함수는 "호출되는 시점"의 `rp.id`를 읽는데, `invalidateAll()` 도중 `rp`(=
`activeDetail.rootProduct`)가 이미 다른 상품으로 뒤바뀐 뒤이므로 잘못된 id가 넘어간다.
**반드시 mutation 시작 시점(await 이전)에 캡처한 plain 값을 넘겨야 한다.**

## 수정 파일

```
src/lib/components/cms/ProductDetailPanel.svelte  (handleCloneProduct — sourceProductId 캡처)
src/routes/cms/products/+page.svelte              (handleInventoryCreated — selectProduct 재호출)
```

## 범위

이번 수정은 "빠른 재고 등록" 경로(`oninventorycreated`)에만 적용된 최소 수정이다(Stephen
"최소 수정으로 진행해줘" 지시). 저장·토글·삭제·코드재반영 등 `invalidateAll()`을 부르는
**다른** 액션들도 이론상 동일 계열의 문제(shallow-select된 상품에서 실행 시 패널이 튈 수 있음)를
가질 수 있으나, 이번 세션에서 실측 재현·수정한 것은 재고 등록 경로 하나뿐이다. 다른 경로에서
유사 증상이 보고되면 동일한 패턴(mutation 시작 시점에 id를 plain 변수로 캡처 → 콜백으로 전달 →
`selectProduct()` 재호출)을 그대로 적용할 것 — 단, 매번 콜백 시그니처에 id를 추가해야 하므로
해당 액션의 콜백들도 이 학습을 참고해 개별 대응 필요.
