# figma-publishing.md — Figma AI 퍼블리싱 스킬
# Harness Flow v3.2 | CrazyShot Figma → SvelteKit 5 변환 기준
# 참조: uiux.md (디자인 시스템) · ui-mobile.md (모바일 UX) · core-rules.md (스택 규칙)

---

## ⛔ 피그마 참고 코드 자의적 해석 금지 (ZERO-INTERPRETATION 원칙)

> 2026-07-03 추가 — 오인 재발 방지 필수 지침

```
피그마 MCP 또는 첨부된 Figma Make 출력 코드(React/Tailwind)를 참고할 때
AI는 절대로 스스로 UI 요소를 추가·삭제·변형해서는 안 된다.

❌ 절대 금지
- 피그마 시안에 없는 UI 요소를 "있으면 좋을 것 같아서" 추가
- 피그마 시안의 배치 구조를 "더 깔끔해 보이도록" 임의 변경
- 참고 코드(React/Tailwind)를 분석해 "의도를 추론"하여 원본과 다른 구조로 구현
- 피그마 노드에 없는 인터랙션·상태를 추측해 삽입
- "일반적인 UX 관례"를 근거로 피그마 시안에 없는 요소 추가

✅ 유일한 허용 기준
- 피그마 MCP get_design_context + get_screenshot으로 시안을 직접 확인
- 시안에 명시된 UI 요소만 1:1로 구현 (노드 구조·배치·색상·크기 기준)
- 시안과 다른 구현이 필요한 경우 → 반드시 Stephen에게 먼저 보고 후 승인 받고 진행

작업 순서:
  1. Figma MCP로 대상 노드 스크린샷 + 코드 확인
  2. 시안 노드 구조를 문서화 (헤더 요소 목록, 레이아웃 방식 등)
  3. 현재 구현과 1:1 대조표 작성 후 차이점만 수정
  4. 범위 외 수정 발견 시 즉시 중단 → Stephen 보고
```

---

## 이 스킬을 사용하는 시점

```
Figma 디자인 → SvelteKit 5 컴포넌트로 퍼블리싱할 때
Figma Make / Figma MCP로 화면을 생성한 후 코드로 옮길 때
신규 페이지·컴포넌트를 설계·구현할 때 (DB 연동 포함)
```

---

## STEP 0 — 시작 전 필수 체크

```
1. Figma 화면에서 사용된 컬러·폰트·반경이 src/app.css CSS 변수에 있는지 확인
2. 비슷한 컴포넌트가 src/lib/components/ 에 이미 있는지 확인 (중복 생성 금지)
3. DB 연동이 필요한지 판단 → 필요 시 STEP 4 (DB 연동 패턴) 참조
4. 페이지인지 컴포넌트인지 확정 → 파일 경로 결정 (STEP 1)
```

---

## STEP 1 — 파일 경로 결정

```
신규 페이지          : src/routes/{domain}/+page.svelte
                      + src/routes/{domain}/+page.server.ts (서버 로드)
재사용 컴포넌트      : src/lib/components/{category}/{Name}.svelte
도메인 서비스        : src/lib/services/{module}.ts
타입 정의            : src/lib/types/{domain}.ts (database.ts는 생성 파일 — 직접 수정 금지)
```

### 컴포넌트 카테고리
```
cart/       → 장바구니·결제 화면 컴포넌트
products/   → 상품 목록·상세 컴포넌트
reservation/→ 예약·가용성 컴포넌트
common/     → 헤더·푸터·버튼·모달 등 범용 UI
```

---

## STEP 2 — 디자인 토큰 변환 규칙

> 모든 값은 CSS 변수로. 하드코딩 #hex / px 값 절대 금지.

### 컬러 매핑 (Figma → CSS 변수)

