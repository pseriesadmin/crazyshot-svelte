# products.md — 상품 관리 표준 정책
# Harness Flow v3.2 | 2026-08-06 품번(product_code) 정책 전면 재설계 반영

---

## 1. 상품 구조 (부모 / 자식)

```
부모 상품 (parent_product_id IS NULL)
  → CMS 상품 목록에 노출되는 상품 정의 단위
  → 가격·설명·이미지·대여정책 등 모든 정보의 원본

자식 상품 (parent_product_id IS NOT NULL = 부모 ID)
  → 동일 상품의 개별 재고 단위 (inventory unit)
  → 예약 시 실제로 할당되는 자산 (1예약 = 1자식)
  → CMS 인벤토리 아코디언에서만 관리 (고객 직접 노출 없음)
```

**쿼리 원칙:**
```typescript
// ✅ 상품 목록 — 부모만
.is('parent_product_id', null)

// ✅ 인벤토리 아코디언 — 자식만
.eq('parent_product_id', rootId)

// ❌ 금지: 부모+자식 혼합 조회
.or(`id.eq.${rootId},parent_product_id.eq.${rootId}`)
```

**삭제 정책 (2026-08-05 확정 — cascade):**
```
부모 삭제(deleteProduct) → 그 부모의 활성 자식(재고) 전체가 함께 소프트삭제됨
  (자식만 따로 삭제해도 부모는 그대로 — 부모 삭제 시에만 자식까지 연쇄 삭제, 반대는 아님)
이유: 자식이 고아 상태로 남으면 CMS 화면엔 안 보이는데 is_active=true라 예약 배정 대상으로는
     계속 남는 위험한 상태가 됨(그 자체로 별도 문제였던 버그, 지금은 해소됨)
```

---

## 2. ⛔⛔⛔ 품번(product_code) + QR 정책 (2026-08-06 전면 개정 — 핵심, 위반 즉시 중단)

> ⚠️ 이 섹션은 2026-08-06 세션에서 근본적으로 재설계됐다. 예전 버전(부모·자식 모두 독립 품번+QR을
> 즉시 받는다는 정책)은 더 이상 유효하지 않다 — 아래 내용이 유일한 현재 정책이다.

### 2-1. 부모 = 품번 없음 / 자식 = 실제 품번 (Stephen 확정 정책)

```
부모 상품 (parent_product_id IS NULL)
  → product_code는 절대 부여되지 않는다 (영구히 NULL)
  → 대신 "이 상품이 앞으로 어떤 품번 체계를 쓸지"만 code_series(JSONB)에 저장
     예) {"category_code":"LENCOM","year_month":"2608","prefix":"CS","suffix":"","seq_digits":3,"max_sequence":null}

자식 상품 (parent_product_id IS NOT NULL)
  → "빠른 재고 등록"으로 생성되는 순간, 부모의 code_series를 읽어 실제 product_code를 채번
  → 이 채번이 실물에 부여되는 진짜 품번(스티커·QR에 인쇄되는 값)

❌ 절대 금지: 부모 상품에 product_code를 채번/기록하는 코드 추가
❌ 절대 금지: "품번 재발행" 기능 신설 (아래 2-2 불변 정책과 충돌)
```

**왜 이렇게 설계했는가**: 부모는 카탈로그성 대표정보일 뿐 실물이 아니다. 실물(재고단위)에만
품번이 붙어야 "이 스티커 = 이 카메라 한 대"라는 1:1 대응이 보장된다.

### 2-2. 품번 영구고정 정책 — 주민등록번호처럼 불변

```
한번 자식에게 발급된 product_code는:
  ⛔ 절대 재사용 불가 (그 자식이 삭제돼도 번호는 영구 퇴역)
  ⛔ 카테고리를 변경해도 재발급되지 않음 (그대로 유지)
  ⛔ "재발급" 기능은 존재하지 않음 — 새 품번이 필요하면 신규 등록만 가능

보장 메커니즘: product_code_sequences.next_seq는 진짜 단조증가 카운터
  (INSERT...ON CONFLICT DO UPDATE SET next_seq = next_seq + 1 / 삭제된 행 기준 재계산 안 함)
  + products.product_code UNIQUE 제약(예외조건 없음) + 삭제는 항상 소프트삭제(코드 안 지움)
  → 이 3중 보장으로 재사용이 구조적으로 불가능
```

### 2-3. 채번 흐름 (함수명 그대로 유지 — TypeScript 호출부는 안 바뀜)

```
1. 부모 등록 시 → generate_product_code(product_id, category, [code_id], [date_option, max_sequence])
   → 카테고리/콤보 코드 해석 + 포맷 결정까지만 하고 code_series에 JSON 저장
   → product_code_sequences 순번은 이 시점에 소모하지 않음

2. "빠른 재고 등록"(cloneProduct add_inventory) 시 → generate_inventory_product_code(child_id, parent_id)
   → 부모의 code_series를 읽어 product_code_sequences 순번을 실제로 소모 + 자식 product_code에 기록
   → 부모에 code_series가 없지만 기존 product_code는 있는 "레거시 부모"(정책 이전 등록분)는
     그 문자열을 즉석 파싱해 동일하게 동작(Migration 194 — 레거시 데이터 자체는 손대지 않음,
     호출할 때마다 파싱만 함)

⚠️ 레거시 파싱 폴백의 한계(2026-08-XX 실사용 중 확인): prefix가 관례값 'CS'가 아닌 레거시 부모는
   파싱 자체가 실패한다(예: 'PC' 접두사). 이 경우 UI("품번 채번" 버튼, +page.server.ts
   retryProductCode)가 실패 시 자동으로 generate_product_code(현재 전역/카테고리 기본 포맷 기준)를
   호출해 정식 code_series를 새로 설정한 뒤 1회 재시도하는 방식으로 우회한다.
   → 이 경우 신규 자식의 품번 구조가 그 부모의 옛 1회성 레거시 코드와 형식이 달라질 수 있다
     (예: 부모 CSPAR00000 / 신규 자식 CSPARall00001 — year_month 유무 차이).
     **Stephen 확정(A안): 그대로 유지** — 부모의 과거 1회성 포맷을 억지로 흉내내지 않고,
     지금부터 등록되는 자식은 현재 표준 포맷을 따른다. 문자열만으로 접두사/카테고리/날짜
     경계를 100% 정확히 역산할 방법이 없어(구분자 없는 연결 문자열) 완벽한 형식 일치보다
     신뢰성(항상 성공하는 채번)을 우선한다.

⚠️ "신규 상품 등록"(products/new) 자체가 자동으로 위 2번을 한 번 실행한다 — 부모 INSERT +
   code_series 저장 직후 auto_create_inventory_for_product RPC가 자동으로 자식(재고) 1개를
   만들고 그 자식에게 실제 품번을 채번한다. 즉 "상품 등록"을 완료하는 순간 카탈로그 항목뿐
   아니라 실제로 대여 가능한 재고 1개가 이미 존재한다 — 재고를 늘리려면 그 다음부터
   "빠른 재고 등록"을 추가로 사용한다.

   ✅ **Stephen 확정(2026-08-14): 이 자동생성 1개를 "기본 재고" 개념의 정상 기능 정책으로
   확정한다.** 부모상품 등록 완료 시 최초 자식(재고) 1개가 자동으로 함께 생성되는 것은 버그가
   아니라 의도된 설계다 — 향후 세션에서 "왜 자식이 자동으로 생기냐"는 의문이 들어도 이 동작
   자체를 제거·비활성화하는 수정을 임의로 시도하지 말 것. 변경이 필요하다고 판단되면 반드시
   Stephen에게 먼저 확인한다(관련 RPC: `new/+page.server.ts`의 `auto_create_inventory_for_product`
   호출부, 실패 시 경고 처리는 §2-10① regWarn `inv` 참고).
```

```sql
-- generate_product_code 호출 시 반드시 3개 인자 전부 명시(2-param 호출 절대 금지)
-- p_code_id를 생략하면 PostgREST가 2-param/3-param(default) 오버로드를 구분 못해
-- PGRST203(모호성) 에러 발생 — 2026-08-06 실제 curl 테스트로 확인된 라이브 버그, 이미 수정됨
await admin.rpc('generate_product_code', {
  p_product_id: product.id,
  p_category: category,
  p_code_id: null,   // ← 콤보 미선택이어도 반드시 명시
})
```

