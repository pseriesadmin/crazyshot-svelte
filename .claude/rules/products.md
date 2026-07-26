# products.md — 상품 관리 표준 정책
# Harness Flow v3.2 | 2026-07-25 확정

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

---

## 2. ⛔⛔⛔ 독립 코드 + 전용 QR 정책 (핵심 — 위반 즉시 중단)

```
모든 상품은 부모·자식 구분 없이 반드시:
  ① 독립 품번 (product_code) — 자신의 고유 코드
  ② 전용 QR URL (qr_payload) — 자신의 UUID 기반 고유 URL

❌ 절대 금지: 자식이 부모의 qr_payload를 상속·공유
❌ 절대 금지: qr_payload = null 상태로 자식 상품 생성
✅ 필수 형식: 'https://crazyshot.kr/qr/product/' || product.id
```

### QR 생성 타이밍

```sql
-- auto_create_inventory_for_product (Migration 168 기준)
-- INSERT 시 NULL → RETURNING id 확정 후 UPDATE로 설정
INSERT INTO products (..., qr_payload) VALUES (..., NULL)
RETURNING id INTO v_child_id;

UPDATE products
SET qr_payload = 'https://crazyshot.kr/qr/product/' || v_child_id
WHERE id = v_child_id;
```

```typescript
// cloneProduct add_inventory 모드 (+page.server.ts)
// ✅ INSERT 시 직접 설정 가능 (id를 미리 생성)
const newId = crypto.randomUUID()
.insert({ id: newId, qr_payload: `https://crazyshot.kr/qr/product/${newId}`, ... })
```

### QR 렌더링 패턴 (ProductDetailPanel.svelte)

```svelte
<!-- panel-header 내 qr-wrap -->
{#if product.qr_payload}
  <canvas bind:this={canvasEl} width="88" height="88"></canvas>
  <button onclick={downloadQR}>↓ QR 저장</button>
{:else}
  <div class="qr-placeholder" aria-label="QR 코드 준비 중">QR</div>
{/if}
```

```typescript
// QR $effect — canvasEl 바인딩 후 자동 실행
$effect(() => {
  const qr = product.qr_payload
  const canvas = canvasEl
  if (!qr || !canvas) return
  renderQR(canvas, qr)
})
```

> **디버그 기준:** QR placeholder가 보이면 → `product.qr_payload` null 확인 → DB 백필 필요 (Migration 168 STEP 2 참고)

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

## 4. ProductDetailPanel 탭 구조

```
파일: src/lib/components/cms/ProductDetailPanel.svelte
타입: TabKey = 'basic' | 'options' | 'pricing' | 'rental' | 'content' | 'components' | 'images' | 'specs' | 'history'
기본 탭: 'basic' (URL ?tab=<key>로 초기 탭 지정 가능)
```

| 탭 key | 레이블 | section_type | 저장 방식 | 관리 데이터 |
|---|---|---|---|---|
| `basic` | 기본정보 | `basic` | 저장 버튼 | name · brand · product_caption · is_active · category |
| `basic` | (슬러그) | `slug` | 저장 버튼 (별도) | slug (URL 코드) |
| `options` | 옵션상품 | `options` | 저장 버튼 | option_links (연관상품 JSON) |
| `pricing` | 가격정책 | `pricing` | 저장 버튼 | price_12h · price_24h · price_monthly · deposit · late_fee · damage_fee · sale_price · sale_only |
| `rental` | 대여정책 | `rental` | 저장 버튼 | allowed_period_ids · allowed_method_ids · allowed_pickup_ids · 배송옵션 |
| `content` | 상품설명 | `content` | 저장 버튼 | content_blocks · keywords |
| `components` | 구성품 | `components` | 저장 버튼 | components (key-value) |
| `images` | 이미지 | `images` | **자동 저장** (업로드·삭제 즉시) | image_urls |
| `specs` | 사양 | `specs` | 저장 버튼 | specifications (key-value) |
| `history` | 이력 | — | 읽기 전용 (지연 로드) | 대여 이력 목록 |

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
⑤ FOR UPDATE SKIP LOCKED (동시 예약 충돌 방지)
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

---

## 7. 인벤토리 아코디언 UI 정책

```
표시 조건: inventoryList.length > 0 (자식 1개 이상)
단일 패널: inventoryList.length === 0 (자식 없음 → {:else} 분기로 부모 직접 표시)

아코디언 클릭: selectProduct(unit.id) → URL ?selected=<자식ID>
  → 서버: selectedProduct = 자식 상품 데이터
  → 패널: 자식의 기본정보·가격·QR 등 표시
```

> 자식 선택 시 **자식 자신의 qr_payload** 표시 (부모 공유 금지)
> 자식에 qr_payload가 없으면 placeholder → DB 이상 → Migration 168 STEP 2로 백필

---

## 8. 오류 발생 시 복원·정합 기준

### A. QR placeholder 표시 ("QR" 텍스트만 보임)

```
증상: div.qr-placeholder 렌더링 (캔버스 없음)
원인: product.qr_payload = null
확인: DB SELECT qr_payload FROM products WHERE id = '<product_id>'
복원: UPDATE products SET qr_payload = 'https://crazyshot.kr/qr/product/' || id
      WHERE id = '<product_id>'
예방: 자식 생성 시 반드시 qr_payload 설정 (섹션 2 참고)
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
    → image_urls는 parent_product_id 기준 쿼리 결과가 아닌 선택된 상품의 고유 배열
    → 자식에 이미지 없고 부모에 있어도 thumbnail에 자동 fallback 없음
    → 이미지 업로드는 항상 부모 선택 상태에서 수행되도록 안내 필요
```

### selectedProduct가 자식일 때 반드시 동작해야 할 필드

| 필드 | 공급 경로 | 자식 선택 시 안전 여부 |
|---|---|---|
| `qr_payload` | DB `products.qr_payload` | ✅ Migration 168로 보장 |
| `price12h` | `selectedPriceRules` 덮어쓰기 | ✅ 2026-07-25 수정 |
| `price24h` | `selectedPriceRules` 덮어쓰기 | ✅ 2026-07-25 수정 |
| `assetCount` | `stockCounts[sp.id]` | ⚠️ 자식 ID는 맵에 없음 → 0 반환 (허용: 자식은 재고 패널 미노출) |
| `product_code` | `select('*')` 포함 | ✅ |
| `is_active` | `select('*')` 포함 | ✅ |

### 카드 가격 표시 — 부모/자식 fallback 정책 (2026-07-25 확정)

```
카드 표시 우선순위: 부모 price_rules → (없으면) 첫 번째 자식 price_rules → null(—)

이유: 자식 선택 후 가격정책 탭 저장 시 자식 ID 기준 저장 → 부모 price_rules 미갱신
     부모 price_rules가 없는 상품의 카드에 —가 표시되는 현상 방지

구현: childFallback12h / childFallback24h 맵
     childRows 쿼리에 price_rules!left 포함 → 별도 쿼리 추가 없음
     return 시: prices24h[p.id] ?? childFallback24h[p.id] ?? null
```

> ⚠️ **가격정책 저장 경로 주의:** 자식 선택 시 가격정책 탭 저장 → `product_id = 자식 ID`
> 부모 price_rules는 별도로 갱신되지 않음. 카드는 fallback으로 표시하나,
> **가격의 정본은 부모 price_rules에 저장하는 것이 원칙** (향후 정책 정합 검토 필요)

---

## GATE C 확인 항목

```
[ ] 자식 상품 생성 시 qr_payload 설정됨? (null 금지)
[ ] qr_payload = 'https://crazyshot.kr/qr/product/' || 자신의 UUID?
[ ] 자식이 부모의 qr_payload를 공유하지 않음?
[ ] inventoryList 쿼리 — 자식만 (.eq('parent_product_id', rootId))?
[ ] 아코디언 표시 조건 — length > 0?
[ ] 단일 패널(자식 없음) — {:else} 분기 정상 동작?
[ ] 재고 배지 — N(on) / 전체 형식?
[ ] $effect 내 localBasic.is_active = product.is_active 포함?
[ ] 신규 자식 is_active = true (즉시 대여 가능)?
[ ] create_hold_reservation — is_active=true 자식만 할당 대상?
[ ] 탭 저장 시 action="?/updateSection" + section_type 히든 필드 존재?
[ ] 이미지 탭 — isDirty 없음, 자동 저장 패턴?
[ ] 이력 탭 — 지연 로드 (historyLoaded 플래그)?
```

---

*products.md v1.1 | Harness Flow v3.2 | 2026-07-25 전면 보강*