| Figma 값 | CSS 변수 | 용도 |
|----------|---------|------|
| `#FF4500` | `--cs-orange` | 로고·강조 오렌지 |
| `#100B32` | `--cs-dark` | 헤더·다크 박스·기본 텍스트 |
| `#3B2F8A` | `--cs-purple` | CTA 버튼·선택 강조 |
| `#2E2470` | `--cs-purple-hover` | 버튼 hover |
| `#553FE0` | `--cs-purple-light` | 멤버십 배지 |
| `#ECEBF4` | `--cs-lilac` | 페이지 배경·수량 박스 |
| `rgba(225,222,243,0.4)` | `--cs-lilac-nav` | Nav 필 배경 |
| `#FF3535` | `--cs-red-badge` | 빨간 배지 |
| `#FFFFFF` | `--cs-white` | 카드·바 배경 |
| `#f6f6f6` | `--cs-surface-gray` | 폼·결제금액 블록 |
| `#444444` | `--cs-text-dark` | 보조 텍스트·가격 |
| `#AAAAAA` | `--cs-text-light` | 힌트·비활성 |
| `#b6b6b6` | `--cs-text-placeholder` | 플레이스홀더 |
| `#c1bbec` | `--cs-points` | 포인트 (다크 박스 위) |
| `#E0E0E6` | `--cs-border` | 구분선·테두리 |

### 반경 매핑

| Figma border-radius | CSS 변수 | 적용 대상 |
|--------------------|---------|---------|
| 4px | `--radius-xs` | 태그·배지 텍스트 |
| 8px | `--radius-sm` | 소형 버튼·검색 결과 |
| 15px | `--radius-md` | 폼 입력 (`f-input`) |
| 20px | `--radius-lg` | 날짜 행·라디오·Nav 필 |
| 30px | `--radius-xl` | CTA 버튼·총금액 박스 |
| **50px** | `--radius-2xl` | **흰 카드 (Order·Options·Total)** |
| 9999px | `--radius-full` | 배지 아이콘·원형 태그 |

### 그림자 매핑

| Figma 이펙트 | CSS 변수 |
|------------|---------|
| 진한 다크 오프셋 10/10 | `--shadow-outsh1` |
| 보라 반투명 오프셋 4/4 | `--shadow-outsh2` |
| #100B32 오프셋 5/5 | `--shadow-outsh3` |
| 흰 글로우 | `--shadow-outsh4` |
| 검은 그림자 4/5 | `--shadow-outsh5` |
| 하단 바 | `--shadow-bottom-bar` |

### 타이포그래피 매핑

```css
/* 사용법: font: var(--text-pc-title-18); */

/* PC */
섹션 헤더 (25px Bold)   → --text-pc-htitle-25
섹션 타이틀 (18px Bold) → --text-pc-title-18
카드 타이틀 (16px Bold) → --text-pc-title-16
본문 강조 (14px Bold)   → --text-pc-body-14
캡션 (12px)             → --text-pc-script-12
영문 메뉴 (20px)        → --text-pc-menu-en-20
한글 메뉴 (20px)        → --text-pc-menu-kr-20

/* Mobile */
주요 제목 (24px Black)  → --text-m-htitle-24B
카드 제목 (21px Bold)   → --text-m-title-21
소섹션 (18px Bold)      → --text-m-title-18B
본문 강조 (16px Bold)   → --text-m-body-16B
기본 본문 (16px Medium) → --text-m-body-16L
레이블 강조 (14px Bold) → --text-m-script-14B
보조 정보 (14px)        → --text-m-script-14
캡션 (12px)             → --text-m-script-12
```

---

## STEP 3 — SvelteKit 5 컴포넌트 템플릿

### 기본 컴포넌트 뼈대

```svelte
<script lang="ts">
  import type { SomeType } from '$lib/types/database'

  interface Props {
    /** 필수 props에 간단한 설명 */
    productId: string
    initialData?: SomeType | null
  }

  let { productId, initialData = null }: Props = $props()

  // 상태
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let data = $state(initialData)

  // 파생 값
  let displayPrice = $derived(data ? formatPrice(data.price) : '--')

  // 사이드이펙트 (cleanup 필수)
  $effect(() => {
    // ...
    return () => { /* cleanup */ }
  })

  function formatPrice(price: number): string {
    return price.toLocaleString('ko-KR') + '원'
  }
</script>

<!-- ✅ 터치 타겟 44×44px 이상 보장 -->
<div class="component-root">
  {#if isLoading}
    <div class="skeleton" aria-label="로딩 중..."></div>
  {:else if error}
    <p role="alert" class="error-msg">{error}</p>
  {:else if data}
    <!-- 실제 UI -->
  {/if}
</div>

<style>
  .component-root {
    /* CSS 변수만 사용 */
  }
  .error-msg {
    color: var(--cs-error);
    font: var(--text-m-script-14);
  }
</style>
```

### 페이지 레이아웃 템플릿