> ⚠️ **설정 키 분리(Migration #248, 2026-08-14)**: `generate_product_code()`(전 오버로드)가 읽는
> 전역 기본 포맷(prefix/date_format/seq_digits/reset_monthly/suffix)은 `cms_settings.product_code_format`
> 전용 키다. 과거에는 예약코드 전용 설정인 `reservation_code_format`을 그대로 공유해서 읽었는데
> (§2-6 이하 예약코드 로직과 완전히 다른 목적), CMS "예약코드 형식" 탭에서 값을 바꾸면 신규 상품
> 채번 기본값도 안내 없이 같이 바뀌는 숨은 결합이었음 — 분리로 해소. 단, 이번 분리는 백엔드
> 전용이라 `product_code_format`을 직접 편집할 수 있는 CMS 화면은 아직 없다(분리 시점 값으로
> 고정, 필요 시 별도 관리 화면 신설 검토).

### 2-4. QR 콘텐츠 — URL이 아니라 품번(product_code) 원문 + 카테고리 병기 (2026-09-17 갱신)

```
❌ 예전 정책(폐기): QR = 'https://crazyshot.kr/qr/product/' || id
✅ 현재 정책(신버전): QR = `${product_code}|${category}` (파이프 구분자로 카테고리 병기)
✅ 구버전 스캔 하위호환: QR = product_code 원문 텍스트만 (파이프 없음 — 기존 인쇄 QR 그대로 동작)

이유(Stephen): "QR 코드 자체 내에 상품품번이 담겨있어야 함. 링크값은 굳이 필요 없음 —
링크가 변동될 수도 있음." (원 정책 유지)
카테고리 추가 이유(2026-09-17): 스캔 시 카테고리 정보를 바로 알 수 있어 반출입 흐름에서
의사결정이 빨라짐. DB 조회 없이도 상품 계열을 즉시 파악 가능.

파이프 페이로드 정책:
  · 생성 함수: buildProductQrPayload(productCode, category) → `${productCode}|${category}`
    (src/lib/utils/qrIssue.ts, 2026-09-17 신설)
  · 상품 QR 생성 지점 전부(ProductDetailPanel·일괄인쇄·향후 신규 지점 포함)는 이 함수 경유
  · 예약·회원·계약서명 QR은 payload 포맷 무변경(파이프 미사용)

파싱 하위호환 정책 (extractProductId, src/lib/utils/qrProductId.ts):
  · 파이프(|) 있음 → 첫 파이프 앞부분만 product_code로 추출 (신버전)
  · 파이프 없음 → 기존 분기 그대로 통과 (구버전 원문·URL 패턴 모두 정상 동작)
  ⛔ 구버전 QR 스티커를 재발행할 필요 없음 — 스캔 측에서 투명하게 처리됨
```

```svelte
<!-- ProductDetailPanel.svelte — renderQrToCanvas/downloadQrWithLabel (2026-09-17 이후) -->
<!-- 자식 패널: {#if isChildProduct} 블록에서만 QR 캔버스 렌더링 -->
{#if isChildProduct}
  {#if product.product_code}
    <canvas bind:this={canvasEl} width="300" height="300"></canvas>  <!-- 버퍼 300×300 -->
    <button onclick={downloadQR}>↓ QR 저장</button>
  {:else}
    <div class="qr-placeholder">QR</div>  <!-- 자식인데 아직 채번 안 됨 -->
  {/if}
{/if}
<!-- CSS: .qr-wrap canvas { width:88px; height:88px } — 화면 표시크기는 88px 고정 유지 -->
```

> ⛔ **BND-7 폐기(QR-HIDE-1, 2026-08-XX 확정)**: 부모는 실물 재고 단위가 아니므로 QR을 **표시하지
> 않는다** — 2026-08-06 이전에 등록돼 자체 `product_code`를 가진 레거시 부모도 예외 없음(§8-A
> "유령 재고" 문제와 별개로, QR 노출 자체는 항상 숨김). QR은 오직 자식(재고)에게만 노출 —
> "QR = 실물 스티커"라는 §2-1 설계 원칙과 일치시키기 위함.

> ℹ️ **QR-LABEL-2(2026-08-XX)**: 부모 화면에는 QR 대신 텍스트로 "기준 품번"을 병기하되,
> `rp.product_code` 원문을 그대로 노출하지 않는다(`baseCodeDisplay()`,
> `/cms/products/+page.svelte`). 실제 채번돼 재고로 카운트되는 자식 품번과 혼동되지 않도록,
> `code_series`가 있으면 그 구조(prefix+category_code+date_part)에 순번만 `0`으로 자리수만큼
> 패딩해 "이 계열은 이런 형식으로 채번됩니다"라는 예시 형태로 재구성하고, `code_series` 없이
> 레거시 `product_code`만 있는 부모는 그 문자열의 마지막 3자리(순번 추정 자리)만 `000`으로
> 치환해 보여준다 — 어느 경우든 실제 발급된 값 그대로는 노출하지 않는다.
>
> ✅ **QR-LABEL-2 수정(2026-08-16, Stephen 확정)**: 위 마스킹 원칙은 2단 계층(`parent_seq_digits`
> 존재) 부모의 **기본순번(순번1) 구간에는 더 이상 적용하지 않는다.** 기본순번은 부모 등록 시점에
> `product_parent_sequences`에서 이미 원자적으로 확정·불변 채번된 실제값(§2-2 영구고정 정책
> 적용 대상)이라, 자식마다 새로 채번되는 순번2와 달리 "혼동 위험"이 없다 — 오히려 마스킹하면
> 동일 카테고리 부모상품끼리 전부 `...0000000`으로 똑같이 보여 구분이 안 되는 역효과만 있었다
> (production 실사례: SONY FX3=`parent_seq 1`, EEEE=`parent_seq 2`인데 화면엔 둘 다
> `CSCRDSL0000000`으로 동일하게 노출됨 — Stephen 발견·보고). 수정 후 `baseCodeDisplay()`는
> 기본순번 구간을 `code_series.parent_seq` 실값으로 0-패딩해 표시하고(예: `CSCRDSL0010000`),
> 자식순번(순번2) 구간은 기존대로 계속 `0` 마스킹 유지한다. 2단 계층이 아닌(기본순번 개념
> 없는) 상품은 이번 수정과 무관 — 기존 마스킹 그대로.

```typescript
// QR $effect — buildProductQrPayload 기준 (2026-09-17 이후)
$effect(() => {
  const payload = product.product_code
    ? buildProductQrPayload(product.product_code, product.category)
    : null
  const canvas = canvasEl
  if (!payload || !canvas) return
  renderQrToCanvas(canvas, payload)
})
```

**모바일 스캐너 하위호환**: `src/routes/cms/mobile/+page.svelte`의 `identifyQrPayload()`는
(1) 파이프 포함 신버전(`CSCRDSL0010000|LENS`) → product 타입, product_code 부분만 추출,
(2) 파이프 없는 구버전 순수 품번(`CSCRDSL0010000`) → product 타입, 원문 그대로,
(3) 기존 URL 패턴(`.../qr/product/{uuid}`) → product 타입, uuid 추출,
(4) 예약코드(`CS2609001`, `CZ-xxxxx`) → reservation 타입, 신규 라우트로 라우팅,
(5) 회원코드(`/qr/member/{code}`) → member 타입으로 각각 판별한다.
`src/routes/cms/mobile/qr/[product_id]/+page.server.ts`도 파라미터가 UUID 형식이 아니면
product_code로 재조회하는 폴백을 갖고 있다(`/qr/[entity]/[id]/+server.ts`와 동일 패턴).

> `qr_payload` 컬럼과 그 생성 로직(`https://crazyshot.kr/qr/product/{id}` 형식)은 삭제하지
> 않고 그대로 유지된다 — 단지 화면에 렌더링/인쇄되는 값이 아닐 뿐이다. `qr_payload` UNIQUE
> 제약 추가(BND-13)는 이제 불필요 판정(product_code가 이미 UNIQUE 보장).

**PNG 300 DPI 메타데이터 (2026-09-17 추가)**: 다운로드(`downloadQrWithLabel`) 및 서버
생성(`buildQrDataUrl`) 경로 모두 PNG 출력 시 pHYs 청크를 삽입한다(`injectPngPhysicalDpi`,
`src/lib/utils/qrIssue.ts`). pHYs 값: 11811 pixels/meter(≈300 DPI), unit=1(metric).
CRC32는 외부 라이브러리 없이 자체 구현(다항식 0xEDB88320, Uint8Array/DataView 전용 — Node
Buffer 미사용). 화면 표시 canvas에는 영향 없음(CSS 고정값이 표시 크기를 결정함).

### 2-5. 코드 이관(`/cms/codes` `transferCode`, superadmin 전용) — 카테고리만 이동, 품번은 절대 불변

```
✅ 카테고리 메타데이터만 이관 (.update({ category: targetCat }))
❌ product_code 재발행 시도 완전 제거(예전엔 null화 후 재발급 시도 — 트리거에 막혀 실제로는
   카테고리 이관 자체가 동작 안 하던 버그였음, 2026-08-06 수정으로 카테고리 이관도 정상화됨)
❌ qr_payload 재설정 공회전 코드도 제거(QR은 id 기반이라 카테고리와 무관)

UI 문구: "카테고리만 이관됩니다. 기존 품번은 변경되지 않으며, 물리 태그·라벨 재발급이 필요 없습니다."
```

### 2-6. 죽은 채번 함수

```
generate_child_product_code(product_id, parent_product_id) — Migration 191로 완전 제거됨(DROP)
  이유: COUNT(*) WHERE deleted_at IS NULL 방식이라 형제 삭제 시 번호 재사용 가능한 위험한 패턴
  (2-2 불변 정책과 정면 충돌). 앱 코드에서 호출된 적 없는 죽은 코드였음.
```

### 2-7. QR 스캔 반출입 자동화 (2026-08-06)

```
스캔 진입: /cms/mobile (카메라 FAB) → extractProductId() → /cms/mobile/qr/{품번 또는 uuid}
착지 화면: src/routes/cms/mobile/qr/[product_id]/+page.server.ts
  1. 자식 상품 조회(uuid 또는 product_code)
  2. 겹치는 활성 예약이 있으면 가장 오래된(먼저 시작된) 것 기준 — created_at ascending
     (Stephen 확정: "가장 먼저 시작된 진행중 예약을 기준으로 자동 처리")
  3. 화면 액션 버튼 클릭 → processQrAction → update_reservation_status RPC(H-01 준수)
     → 성공 시 자동 채팅알림(rental-lifecycle.md AUTO_NOTIFY 매핑) + product_history_records에
       자동 기록(이미지 0장, recorded_date만 — 관리자 수동 사진첩과 동일 테이블 공유)
```

> ⚠️ **알려진 한계**: 자동기록은 화면상 "사진 0장짜리 카드"로만 남아, 관리자가 실수로 빈 이력을
> 등록한 것과 구분이 안 된다(라벨/배지 없음). 필요시 향후 보완 대상 — 이력 탭이 비어보이는
> 카드가 여럿 있어도 버그가 아니라 스캔 자동기록일 수 있음을 인지할 것.

> 반출/반납 상태전이 규칙(`nextStatus`/`nextLabel`)은 `src/lib/utils/rentalTransition.ts`에
> 공유 유틸로 분리돼 있고 `RentalDetailPanel.svelte`와 이 스캔 화면이 동일 로직을 사용한다 —
> 전이 규칙을 바꿀 땐 이 파일 하나만 수정하면 양쪽에 반영됨.

> ⛔ **QR-CASE-1(2026-08-XX 발견·수정)**: product_code로 상품을 조회하는 모든 지점은
> `.ilike('product_code', 값)`을 써야 하며 `.eq('product_code', 값.toUpperCase())` 패턴은
> 절대 금지. 이유: `year_month`가 `'all'`인 code_series로 채번된 품번은 `CSPARall00001`처럼
> 날짜 파트가 소문자로 그대로 섞여 저장된다(§2-3) — QR 콘텐츠는 이 원문을 그대로 인코딩하므로
> 스캔 결과도 소문자 포함 원문 그대로 들어오는데, 조회 직전에 강제로 대문자 변환하면 실제
> 저장값과 대소문자가 달라져 대소문자 구분 비교(`=`)에서 매칭 실패 → 정상적으로 발급된 QR을
> 스캔해도 "상품을 찾을 수 없습니다" 404로 착지 실패한다. 영향 범위였던 3개 지점 모두 수정 완료:
> `src/routes/cms/mobile/qr/[product_id]/+page.server.ts`(load 조회 + processQrAction 이력기록
> 조회 2곳), `src/routes/qr/[entity]/[id]/+server.ts`(레거시 URL 핸들러).
>
> ⚠️ **QA 후속(2026-08-XX)**: `.ilike()`로 바꾸면서 스캔값에 `%`/`_`(LIKE 와일드카드)가 섞여
> 있으면 여러 행에 매칭될 수 있는 엣지케이스가 새로 생겼다 — `src/lib/server/escapeLikePattern.ts`
> 신설(`value.replace(/[\\%_]/g, '\\$&')`)해 위 3개 지점 전부 `.ilike('product_code',
> escapeLikePattern(값))`로 적용. **product_code를 ilike로 조회하는 지점을 새로 추가할 때는
> 반드시 이 헬퍼를 함께 써야 한다.**
>
> 실사용 DB 점검(2026-08-XX): 운영(vnbpmvxruyciuuaermyh)은 `reservation_code_format.reset_monthly`
> 가 `true`(+ 카테고리 `code_rule`도 전부 `date_format:"NONE"`)라 `year_month='all'`이 나온 적이
> 없어 영향받은 상품 0건. 스테이지(ezyvffjvuwmtuhpxdjrw)는 `reset_monthly:false`로 테스트돼
> 있어 자식 30건 중 10건, 레거시 부모 8건 중 6건이 영향받음(코드 수정으로 이미 해소됨).
> **QR-CASE-2**: 이 설정(`saveFormat` 액션)을 아무 CMS 등급이나 바꿀 수 있던 게 근본 원인 중
> 하나라 manager 이상으로 권한을 제한했다 — 이후 `/cms/codes`의 나머지 18개 액션도 전부 동일
> 등급으로 통일했다(카테고리 코드 추가/수정/삭제, 조합코드그룹 관리 등 전역 설정 성격 액션
> 전부). 상세는 security-auth.md 역할별 CMS 접근 매트릭스.

### 2-8. products RLS — 부모/자식 노출 통제 (2026-08-06 보안 수정)

```sql
-- 공개 조회(anon+authenticated): 활성 + 삭제안됨 + "부모만"
CREATE POLICY "products_public_read" ON products FOR SELECT TO anon, authenticated
  USING (is_active = true AND deleted_at IS NULL AND parent_product_id IS NULL);

-- 관리자: is_cms_user() 기반(고객 등급 is_admin()이 아님 — CMS 직원 권한과 무관한 별개 개념이었음)
CREATE POLICY "products_admin_all" ON products FOR ALL
  USING (is_cms_user()) WITH CHECK (is_cms_user());
```

> ⚠️ 2026-08-06 이전에는 stage/production 둘 다 이 조건이 사실상 없는 것과 같아서(사유는 각기
> 다름 — stage는 항상 참인 조건, production은 `USING (true)`) 자식(재고단위)·비활성·삭제 상품까지
> anon 키로 전부 조회 가능한 상태였다. 지금은 stage·production 모두 위 정책으로 통일 적용됨.
> `is_cms_user()` 함수 정의도 그 전까지 마이그레이션 파일에 등록돼 있지 않았음(Migration 195로 백필).

### 2-9. 판매전용(sale_only) 상품 등록 정책

```
sale_only = true(판매만 가능) → 대여가격 검증 전부 스킵
  (24시간 가격 필수 체크 포함 — 화면에서 대여가격 입력란이 비활성화되는 것과 서버가 일치해야 함)
sale_only = false(기본값) → 24시간(1일) 가격은 서버에서도 필수(fail(400)) — 라벨의 "*"와 실제
  동작이 일치함(과거엔 라벨만 필수처럼 보이고 서버는 안 막던 버그였음, 2026-08-05 수정)

적용 위치: src/routes/cms/products/new/+page.server.ts(신규등록),
          src/routes/cms/products/+page.server.ts updateSection pricing 분기(기존상품 수정)
```

### 2-10. 등록 검증 및 예외처리 정책 (2026-08-06)

**① regWarn 경고 메커니즘 — "등록 성공"과 "완전 성공"은 다를 수 있다**

```
신규 상품 등록(products/new) 처리 중 아래 6개 단계는 실패해도 등록 자체(products INSERT)를
막지 않는다 — 대신 실패한 단계를 코드로 모아 리다이렉트 URL에 &regWarn=코드1,코드2 로 실어
보내고, 상품목록 페이지가 마운트 시 1회 csToast.warning으로 표시한다(표시 후 URL에서 파라미터 제거).

  qr    : QR 관련 payload 업데이트 실패
  code  : 품번 채번(generate_product_code, code_series 저장) 실패
  price : price_rules 저장 실패
  options: 옵션상품 연결(upsert_product_option_links) 실패
  inv   : 재고 자동생성(auto_create_inventory_for_product) 실패
  thumb : 썸네일 이미지 이관 실패(large 이미지로 폴백 저장됨 — 완전 실패는 아님)

⚠️ 관리자는 이 경고를 무시하면 안 된다 — 예를 들어 'code' 경고가 뜨면 그 상품은 code_series가
없는 상태로 남아 "빠른 재고 등록"이 막힌다(§8-F 참고). 경고가 뜬 상품은 반드시 확인 후 재조치.
```

**② 파트너 조합코드가 상품 카테고리와 안 맞으면 등록 자체를 차단**

```
"상품 복제 → 신규상품" 모드에서 파트너 조합코드를 선택했는데, 그 조합에 해당 상품 카테고리와
일치하는 분류코드가 없으면 → 예전엔 조합의 첫 번째 코드로 조용히 대체(엉뚱한 카테고리 품번 위험)
→ 2026-08-06부터 fail(400, '선택한 조합코드가 이 상품의 카테고리와 맞지 않습니다')로 명확히 차단
```

**③ "빠른 재고 등록" 배치 부분실패 시 처리 방침 (Stephen 확정)**

```
여러 개(N개)를 한 번에 등록하다가 중간에 하나 실패하면:
  → 모달을 닫고 목록을 새로고침(invalidateAll)해 실제 생성된 개수를 정확히 보여준다
  → "이미 M개 생성됨, 계속할까요?" 같은 재시도 프리필 UI는 만들지 않음(의도적 — 관리자가
    새로고침된 정확한 현재 상태를 직접 보고 다시 시도 여부를 판단하게 함)
  → 성공은 했지만 일부 항목만 품번/가격 복사가 실패한 경우도 경고로 별도 표시됨
```

**④ 12시간/월간 요금을 비워서 저장하면 실제로 삭제된다**

```
가격정책 탭에서 12h 또는 monthly 요금 입력란을 비우고 저장 → 기존 price_rules 행을
소프트삭제(deleted_at, is_active:false) — 예전엔 조용히 무시돼 값이 안 지워지는 버그였음
(24h는 필수값이라 애초에 비울 수 없음 — 위 ①의 24h 필수 정책 참고)
```

**⑤ `description` 컬럼은 의도적으로 미사용 (Stephen 확정)**

```
products.description 컬럼은 등록/수정 화면 어디에도 입력 UI가 없어 항상 NULL이다.
콘텐츠블록(content_blocks, '상품설명' 탭)이 이미 이 역할을 대체하고 있어 그대로 둔다 —
버그 아님, 향후 UI를 새로 만들 계획도 없음.
```

### 2-11. "코드 재반영" — 재고 0개 부모상품의 code_series 재할당 (2026-08-25 신설)

```
⛔ 2026-09-24 정책 변경(Stephen): "새 상품으로 복제"는 새로운 부모상품 등록이므로 원본과
   동일한 코드품번 구조를 그대로 물려받는 복제(=동일 부모코드품번 상품의 신규 중복 생성)를
   더는 허용하지 않는다. 복제 모달은 어느 모드든 코드조합 선택이 필수이며(자동 생성 모드는 이
   상품 카테고리(default_category)의 코드조합 전체가 목록으로 나열됨), 미선택·타 카테고리
   조합은 서버(cloneProduct)가 400으로 차단한다. 아래 내용은 이 변경 이전에 이미 생긴 중복
   부모(레거시)를 위한 설명·"코드 재반영" 수단으로만 남는다.
   · 새 상품 복제는 항상 1개씩만 등록(등록 수량 없음)하고 재고는 만들지 않는다. 장치정보·이력을
     제외한 모든 정보(기본정보·옵션상품·가격정책·대여정책·상품설명·구성품·이미지·사양)를 복제하며,
     이미지는 Storage 파일을 새 상품 폴더로 실제 복사한다(원본과 파일 공유 금지 — 한쪽 삭제가
     다른 쪽을 깨뜨림). 동일 재고 추가는 한 번에 최대 50개, 순번 상한을 넘겨야 하면 하나도
     만들지 않고 사전 차단한다.

과거 서술 — "새 상품으로 복제 + 품번(분류코드) 자동 생성"으로 1단 계층(순번1 없음) 카테고리를 복제하면,
두 부모상품이 동일한 code_series(구조)를 공유하는 것 자체는 §2-3에서 이미 확정된 정책이라
버그가 아니다("부모순번 없음 → 복제 대상/복제 등록 모두 동일 코드 표시"). 다만 관리자가
이 화면상의 "동일 표시"를 실제로 구분하고 싶을 때를 위해 reassign_product_code_series
RPC(Migration #341)를 제공한다.

⛔ 이 RPC는 §2-2(품번 영구고정) 예외가 아니라 그 정책이 애초에 적용되지 않는 범위에서만
   동작한다 — §2-2는 "이미 실제로 발급된 자식(재고) product_code"만 보호하는 정책이므로,
   자식이 0개(재고 미등록)인 부모의 code_series는 실물에 아직 연결되지 않은 구조 템플릿일
   뿐이다. reassign_product_code_series는 대상 부모에 활성 자식이 1개라도 있으면
   has_existing_inventory 예외로 무조건 차단한다(Stephen 2026-08-25 확정) — 재고가 이미
   등록된 부모는 재할당 대상에서 원천 제외.
⛔ 기존 generate_product_code(7-param, Migration #222)는 절대 수정하지 않는다 — 그 함수의
   "이미 있으면 NULL 반환" 가드는 다른 모든 정상 등록 경로가 의존하는 안전장치이므로, 재할당
   요구는 새 함수(reassign_product_code_series)로 완전히 분리했다.
⛔ 부모/자식 분리(§2-1) — parent_product_id가 있는 자식(재고) 상품에는 이 RPC를 호출할 수
   없다(자식은 code_series 개념 자체가 없음). RPC 자체가 child_product_not_allowed로 이중
   방어한다.

UI 노출 조건: ProductDetailPanel의 "코드 재반영" 버튼은 이 부모가 "자신보다 먼저 생성된
다른 활성 부모와 완전히 동일한 1단 계층 code_series를 공유하는 후발 중복"일 때만
노출된다(hasOlderDuplicateCode, loadSelectedProductDetail.ts에서 계산) — 복제 대상(원본)
쪽에는 표시되지 않아 관리자가 어느 부모를 눌러야 하는지 헷갈리지 않는다. 클릭 시 그
상품의 category와 매칭되는 코드설정/코드조합 그룹 전체(협력사 전용 여부 무관, §2-3
partnerComboItems와 달리 필터 없음)를 모달로 노출하고, 선택한 코드에 부모순번(2단 계층)
개념이 있으면 product_parent_sequences 원자 카운터로 즉시 채번해 실제로 다른 값이 되도록
재할당한다.

권한: /cms/codes와 동일하게 manager 이상만 실행 가능(security-auth.md QR-CASE-2 선례) —
품번 체계 자체를 바꾸는 액션이라 세션만 있으면 되는 §8-F "품번 체계 설정"(고아 부모
복구, no-op 안전장치)보다 엄격한 게이트를 적용한다.
```

구현 파일:
```
RPC                : supabase/migrations/20260825000341_341_reassign_product_code_series.sql
중복탐지+콤보목록  : src/lib/server/products/loadSelectedProductDetail.ts
                      (hasOlderDuplicateCode / categoryComboItems)
서버 액션          : src/routes/cms/products/+page.server.ts (reassignCodeSeries)
UI                 : src/lib/components/cms/ProductDetailPanel.svelte
                      (showReassignModal / openReassignModal / handleReassignCodeSeries)
```

---

### 2-12. 옵션 상품 전용(option_only) — 고객 화면 진열 제외 + 옵션상품 후보 유지 (2026-08-31 신설)

```
부모 상품 전용 정책 컬럼(sale_only와 동일 성격, Migration #66 명명 컨벤션 그대로 재사용).
자식(재고) 상품에는 의미 없음 — 부모→자식 상속 시 sale_only와 항상 함께 전달된다
(loadSelectedProductDetail.ts, cloneProduct 양쪽 분기).

option_only = true  → 카탈로그·홈·하이프팩·검색 등 고객용 상품 진열 화면 전체(5곳 이상)에서
                       제외되고, 다른 부모상품의 '옵션상품'(option_links) 설정 후보 목록에만
                       노출된다.
option_only = false (기본값) → 기존과 동일하게 정상 노출.

⛔ CMS 옵션상품 선택 피커(ProductDetailPanel.svelte/new/+page.svelte의
   searchOptionProducts)는 이 컬럼을 검사하지 않는다 — 원래부터 is_active만 검사해 왔으므로
   option_only=true 상품도 그대로 후보 목록에 노출된다(별도 코드 변경 불필요, 설계 단순화).
```

**제외 대상 5곳 (전부 `option_only = false` 조건 추가)**
```
search_products RPC(전체목록 검색)
get_products_by_ids RPC(헤더 히어로·MD픽·홈 카테고리 큐레이션·하이프팩 배너 보강 공용)
get_home_theme_groups_with_products / get_home_theme_groups_admin
get_hype_pack_theme_groups_with_products / get_hype_pack_theme_groups_admin
NLSearch 인덱스 쿼리(productSearchIndex.ts) + 검색페이지 추천상품 클라이언트 쿼리
```

구현 파일:
```
컬럼             : supabase/migrations/20260901000000_389_products_option_only_column.sql
RPC 필터 4종     : Migration #390~393
등록·수정 UI     : src/routes/cms/products/new/+page.svelte,
                   src/lib/components/cms/ProductDetailPanel.svelte (기본정보 탭
                   "노출 조건" 옆 슬라이딩 토글, cms-uiux.md §7-8 표준)
서버 반영        : src/routes/cms/products/new/+page.server.ts,
                   src/routes/cms/products/+page.server.ts (updateSection 'basic',
                   cloneProduct 양쪽 분기)
상속·조회        : src/lib/server/products/loadSelectedProductDetail.ts
```

---

### 2-13. 상품정보 복제/재고 등록 모달 정책 — 정책적 제한 규정 (2026-09-24 확정, Stephen)

> 대상: ProductDetailPanel "상품 복제/재고 등록" 모달(`cloneProduct` 액션 — `+page.server.ts`).
> 위반 방지의 정본은 서버(cloneProduct)이고, 화면(모달)은 같은 규칙을 실행 버튼 클릭 시점에
> 사전 차단해 짧은 토스트로만 알린다(cms-uiux.md §0-10-E).

```
[새 상품으로 복제 (mode=new_product)]
  R1. 동일한 부모 코드품번을 가진 부모상품을 새로 만들 수 없다 — "새 상품 복제 = 새로운 부모상품
      등록"이므로 원본의 코드품번 구조를 그대로 물려받는 복제는 금지(§2-11의 과거 "동일 표시 허용"
      폐기).
  R2. 코드조합 선택 필수: "품번(분류코드) 자동 생성"은 원본 상품 카테고리(default_category)에
      속한 코드조합 전체를 목록으로 나열해 반드시 하나를 고르게 하고, "협력사 품번코드 선택
      생성"도 조합 선택이 필수. 자동 생성 모드에서 타 카테고리 조합은 서버가 400으로 거절.
  R3. 순번1(부모 순번)이 없는 1단 조합은 같은 조합·같은 연월(date_option 없음이면 연월 무관)의
      부모가 이미 있으면 등록 불가. 순번1이 있는 2단 조합은 부모마다 순번1이 원자적으로 +1되어
      항상 서로 다르므로 등록 가능.
  R4. 등록 수량 개념 없음 — 항상 1개씩 등록(같은 코드품번 부모가 여러 개 생기는 것 방지).
  R5. 재고(자식)는 만들지 않는다(재고 일괄 등록 금지) — 재고는 이후 "동일 상품 재고 추가"로만.
      새 부모는 미노출(is_active=false)로 시작.
  R6. 복제 범위 = ProductDetailPanel 전 탭에서 장치정보·이력을 뺀 모든 정보: 기본정보·옵션상품
      연결·가격정책·대여정책(기간·수령방식·수령지점·배송옵션)·상품설명(키워드 포함)·구성품·
      이미지·사양. 이미지는 Storage 파일을 새 상품 폴더로 실제 복사한다(원본과 파일 주소 공유
      금지 — DELETE /api/cms/upload가 Storage 파일을 지우므로 한쪽 삭제가 다른 쪽을 깨뜨림).
      일부 항목 복사 실패는 상품 등록을 막지 않고 경고 토스트로 알린다.

[동일 상품 재고 추가 (mode=add_inventory)]
  R7. 한 번에 최대 50개(화면 입력 상한 + 서버 clamp 이중 적용).
  R8. 순번 상한(code_series.max_sequence) 사전 차단: 남은 순번 = max_sequence − (next_seq − 1)
      (next_seq는 "다음에 발행될 번호", 행이 없으면 1; 2단=product_child_sequences_by_parent,
      1단=product_code_sequences[category_code+year_month] — 1단은 여러 부모가 카운터 공유).
      남은 순번보다 많이 요청하면 하나도 만들지 않고 400. 동시 요청 등으로 만든 뒤 상한에 걸리면
      방금 만든 재고를 소프트삭제해 "품번 없는 대여가능 재고"가 남지 않게 한다.

[삭제]
  R9. 상품/재고 삭제 성공 즉시 목록을 재조회(invalidateAll)해 삭제된 카드가 남지 않게 한다
      (삭제 안전 토스트 표준의 onSuccess — cms-uiux.md §0-10-B).
```

구현 파일: `src/routes/cms/products/+page.server.ts`(cloneProduct·loadProductsMetadata의
조합 플래그 `has_parent_seq`/`duplicate_parent_code`·`copyProductImages`),
`src/lib/components/cms/ProductDetailPanel.svelte`(모달·사전 차단), 테스트
`src/__tests__/services/productClone.test.ts`·`src/__tests__/server/cloneProductPartnerCodeComboMerge.test.ts`.

---

### 2-14. 결합상품(bundle) 탭 — CMS '결합상품' 구성 관리 (Phase 1, 2026-09-24 신설)

> ⛔ 부모 상품 전용. 자식(재고) 상품에서는 '결합상품' 탭이 숨겨지고(`childBlockedSections` 포함),
> 서버(updateSection 'bundles')도 자식 대상 저장을 차단한다.

```
결합상품 = 이 상품을 대여할 때 함께 구성되는 다른 상품 목록.
예: "카메라 A" 상품에 결합상품으로 "배터리 그립 B", "렌즈 C"를 등록하면,
    상품상세(/products/[id]) 화면의 별도 "결합 상품" 목록(썸네일+상품명, 요금·수량 없음)에
    배터리 그립 B·렌즈 C가 표시되고, 전자계약 상품목록에는 패키지 줄 아래 한 줄씩 나열된다.
    장바구니에는 결합상품 목록을 표시하지 않는다(Q-J 확정 — Phase 2에서도 미표시).
    대여요금은 패키지 상품 자신의 가격정책으로만 산정한다(결합상품 요금·수량 미적용).

제약 (upsert_product_bundle_links RPC가 서버에서 집행):
  ① 자기 자신을 결합상품으로 추가 불가 (BUNDLE_SELF_REF)
  ② 자식(재고) 상품을 결합상품으로 추가 불가 — 부모 상품만 (BUNDLE_CHILD_PRODUCT)
  ③ 삭제된(deleted_at IS NOT NULL) 상품 추가 불가 (BUNDLE_DELETED_PRODUCT)
  ④ 지금 저장하려는 상품 자체가 이미 다른 패키지의 결합상품이면, 그 상품에는 결합상품을
     등록할 수 없음(BUNDLE_IS_NESTED) — 결합목록을 비우는 저장은 허용.
     ⚠️ 같은 결합상품을 여러 패키지가 함께 쓰는 것은 허용된다(렌즈 C를 패키지 X·Y 양쪽에 등록 가능).
  ⑤ 이미 자신이 결합상품 목록을 가진 상품("패키지")은 다른 패키지의 결합상품이 될 수 없음
     (패키지의 패키지 금지 — BUNDLE_NESTING_FORBIDDEN)
  ⑥ 이 패키지의 옵션상품(product_option_links)에 이미 연결된 상품은 결합상품으로도 등록 불가
     — 같은 패키지 내 옵션·결합 중복 차단 (BUNDLE_OPTION_OVERLAP)

계약서 결합상품 행 정책 (Phase 1, 2026-09-24, contract-data/+server.ts):
  - 메인상품 행 바로 뒤, 옵션상품 행 앞에 삽입
  - 수량: '-', 금액: '-'
  - 비고: formatComponentsText(components) — 구성품 JSONB 텍스트화
  - 상품코드: 예약 시점 배정 실물(reservation_bundle_assets)의 품번을 표시(Phase 2, Q-I).
    배정 기록이 없는 레거시 예약은 현재 결합 구성(이름만)으로 폴백, 상품코드 칸 비움
  - Phase 1 + Phase 2 모두 Stage 검증 후 Production에 한꺼번에 적용 (Q-M — Phase 2 Migration #547은
    Stage 적용 후 Stephen의 Production 오픈 시점 확인 대기)

재고 연동 (Phase 2, 2026-09-24, Migration #547 — A안 실물 단위 배정):
  - 패키지 hold 생성(create_hold_reservation)·draft→hold 승격(promote_draft_reservation)과 같은
    트랜잭션에서 결합상품마다 활성 자식(실물) 1개를 배정 → reservation_bundle_assets(예약 1건 ↔ 결합상품별
    실물 1개). 날짜 기준 = 메인과 동일한 effective 기간(휴무일 연장 포함), FOR UPDATE SKIP LOCKED.
  - 1종이라도 배정 불가(재고 0·기간 겹침) → 전체 실패·롤백, 메시지 "구성품 재고가 부족해 예약할 수 없습니다."
  - 결합상품 단독 예약과 상호 차단: 단독 배정 쿼리가 "비종결 예약에 결합 배정된 실물 + 날짜 겹침"을 제외
  - 해제는 별도 로직 없음 — 예약 status 조인으로 취소·만료·반납·완료 시 자동 해제. draft는 점유 안 함
  - 삭제된 결합상품/연결은 배정 대상 아님(EC-C). 요금·결제 금액·옵션 수량 가드는 무변경
  - 가용재고(get_available_stock_counts): 결합 점유 반영 + 패키지 가용 = min(패키지, 각 결합상품)
  - CMS 예약/대여 상세 '대여정보' 탭에 "결합상품 + 장비번호" 표시(GET /api/cms/reservations/[id]/bundles)

고객 화면(/products/[id]):
  - 결합상품은 상품명만 노출 (Phase 1 = name only — 상품코드 미표시)
  - 클릭 시 해당 상품 페이지로 이동하는 링크 없음 (display-only)
  - 옵션상품 목록 바로 위 별도 "결합 상품" 목록(썸네일+상품명, 요금·수량·필수 배지 없음)
  - 장바구니(/cart)에서는 결합상품 목록 미표시 (Q-J 확정)
  - Phase 1 Stage only (Production 반영은 Phase 2와 동시 진행)
```

구현 파일:
```
DB 스키마·RPC    : supabase/migrations/20260924020000_544_product_bundle_links.sql
타입             : src/lib/types/database.ts (ProductBundleLink / ProductBundleLinkRow / ProductBundleLinkInsert)
CMS 조회·저장    : src/lib/server/products/loadSelectedProductDetail.ts (get_product_bundle_links)
                  src/routes/cms/products/+page.server.ts (sectionType='bundles', cloneProduct new_product)
CMS UI           : src/lib/components/cms/ProductDetailPanel.svelte (bundles 탭 — 옵션탭 바로 뒤)
신규등록         : src/routes/cms/products/new/+page.server.ts (+new/+page.svelte)
계약서 반복행    : src/lib/utils/contractLineItems.ts (BundleLink, ReservationForLineItems.bundles)
                  src/routes/api/cms/reservations/[id]/contract-data/+server.ts
고객 화면        : src/routes/products/[id]/+page.server.ts (+page.svelte)
```

---

## 3. is_active 토글 — 재고 가용성 연동

```
자식 is_active = true  → 대여 가능 (예약 할당 대상)
자식 is_active = false → 대여 불가 (예약 할당 제외)
부모 is_active         → 노출(ON)/미노출(OFF) 상태 (대여와 별개)

신규 자식 기본값: is_active = true (즉시 대여 가능)
```

### 토글 흐름

```
[CMS 인벤토리 아코디언] 토글 버튼 클릭
  → form POST ?/toggleStatus { id: unit.id, is_active: 현재값 }
  → DB UPDATE products SET is_active = !현재값
  → invalidateAll() 실행
  → 서버 재조회 → product prop 변경 → $effect 동기화
```

### ⛔ 토글 후 저장 버튼 오탐 방지 (필수)

```typescript
// ProductDetailPanel.svelte — $effect 내 is_active 재동기화 필수
$effect(() => {
  localImages = [...]
  localSlug = product.slug
  localBasic.is_active = product.is_active  // ← 반드시 포함
  localPricing = { ... }
  // ...
})
```

> **이유:** `localBasic`은 마운트 시 1회 초기화. 토글 → `invalidateAll()` → `product.is_active` 변경되나 `localBasic.is_active`는 구값 고정 → `isDirtyBasic = true` 오탐. `$effect`에서 재동기화하지 않으면 기본정보 탭의 저장 버튼이 잘못 활성화됨.

---

## 4. 상품등록관리 기준 — ProductDetailPanel 탭 구조

### 4-0. 등록관리 책임 분리 원칙 (2026-08-06 명문화)

```
부모 상품 (최초 등록 단위)
  → '이력' 탭을 제외한 모든 등록정보(기본정보·슬러그·옵션상품·가격정책·대여정책·
     상품설명·구성품·이미지·사양)의 유일한 수정 지점
  → 자식(재고)은 이 탭들을 전부 읽기전용으로만 반영(수정 불가) — §4-1 참고
  → '이력' 탭에서는 자기 자신이 아니라 하위 모든 자식(재고)의 이력을 모아서 보여줌 — §4-2 참고

자식 상품 (재고 — "빠른 재고 등록"으로 생성되는 순간)
  → 고유 '품번'(product_code) 부여 (§2 채번 정책)
  → 이와 동시에 그 자식만의 독립적 '이력관리'가 시작됨
     (등록·수정·삭제 전부 그 자식 단위로만 가능, 부모나 다른 자식과 공유 안 됨)

즉 "부모 = 등록정보 관리" / "자식 = 품번 + 이력 관리"로 책임이 명확히 나뉜다.
```

### 4-1. 부모/자식 탭 접근 권한

```
파일: src/lib/components/cms/ProductDetailPanel.svelte
타입: TabKey = 'basic' | 'options' | 'pricing' | 'rental' | 'content' | 'components' | 'images' | 'specs' | 'history'
기본 탭: 'basic' (URL ?tab=<key>로 초기 탭 지정 가능)

자식 선택 시(isChildProduct=true): 'history' 제외 전 탭이 읽기전용
  (입력요소 포커스 시 토스트 경고 + 즉시 블러, 저장버튼 비노출, 서버 액션도
   childBlockedSections 가드로 이중 차단)
```

| 탭 key | 레이블 | section_type | 저장 방식 | 관리 데이터 | 자식에서 수정 가능? |
|---|---|---|---|---|---|
| `basic` | 기본정보 | `basic` | 저장 버튼 | name · brand · product_caption · is_active · category | ❌ 부모 전용 |
| `basic` | (슬러그) | `slug` | 저장 버튼 (별도) | slug (URL 코드) | ❌ 부모 전용 |
| `options` | 옵션상품 | `options` | 저장 버튼 | option_links (연관상품 JSON) | ❌ 부모 전용 |
| `bundles` | 결합상품 | `bundles` | 저장 버튼 | bundle_links (product_bundle_links 테이블 — §2-14) | ❌ 부모 전용 |
| `pricing` | 가격정책 | `pricing` | 저장 버튼 | price_12h · price_24h · price_monthly · deposit · late_fee · damage_fee · sale_price · sale_only | ❌ 부모 전용 |
| `rental` | 대여정책 | `rental` | 저장 버튼 | allowed_period_ids · allowed_method_ids · allowed_pickup_ids · 배송옵션 | ❌ 부모 전용 |
| `content` | 상품설명 | `content` | 저장 버튼 | content_blocks · keywords | ❌ 부모 전용 |
| `components` | 구성품 | `components` | 저장 버튼 | components (key-value) | ❌ 부모 전용 |
| `images` | 이미지 | `images` | **자동 저장** (업로드·삭제 즉시) | image_urls | ❌ 부모 전용(서버가 항상 부모로 리다이렉트) |
| `specs` | 사양 | `specs` | 저장 버튼 | specifications (key-value) | ❌ 부모 전용 |
| `history` | 이력 | — | §4-2 참고 | 상품 이력(사진+코멘트, 반출입 자동기록 포함) | ✅ **자식만** 등록·수정·삭제 가능 |

### 4-2. '이력' 탭 — 유일하게 부모/자식이 반대로 동작하는 탭 (HIST-1, 2026-08-05)

```
부모 선택 시(자식 1개 이상 존재)
  → 하위 모든 자식의 이력을 하나로 모아 정렬 표시(recorded_date DESC, created_at DESC)
  → 각 카드에 "어느 자식(품번)의 이력인지" 배지 표시
  → 등록·수정·삭제 버튼 전부 숨김("각 자식 상품 패널에서 진행하세요" 안내)
  → 조회: get_product_history_multi(p_product_ids UUID[]) RPC — 자식 id 전체를 한 번에 조회(N+1 금지)

자식 선택 시
  → 그 자식 고유의 이력만 표시, 등록·수정·삭제 전부 가능(기존 CRUD 그대로)
  → 조회: get_product_history(p_product_id UUID) RPC — 단일 상품 조회

부모인데 자식이 0개(단일 패널 케이스)
  → 부모 자신을 대상으로 기존처럼 등록·수정·삭제 가능(예외 — 실물이 부모 자신뿐이므로)
```

> ⛔ 등록·수정·삭제는 항상 "실물(자식)" 단위로만 이뤄져야 한다는 원칙의 연장 — 부모의 '이력' 탭은
> 순수 열람용 대시보드일 뿐, 데이터 입력 지점이 아니다.

### 저장 공통 패턴

```
모든 탭: action="?/updateSection" + section_type 히든 필드
저장 후: handleSectionSave → invalidateAll() → prop 재수신 → isDirty* 초기화
```

### isDirty 감지 패턴

```typescript
// 각 탭은 localXxx ($state) vs product.xxx 또는 origXxx ($derived) 비교
const isDirtyBasic = $derived(
  localBasic.name !== product.name || ...
)
// 탭 전환 시 isDirty 활성이면 경고 토스트 (저장 강제 없음)
```

> `images` 탭만 예외 — isDirty 없음, 업로드/삭제 즉시 서버 반영 + invalidateAll()

### 다중 탭 동시편집 저장 경고 (2026-08-05 추가)

```
A탭 수정 중(미저장) → B탭으로 이동해 저장 → invalidateAll()로 서버값이 다시 내려오면서
A탭의 미저장 로컬 상태도 함께 서버값으로 조용히 덮어써진다(=A탭 변경사항 유실).

대응: B탭 저장이 성공하면, 그 시점에 다른 탭에 아직 isDirty인 게 있는지 확인해
"저장됐습니다. [기본정보·가격정책] 탭의 미저장 내용이 초기화됐습니다." 형태로 경고 토스트를
띄운다 — 저장 자체를 막지는 않음(사후 인지시킴).
```

---

## 5. 사용자 대여 기준 로직 정책

고객이 상품을 예약할 때 `create_hold_reservation` RPC가 실행되며 아래 조건을 **모두** 충족하는 자식 상품을 자동 배정합니다.

### 예약 가능 조건 (AND)

```
① 부모 상품과 parent_product_id로 연결된 자식
② deleted_at IS NULL (삭제되지 않은 자식)
③ is_active = true (관리자가 ON 상태로 설정한 자식)
④ 요청 기간(start_date ~ end_date)에 활성 예약 없음
   (cancelled · returned · completed · expired 상태는 무시)
④-2 요청 기간에 "다른 패키지 예약의 결합상품으로 배정된 실물"이 아님 (reservation_bundle_assets +
   비종결 예약 + 날짜 겹침 — 결합 점유, §2-14 Phase 2 / Migration #547)
⑤ FOR UPDATE SKIP LOCKED (동시 예약 충돌 방지)
⑥ 패키지 상품이면 결합상품마다 위 ①~⑤ 기준의 실물 1개가 함께 배정 가능해야 함(하나라도 없으면 예약 실패)
→ 위 조건 중 가장 먼저 생성된 자식(ORDER BY created_at)에 배정
```

### 예약 불가 케이스

```
· is_active = false 자식만 있을 때 → "예약 가능한 재고가 없습니다"
· 모든 자식이 해당 기간에 이미 예약됨 → 동일 메시지
· 로그인 미상태 → "로그인이 필요합니다"
· blacklisted 계정 → "서비스 이용이 제한된 계정입니다"
· credit_score < 30 → "신용점수가 낮아 예약이 제한됩니다"
```

### 대여정책 탭 ↔ 예약 흐름 연결

```
allowed_period_ids  → 고객 예약 화면에서 선택 가능한 대여 기간 옵션
allowed_method_ids  → 수령·반납 방식 선택지 (방문·택배·퀵 등)
allowed_pickup_ids  → 방문 수령 가능 지점 목록
(미설정 시 해당 옵션은 고객 화면에 미노출)
```

---

## 6. 재고 배지 표시 정책

```svelte
<!-- CMS 상품 목록 카드 -->
{product.assetCount}(on) / {product.assetTotal ?? 0}

assetCount = is_active=true 자식 수 (대여 가능)
assetTotal = 전체 자식 수 (deleted_at IS NULL)
```

```typescript
// +page.server.ts — stockCounts 타입
const stockCounts: Record<string, { active: number; total: number }> = {}
// 자식 .select('parent_product_id, is_active') 집계
```

### 상태별 재고 카운트 칩 (2026-08-05 추가, BND-COUNT-1)

위 on/off 배지는 그대로 두고, 그 옆에 실제 대여 라이프사이클 상태별 개수를 추가로 표시한다
(상품목록 카드, 대표 카드, `ProductDetailPanel` 요약바 3곳 전부).

```
예약중(holding)   : status = 'hold'
반출중(outgoing)  : status IN ('confirmed', 'shipped')
대여중(renting)   : status = 'in_use'
반납중(returning) : status = 'return_requested'
반납완료(returned): status IN ('returned', 'completed')

집계: 부모의 전체 자식 id를 모아 rental_reservations를 단일 쿼리로 집계(N+1 금지)
0인 버킷은 칩 자체를 렌더링하지 않음
```

### ⚠️ PAGE-SCOPE-1: "선택영역"(대표 카드) 집계는 페이지네이션과 무관해야 함 (2026-08-XX 수정)

```
문제: stockCounts / rentalStatusCounts / prices12h·24h는 전부 현재 페이지의 productIds
     (PAGE_SIZE=20)로만 집계됨. 다른 페이지·필터에 있는 상품이 ?selected= URL로 직접
     선택되면(북마크, QR 스캔 리다이렉트 등) 그 맵에 값이 없어 대표 카드(rootProduct)의
     재고 배지·가격·상태 칩이 전부 0/빈 값으로 잘못 표시될 수 있었다.

수정: rootProduct(선택된 대표 상품)의 아래 3가지는 페이지네이션 집계 맵에 의존하지 않고
     항상 rootId 기준 전용 쿼리/derive로 재계산한다(+page.server.ts):
  · assetCount/assetTotal → inventoryList(이미 rootId로 직접 조회됨)에서 직접 카운트
  · price12h/24h          → selectedProduct.price12h/24h 재사용(policySourceId 전용
                              쿼리로 이미 페이지네이션 무관하게 계산돼 있음, 중복 쿼리 없음)
  · rentalStatusCounts     → inventoryList의 자식 id들로 rental_reservations 직접 재조회

⚠️ 메인 목록 그리드 카드들(products 배열을 그대로 순회)은 애초에 productIds에서 파생된
   항목이라 이 문제가 없음 — 오직 "선택된 대표 카드" 1건에만 해당하는 보정.
```

---

## 7. 인벤토리 아코디언 UI 정책

```
표시 조건: inventoryList.length > 0 (자식 1개 이상)
단일 패널: inventoryList.length === 0 (자식 없음 → {:else} 분기로 부모 직접 표시)

아코디언 클릭: selectProduct(unit.id) → URL ?selected=<자식ID>
  → 서버: selectedProduct = 자식 상품 데이터
  → 패널: 자식의 기본정보·가격·QR 등 표시
```

### QR-4/QR-AUTO-1: 일괄 QR 인쇄 + "빠른 재고 등록" 직후 자동 노출 (2026-08-XX)

```
"실 상품코드 반영 목록"(인벤토리 아코디언) 각 행에 품번 발행된 자식만 체크박스 노출
  → 1개 이상 선택 시 "선택 N개 QR 인쇄" 버튼 등장 → window.open()으로 인쇄용 QR 그리드 페이지 오픈
  → 팝업 차단 시 명확한 안내 토스트("팝업이 차단됐습니다. 팝업 허용 후 다시 시도하세요.")

"빠른 재고 등록" 성공 직후: 방금 생성된 자식(들)의 체크박스를 자동으로 선택 상태로 반영한다.
  ⛔ 성공 직후 자동으로 window.open()을 호출하지 않는다 — form 제출 → invalidateAll 등 여러
     await를 거친 뒤 팝업을 열면 브라우저의 사용자 제스처 유효기간이 끝나 거의 항상 차단된다
     (등록은 성공했는데 매번 에러 토스트가 뜨는 원인이었음, 2026-08-XX 발견·수정).
  → 실제 인쇄창 오픈은 이미 노출된 "선택 N개 QR 인쇄" 버튼의 직접 클릭에 맡긴다.
  → 서버(cloneProduct add_inventory)는 응답에 createdIds를 포함해야 하고, 채번 실패 시
    1회 자동 재시도한다(§2-3 참고).
```

> 자식 선택 시 **자식 자신의 qr_payload** 표시 (부모 공유 금지)
> 자식에 qr_payload가 없으면 placeholder → DB 이상 → Migration 168 STEP 2로 백필

---

## 8. 오류 발생 시 복원·정합 기준

### A. QR placeholder 표시 ("QR" 텍스트만 보임)

```
증상: div.qr-placeholder 렌더링 (캔버스 없음)
원인(2026-08-06 이후): product.product_code = null — 아래 둘 중 하나
  ① 부모 상품을 보고 있음(정상 — 부모는 원래 품번이 없음, §2-1 참고)
  ② 자식인데 아직 품번이 채번되지 않음(비정상 — "빠른 재고 등록"으로 생성됐다면 즉시 채번돼야 함)
확인: DB SELECT product_code, code_series FROM products WHERE id = '<product_id>'
  ②인 경우: 부모의 code_series가 NULL이고 레거시 product_code도 없는 상태였을 가능성
  → 아래 F번 항목 참고
```

### B. is_active 토글 후 저장 버튼 오탐 (기본정보 탭)

```
증상: 인벤토리 토글 클릭 시 기본정보 탭 저장 버튼 활성화
원인: $state(prop) 초기화 후 $effect 재동기화 누락
확인: ProductDetailPanel.svelte $effect 내 localBasic.is_active = product.is_active 존재 여부
복원: $effect 블록에 localBasic.is_active = product.is_active 추가
```

### C. 인벤토리 배지 N(on) / 0 표시

```
증상: assetTotal이 0으로 표시되나 assetCount는 정상
원인: 서버 코드 변경 후 dev server 미반영 (핫리로드 불완전)
복원: 브라우저 강제 새로고침 (Cmd+Shift+R)
확인: +page.server.ts stockCounts 타입이 { active: number; total: number }인지 확인
```

### D. 인벤토리 카운트 vs 배지 불일치 (예: 패널 21개, 배지 20개)

```
증상: 인벤토리 아코디언 행 수 ≠ 배지 total 수
원인: inventoryList 쿼리에 부모 상품이 포함됨
확인: +page.server.ts inventoryList 쿼리가 .eq('parent_product_id', rootId)인지 확인
복원: .or(`id.eq.${rootId},parent_product_id.eq.${rootId}`) → .eq('parent_product_id', rootId)로 수정
```

### E. 자식 선택 시 썸네일 빈 박스 (`.ph-thumb` 어두운 사각형만 보임)

```
증상: 패널 헤더 썸네일 영역이 빈 어두운 사각형으로 표시
원인 1: 해당 상품(부모·자식 모두)에 이미지를 등록하지 않은 상태 → 코드 버그 아님
원인 2: 자식 선택 상태에서 이미지 업로드 → 자식 image_urls에만 저장, 부모는 여전히 빈 배열

확인: DB SELECT jsonb_array_length(image_urls) FROM products WHERE id = '<id>'
복원(원인 1): 부모 상품을 선택한 후 이미지 탭에서 이미지 등록
복원(원인 2): 부모 상품을 선택한 후 이미지 재업로드 (자식 image_urls는 무시됨)

구조적 원칙:
  ⛔ 자식 선택 상태에서 이미지 탭 업로드 금지 (카드·썸네일에 반영 안 됨)
  ✅ 이미지는 항상 부모 상품 선택 상태에서 업로드해야 카드에 반영됨
  ℹ️ 자식 선택 시 이미지 탭에 안내 배너 자동 표시 (2026-07-25 구현)
```

### F. "빠른 재고 등록" 클릭 시 "부모 상품의 품번 체계가 설정되지 않았습니다" 에러

```
증상: cloneProduct add_inventory 모드가 fail(400)로 차단됨
원인: 부모에 code_series도 없고 레거시 product_code도 없음
      (2026-08-06 정책 전환 이전에 만들어졌는데 당시에도 등록 흐름 이상으로 품번을 못 받은 경우,
       또는 신규등록 시 generate_product_code RPC 자체가 실패해 code_series가 안 채워진 경우)
확인: DB SELECT product_code, code_series FROM products WHERE id = '<부모id>'
     둘 다 NULL이면 → 그 부모 상품 등록 시점의 regWarn(품번 발행 실패) 경고를 놓쳤을 가능성

✅ 복원(2026-08-XX부터, 삭제·재등록 불필요): 대표 상품 패널에 "품번 체계 설정" 버튼 노출
   (ProductDetailPanel.svelte, product.code_series와 product.product_code 둘 다 NULL일 때만
   표시) — 클릭 한 번으로 generate_product_code를 재실행해 code_series를 정식 설정.
   +page.server.ts retryCodeSeries 액션, §2-4 참고.

예방: §2-10①(regWarn 경고)이 뜨면 반드시 확인 — "품번 발행 실패"는 방치하면 안 되는 경고
```

### G. 자식(재고) 상품 "품번" 행에 "미발행" 배지만 뜨고 QR이 안 생기는 경우

```
증상: 자식 패널 상단 품번 행에 "미발행", QR 영역은 placeholder("QR")만 표시
원인: 과거 "빠른 재고 등록" 당시 generate_inventory_product_code 채번이 실패해
     그 자식만 영구히 product_code 없이 남은 경우(§2-3 레거시 폴백 실패 포함)

✅ 복원: "미발행" 배지 옆 "품번 채번" 버튼 클릭 → 즉시 재시도
   (ProductDetailPanel.svelte retryProductCode, +page.server.ts 동명 액션)
   → 1차 시도 실패 시(레거시 프리픽스 불일치 등) 자동으로 부모 code_series를 새로 설정한 뒤
     1회 추가 재시도 — 대부분 이 한 번의 클릭으로 해결됨(§2-3 참고)
   → 그래도 실패하면 토스트에 실제 서버 에러 메시지가 그대로 표시됨(deserialize 기반)
```

---

## 9. 요구범위 외 영향 차단 — 상품 모듈 전용 체크리스트

### 변경 전 반드시 자문할 질문

```
Q1. 이 변경으로 selectedProduct의 공급 시나리오가 바뀌는가?
    (예: 부모만 선택 → 자식도 선택 가능하게 되는 경우)
    → YES: 아래 필드가 자식 ID로도 올바르게 조회되는지 전수 확인

Q2. prices12h / prices24h / stockCounts 맵의 키(key)가 충분한가?
    → 맵 키 = 목록 productIds(부모) → 자식 ID는 키에 없음
    → selectedProduct에 자식이 올 수 있으면 selectedPriceRules에서 덮어쓰기 필수

Q3. inventoryList 쿼리 조건을 바꿨는가?
    → 아코디언 표시 조건(length > 0) · 단일 패널 분기({:else})와 함께 검토
    → selectProduct(unit.id) 가 가리키는 ID가 자식인지 부모인지 재확인

Q4. 자식 선택 시 image_urls가 올바르게 공급되는가?
    → ⚠️ 2026-08-05 정정: 실제 구현은 "선택된 상품의 고유 배열"이 아니라 자식 선택 시에도
      부모(policyRow)의 image_urls를 조회해서 보여주는 것으로 통일돼 있음(§8-E 안내배너
      정책과 일치하는 의도된 동작 — ProductDetailPanel.svelte 코드 주석에 "이미지까지 이력
      탭을 제외한 전 항목의 조회를 항상 부모 기준으로 통일" 명시)
    → 이미지 업로드는 항상 부모 선택 상태에서 수행되도록 안내 배너로 유도(§8-E 참고)

Q5. 선택된 상품(rootId)이 현재 페이지네이션 범위(productIds, 20개) 밖에 있을 수 있는가?
    → stockCounts/prices12h·24h/rentalStatusCounts는 productIds로만 집계됨(§6 PAGE-SCOPE-1)
    → "대표 카드"(rootProduct)에 새 필드를 추가한다면 이 맵들에 직접 의존하지 말고
      inventoryList 또는 rootId 전용 쿼리로 값을 채울 것 — 아니면 페이지네이션 범위 밖 상품
      선택 시 그 필드만 조용히 0/빈 값으로 잘못 표시됨
```

### selectedProduct가 자식일 때 반드시 동작해야 할 필드

| 필드 | 공급 경로 | 자식 선택 시 안전 여부 |
|---|---|---|
| `qr_payload` | DB `products.qr_payload` | ✅ Migration 168로 보장 |
| `price12h` | `selectedPriceRules` 덮어쓰기 | ✅ 2026-07-25 수정 |
| `price24h` | `selectedPriceRules` 덮어쓰기 | ✅ 2026-07-25 수정 |
| `assetCount`(selectedProduct 자신) | `stockCounts[sp.id]` | ⚠️ 자식 ID는 맵에 없음 → 0 반환 (허용: 이 필드는 화면에 실제 렌더링되지 않는 죽은 필드) |
| `assetCount`/`assetTotal`(rootProduct·대표 카드) | inventoryList 직접 카운트 | ✅ PAGE-SCOPE-1 — 페이지네이션 무관, §6 참고 |
| `product_code` | `select('*')` 포함 | ✅ |
| `is_active` | `select('*')` 포함 | ✅ |

### 카드 가격 표시 — 부모/자식 fallback 정책 (2026-07-25 확정)

```
카드 표시 우선순위: 부모 price_rules → (없으면) 자식 price_rules → null(—)
  ⚠️ 2026-08-05 정정: "첫 번째 자식"이 아니라 12h/24h 각각 독립적으로 순회하며 값을 채움 —
  겹치는 자식이 여러 개면 12h는 A자식, 24h는 B자식에서 오는 등 서로 다른 자식에서 값을
  가져올 수 있음(childFallback12h/24h 각각 별도 조건으로 첫 매치 시 확정)

이유: 자식 선택 후 가격정책 탭 저장 시 자식 ID 기준 저장 → 부모 price_rules 미갱신
     부모 price_rules가 없는 상품의 카드에 —가 표시되는 현상 방지

구현: childFallback12h / childFallback24h 맵
     childRows 쿼리에 price_rules!left 포함 → 별도 쿼리 추가 없음
     return 시: prices24h[p.id] ?? childFallback24h[p.id] ?? null
```

> ⚠️ **가격정책 저장 경로 주의:** 자식 선택 시 가격정책 탭 저장 → `product_id = 자식 ID`
> 부모 price_rules는 별도로 갱신되지 않음(자식→부모 역방향 동기화는 의도적으로 없음).
> 카드는 fallback으로 표시하나, **가격의 정본은 부모 price_rules에 저장하는 것이 원칙.**
>
> ✅ **반대 방향(부모→자식)은 2026-08-06부터 DB 트리거로 자동 동기화됨**
> (`trg_sync_price_rules_to_children`, Migration 190+192) — 부모의 `price_rules`를
> INSERT(처음 추가)하든 UPDATE(기존 수정)하든, 활성 자식들의 동일 `duration_type` 행에
> UPSERT로 즉시 반영된다. 즉 "부모 가격 바꾸면 자식도 따라간다"는 이제 보장되지만,
> "자식 가격 바꾸면 부모도 따라간다"는 여전히 보장 안 됨(의도된 비대칭).

---

## GATE C 확인 항목

```
[ ] 새 상품 복제가 동일 부모 코드품번 상품을 만들 수 있는 경로(코드조합 미선택·1단 조합 중복·수량 2개 이상)를
    추가하지 않았는가? 화면 사전 차단과 서버 검사가 같은 규칙인가? (§2-13 R1~R4)
[ ] 새 상품 복제가 재고(자식)를 만들거나 이미지 파일 주소를 원본과 공유하지 않는가? 장치정보·이력 외
    탭 정보가 빠짐없이 복제되는가? (§2-13 R5·R6)
[ ] 재고 추가가 50개 초과를 허용하지 않고, 순번 상한을 넘기는 요청을 하나도 만들지 않고 차단하는가?
    (§2-13 R7·R8)
[ ] 부모 상품 등록/수정 시 product_code를 채번/기록하는 코드가 추가되지 않았는가? (§2-1)
[ ] 부모 등록 경로(products/new, cloneProduct new_product)가 generate_product_code를
    3개 인자 전부 명시해 호출하는가? (p_code_id 생략 시 PostgREST 오버로드 모호성 에러 재발생)
[ ] "빠른 재고 등록"으로 생성된 자식이 실제 product_code를 받았는가? (code_series 또는
    레거시 product_code 폴백 중 하나는 반드시 있어야 함)
[ ] upsert_product_option_links 등 JSONB 파라미터를 받는 RPC 호출 시 JS 배열/객체를
    그대로 전달하는가? (JSON.stringify로 감싸면 JSONB가 배열이 아닌 문자열 스칼라로 들어가
    jsonb_array_length 등에서 silent fail — 2026-08-XX 실사용 중 2건 발견·수정)
[ ] product_code로 상품을 조회하는 모든 지점이 .ilike()를 쓰는가? (.eq(값.toUpperCase())는
    year_month='all' 채번 시 소문자가 섞여 매칭 실패 — QR-CASE-1, §2-7, 2026-08-XX 3건 수정)
[ ] "미발행" 자식(품번 채번)·code_series 없는 부모(품번 체계 설정) 자가복구 버튼이
    ProductDetailPanel에 여전히 존재하는가? (§8-F, §8-G)
[ ] 품번 재발행/재발급 기능을 신설하지 않았는가? (§2-2 영구고정 정책 위반)
[ ] QR 렌더링이 product.product_code 기준인가? (product.qr_payload 기준 아님, §2-4)
[ ] 부모 상품에는 QR이 표시되지 않는가? (레거시 부모의 자체 product_code가 있어도 동일 —
    BND-7 폐기, QR-HIDE-1, §2-4) — 대신 텍스트 기준 품번(.rep-card-code)만 노출되는가?
[ ] inventoryList 쿼리 — 자식만 (.eq('parent_product_id', rootId))?
[ ] 아코디언 표시 조건 — length > 0?
[ ] 단일 패널(자식 없음) — {:else} 분기 정상 동작?
[ ] 재고 배지 — N(on) / 전체 형식 + 상태별 카운트 칩(§6) 정상 표시?
[ ] 대표 카드(rootProduct)의 재고 배지·가격·상태 칩이 페이지네이션 범위 밖 상품 선택 시에도
    정확한가? (stockCounts 등 productIds 집계 맵에 의존하지 않는가, §6 PAGE-SCOPE-1)
[ ] "빠른 재고 등록" 성공 시 window.open()을 자동 호출하지 않는가? (사용자 제스처 만료로
    거의 항상 팝업 차단됨 — 체크박스만 선택해두고 기존 인쇄 버튼 클릭에 위임, §7 QR-AUTO-1)
[ ] $effect 내 localBasic.is_active = product.is_active 포함?
[ ] 신규 자식 is_active = true (즉시 대여 가능)?
[ ] create_hold_reservation — is_active=true 자식만 할당 대상?
[ ] products RLS가 자식/비활성/삭제 상품을 anon에게 노출하지 않는가? (§2-8, stage/production 둘 다)
[ ] transferCode(코드 이관) 액션이 product_code를 절대 건드리지 않는가? (§2-5)
[ ] sale_only=true 상품 등록 시 24시간 가격 필수 체크가 스킵되는가? (§2-9)
[ ] 탭 저장 시 action="?/updateSection" + section_type 히든 필드 존재?
[ ] 이미지 탭 — isDirty 없음, 자동 저장 패턴?
[ ] 이력 탭 — 지연 로드 (historyLoaded 플래그)? QR 스캔 자동기록과 관리자 수동기록이 같은
    테이블(product_history_records)을 공유하는가?(§2-7)
[ ] 부모(자식 있음) 이력 탭 — 자식 전체 집계 + 등록/수정/삭제 버튼 숨김 상태인가?(§4-2)
[ ] 자식 이력 탭 — 등록/수정/삭제가 그 자식에게만 독립적으로 적용되는가?(§4-2)
[ ] 이력 탭 외 8개 탭 — 자식 선택 시 전부 읽기전용(저장버튼 비노출 + 서버 childBlockedSections
    가드)인가?(§4-1)
[ ] 결합상품(bundles) 탭 저장 시 자기자신·자식·삭제된 상품·중첩·같은 패키지 옵션과의 중복 차단이
    upsert_product_bundle_links RPC 레벨에서 6가지 제약(BUNDLE_SELF_REF·BUNDLE_CHILD_PRODUCT·
    BUNDLE_DELETED_PRODUCT·BUNDLE_NESTING_FORBIDDEN·BUNDLE_IS_NESTED·BUNDLE_OPTION_OVERLAP)으로
    동작하는가? (§2-14)
[ ] 자식 상품 선택 시 결합상품 탭이 childBlockedSections 가드로 숨겨지고 서버(updateSection
    'bundles')도 child_product_blocked로 차단하는가? (§2-14, §4-1)
[ ] 계약서 결합상품 행이 메인상품 뒤·옵션상품 앞에 삽입되며 수량·금액='-',
    비고=formatComponentsText(components)로 표시되는가? (§2-14 계약서 정책)
[ ] Phase 1에서 결합상품 행에 상품코드(상품코드 컬럼)가 노출되지 않는가? (name only — §2-14)
[ ] 결합상품 새 상품 복제 시 원본 부모의 bundle_links가 새 상품에 복사되는가? 복사 실패 시
    regWarn 'bundles'로 경고 처리되는가? (§2-14, §2-10①)
[ ] 재고 추가(add_inventory 모드)에서는 bundle_links를 복사하지 않는가?
    (자식 상품은 결합상품 개념 없음 — §2-14, §4-1)
```

---

*products.md v2.9 | Harness Flow v3.2 | 2026-08-31 §2-12 신설 — 옵션 상품 전용(option_only)
정책 문서화(전역 코드감사 중 코드 주석이 존재하지 않는 §2-12를 참조하던 공백 발견·해소,
Migration #389~393, 카탈로그·홈·하이프팩·검색 등 5곳 제외 + 옵션상품 피커는 영향 없음) |
2026-08-06 품번(product_code) 정책 전면 재설계 —
부모=code_series(구조저장)/자식=실채번, 영구고정, QR=product_code 전환, RLS 보안 수정,
QR 반출입 자동화, sale_only 등록 정책 반영 | 2026-08-XX 부모 QR 노출 폐기(BND-7 폐기),
자가복구 버튼(품번 채번·품번 체계 설정) 추가, 레거시 프리픽스 불일치 자동 우회,
JSONB 파라미터 이중직렬화 버그 수정, 빠른 재고 등록 QR 자동노출(QR-AUTO-1),
대표 카드 페이지네이션 정합성 수정(PAGE-SCOPE-1), QR 스캔 대소문자 불일치 버그 수정
(QR-CASE-1) + 품번 포맷 설정 권한 강화(QR-CASE-2, manager 이상) + ilike 와일드카드 이스케이프
(escapeLikePattern) 반영 | 2026-08-14 §2-3 부모 등록 시 자식(재고) 1개 자동생성을 "기본 재고"
정상 기능 정책으로 Stephen 확정·명문화(제거 시도 금지) | 2026-08-16 QR-LABEL-2 수정 — 2단 계층
기본순번(순번1) 구간 마스킹 해제, 실값 노출로 전환(자식순번은 마스킹 유지) | 2026-08-25 §2-11
신설 — reassign_product_code_series RPC(Migration #341)로 재고 0개 부모상품의 code_series
재할당 기능 추가(§2-2 영구고정 정책은 위반 아님 — 실발급 자식 코드만 보호 대상), "코드
재반영" 버튼을 hasOlderDuplicateCode(후발 중복) 조건으로 재설계해 원본/복제본 양쪽 모두
노출되던 이전 설계를 대체 | 2026-09-24 §2-14 신설 — 결합상품(bundle) 탭 정책(product_bundle_links
테이블, Migration #544, 6가지 제약, 계약서 행 삽입 정책, Phase 1 name only) + §4-1 탭표 bundles
행 추가 + GATE C 결합상품 관련 7개 체크항목 추가*