```svelte
<div class="page-container">
  <section class="page-section">
    <!-- 콘텐츠 -->
  </section>
</div>

<style>
  .page-container {
    max-width: var(--layout-pc-max);
    margin: 0 auto;
    padding: var(--layout-section-gap) var(--layout-pc-pad);
    display: flex;
    flex-direction: column;
    gap: var(--layout-section-gap);
    /* 헤더 겹침 방지 */
    padding-top: calc(var(--layout-header-h) + var(--layout-section-gap));
  }

  @media (max-width: 1024px) {
    .page-container { padding-inline: var(--layout-tab-pad); }
  }
  @media (max-width: 640px) {
    .page-container { padding-inline: var(--layout-mob-pad); gap: 28px; }
  }
</style>
```

### 핵심 컴포넌트 패턴

```svelte
<!-- 흰 카드 (주요 섹션 컨테이너) -->
<div class="white-card">...</div>
<style>
  .white-card { background: var(--cs-white); border-radius: var(--radius-2xl); overflow: hidden; }
</style>

<!-- CTA 버튼 (Primary) -->
<button class="cta-btn" onclick={handleSubmit} disabled={isLoading}>
  {#if isLoading}처리 중...{:else}예약하기{/if}
</button>
<style>
  .cta-btn {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    height: 60px;
    width: 100%;
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .cta-btn:hover    { background: var(--cs-purple-hover); }
  .cta-btn:disabled { background: #B0ABCC; cursor: not-allowed; }
</style>

<!-- 폼 입력 -->
<input class="f-input" type="text" placeholder="입력해주세요" />
<style>
  .f-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-md);
    padding: 12px 20px;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    width: 100%;
  }
  .f-input::placeholder { color: var(--cs-text-placeholder); }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
</style>

<!-- 총금액 다크 박스 -->
<div class="total-box">
  <span class="total-label">합계</span>
  <span class="total-price">120,000원</span>
</div>
<style>
  .total-box {
    background: var(--cs-dark);
    border-radius: var(--radius-xl);
    padding: 24px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .total-label { font: var(--text-m-body-16B); color: var(--cs-points); }
  .total-price { font: var(--text-m-title-21); color: var(--cs-white); }
</style>

<!-- Nav 필 (반투명 라벤더) -->
<nav class="nav-pill">...</nav>
<style>
  .nav-pill {
    background: var(--cs-lilac-nav);
    border: 1px solid rgba(255,255,255,0.6);
    backdrop-filter: blur(8px);
    border-radius: var(--radius-lg);
    padding: 16px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
</style>

<!-- 하단 고정 바 -->
<div class="bottom-bar">...</div>
<style>
  .bottom-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: var(--cs-white);
    box-shadow: var(--shadow-bottom-bar);
    height: var(--layout-footer-h);
    display: flex;
    align-items: center;
    padding: 0 var(--layout-mob-pad);
  }
</style>
```

---

## STEP 4 — DB 연동 패턴

### 서버사이드 데이터 로드 (+page.server.ts)

```typescript
// src/routes/{domain}/+page.server.ts
import { createServerClient } from '@supabase/ssr'
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
  // 인증 필요한 페이지
  const { session } = await locals.safeGetSession()
  if (!session) throw redirect(303, '/login')

  // RPC 경유 데이터 조회 (직접 쿼리 지양)
  const { data, error } = await locals.supabase
    .rpc('get_product_detail', { p_product_id: params.id })

  if (error) {
    console.error('[load] product detail error:', error)
    return { product: null, error: error.message }
  }

  return { product: data, session }
}
```

### 클라이언트 서비스 패턴 (src/lib/services/{module}.ts)

```typescript
import { supabase } from '$lib/services/supabase'
import type { Database } from '$lib/types/database'

// ✅ RPC 경유 (직접 INSERT/UPDATE/DELETE 금지 — H-01)
export async function reserveAsset(params: {
  productId: string
  assetId: string
  userId: string
  startDate: string  // YYYY-MM-DD
  endDate: string
  idempotencyKey: string
}): Promise<{ success: boolean; reservationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('atomic_reserve_asset', {
    p_product_id: params.productId,
    p_asset_id:   params.assetId,
    p_user_id:    params.userId,
    p_start_date: params.startDate,
    p_end_date:   params.endDate,
    p_idempotency_key: params.idempotencyKey
  })

  if (error) return { success: false, reservationId: null, error: error.message }
  return { success: data.success, reservationId: data.reservation_id, error: data.error }
}

// ✅ 가용성 조회 (expires_at 필터 필수 — H-04)
export async function checkAvailability(productId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase.rpc('check_asset_availability', {
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date:   endDate
  })
  return { data, error }
}
```

### Realtime 구독 ($effect 패턴)

```svelte
<script lang="ts">
  import { supabase } from '$lib/services/supabase'

  let availability = $state<boolean | null>(null)

  $effect(() => {
    // 구독 설정
    const channel = supabase
      .channel(`availability:${productId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rental_reservations',
        filter: `product_id=eq.${productId}`
      }, (payload) => {
        // 상태 업데이트
        availability = payload.new.status !== 'confirmed'
      })
      .subscribe()

    // cleanup 필수 — onDestroy 또는 $effect 반환값
    return () => {
      supabase.removeChannel(channel)
    }
  })
</script>
```

### 자주 쓰는 RPC 함수 목록

```typescript
// M1 Products
supabase.rpc('get_product_list', { p_category?, p_page?, p_limit? })
supabase.rpc('get_product_detail', { p_product_id })

// M2 Reservations
supabase.rpc('atomic_reserve_asset', { p_product_id, p_asset_id, p_user_id, p_start_date, p_end_date, p_idempotency_key })
supabase.rpc('check_asset_availability', { p_product_id, p_start_date, p_end_date })

// M3 Payment
supabase.rpc('calculate_cart_total', { p_user_id, p_reservation_ids, p_coupon_code?, p_points_to_use? })
// → { total, breakdown, calc_at }

supabase.rpc('processPaymentAndCreateOrder', { p_payment_key, p_order_id, p_amount, p_idempotency_key })

// M4 Membership
supabase.rpc('get_user_profile', { p_user_id })
```

---

## STEP 5 — 이미지 처리

```svelte
<!-- Cloudinary CDN 최적화 (항상 이 패턴 사용) -->
<img
  src="https://res.cloudinary.com/crazyshot/image/upload/w_{width},h_{height},c_fill,f_auto,q_auto/{publicId}.jpg"
  alt="제품명 — 촬영 장비 설명"
  width="{width}"
  height="{height}"
  loading="lazy"
/>

<!-- 썸네일: w_400,h_300 -->
<!-- 상세: w_800,h_600 -->
<!-- 배너: w_1240,h_500 -->
```

---

## STEP 6 — 반응형 & 접근성

```css
/* 반응형 브레이크포인트 */
@media (max-width: 1024px) { /* 태블릿 */ }
@media (max-width: 640px)  { /* 모바일 */ }

/* 터치 타겟 최소 크기 */
button, a, [role="button"], input[type="checkbox"], input[type="radio"] {
  min-height: 44px;
  min-width: 44px;
}

/* 탭 아이템 */
.tab-item { min-height: 48px; }
```

```svelte
<!-- 접근성 필수 패턴 -->
<img src="..." alt="소니 A7IV 풀프레임 미러리스 카메라" />  <!-- alt 필수 -->
<button aria-label="장바구니 추가">+</button>               <!-- 텍스트 없는 버튼 -->
<div role="dialog" aria-modal="true" aria-label="예약 확인"> <!-- 모달 -->
<p role="alert" aria-live="assertive">{errorMsg}</p>         <!-- 에러 메시지 -->
```

---

## STEP 7 — 퍼블리싱 완료 체크리스트 (GATE C 기준)

### 디자인 시스템
```
[ ] CSS 변수 사용 — 하드코딩 #hex / px 값 없음?
[ ] 흰 카드: border-radius: var(--radius-2xl) (50px)?
[ ] CTA 버튼: var(--cs-purple) + var(--radius-xl) + height 60px?
[ ] 폼 입력: var(--cs-surface-gray) 배경, border: none?
[ ] 총금액 박스: var(--cs-dark) 배경, var(--radius-xl)?
[ ] 텍스트: var(--cs-text) / var(--cs-text-dark) 사용?
[ ] 헤더 높이: var(--layout-header-h) (100px)?
[ ] 섹션 간격: gap: var(--layout-section-gap) (50px)?
```

### SvelteKit 5 문법
```
[ ] $props() 사용 (export let 금지)?
[ ] $state() 사용 (writable store 금지)?
[ ] onclick={handler} (on:click 금지)?
[ ] $effect() cleanup 반환값 있음?
[ ] TypeScript any 타입 없음?
[ ] 함수 반환 타입 명시?
```

### 모바일 UX
```
[ ] 모든 인터랙티브 요소 44×44px 이상?
[ ] 이미지 alt 속성 존재?
[ ] Cloudinary CDN URL 사용?
[ ] loading="lazy" 적용?
[ ] 반응형 브레이크포인트 (640px / 1024px)?
```

### DB 연동
```
[ ] 직접 INSERT/UPDATE/DELETE 없음 — RPC 경유?
[ ] 가용성 쿼리에 expires_at 필터 있음?
[ ] Realtime 구독 cleanup ($effect 반환값)?
[ ] 서버 키 $env/static/private 전용?
[ ] 서버사이드 입력 검증 존재?
[ ] N+1 쿼리 없음 (RPC 또는 join 사용)?
[ ] console.log 없음?
```

---

## 자주 발생하는 실수

```
❌ border-radius: 50px  →  ✅ border-radius: var(--radius-2xl)
❌ color: #100B32       →  ✅ color: var(--cs-dark)
❌ font-size: 18px      →  ✅ font: var(--text-pc-title-18)
❌ on:click={fn}        →  ✅ onclick={fn}
❌ export let prop      →  ✅ let { prop }: Props = $props()
❌ writable(0)          →  ✅ $state(0)
❌ supabase.from('x').insert(...)  →  ✅ supabase.rpc('rpc_name', {...})
❌ import SUPABASE_SERVICE_ROLE_KEY from '$env/static/public'
   →  ✅ from '$env/static/private'
❌ .in('status', ['temp', 'confirmed'])  (만료 HOLD 포함)
   →  ✅ .or(`status.eq.confirmed,and(status.eq.temp,expires_at.gt.${now})`)

❌ GNB에 position: sticky 사용 → ✅ position: fixed (오버레이)
❌ GNB 래퍼에 background 색상 → ✅ background: transparent
❌ hero 아래 margin-top 보정값 → ✅ fixed GNB는 레이아웃 공간 미점유, 보정 불필요
❌ CSS transform 조상 내부에서 position:fixed 모달 열기 → ✅ transform 해제 후 열기
```

---

## STEP 0 추가 — 공통 레이아웃 고정값 확인 (신규 페이지 작업 시 필수)

> 피그마 시안에서 레이아웃 구조를 볼 때 반드시 아래 확정값과 대조할 것.

### GNB (공통 헤더) 원칙
```
GNB는 항상 콘텐츠 위에 오버레이 — 별도 상단 영역 없음
- position: fixed (PC & 모바일 공통)
- pointer-events: none (래퍼) + pointer-events: all (nav 자체)
- 모바일 래퍼 background: transparent
- 콘텐츠(hero 포함)는 페이지 top: 0 기준 시작 (margin-top 보정 금지)
```

### Hero 섹션 높이 확정값
```
모바일 (.m-hero): 720px
PC (.d-hero):     936px  (= 720 × 1.3)
변경 시: 두 값의 비율 1.3 유지
```

### FloatingBar FAB 아이콘 크기 확정값
```
장바구니·검색 FAB:
  모바일(< 640px): 55px × 55px
  PC(≥ 640px):    40px × 40px

채팅 FAB (FloatingButton 컴포넌트):
  모바일(< 640px): 70px × 70px  ← 강조 의도, 변경 금지
  PC(≥ 640px):    40px × 40px

⚠️ 채팅 FAB 크기는 FloatingButton.svelte 내부 fab-btn svg에서 관리.
   FloatingBar.svelte에서 직접 제어 금지.
```

### CSS transform + position:fixed 충돌 주의
```
⚠️ transform이 적용된 조상 내부의 position:fixed 자식은
   뷰포트 기준이 아닌 transform 요소 기준으로 배치 → 모달 위치 왜곡

해결 원칙: transform 활성 상태에서는 fixed 모달 열기 차단
  peek 상태 예시: pointer-events:none 으로 FloatingButton 래퍼 차단
```

---

*figma-publishing.md | Harness Flow v3.2 | CrazyShot Figma AI 퍼블리싱 스킬*
*참조: src/app.css (토큰 정본) · uiux.md · ui-mobile.md · core-rules.md*
