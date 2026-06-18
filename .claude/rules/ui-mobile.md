# ui-mobile.md — 모바일 UX 기준 + SvelteKit 5 UI 규칙
# Harness Flow v3.1 | 크레이지샷 모바일 퍼스트 UI

---

## SvelteKit 5 컴포넌트 패턴

```svelte
<!-- ✅ Svelte 5 Runes 컴포넌트 -->
<script lang="ts">
  interface Props {
    productId: string
    initialDate?: string
  }

  let { productId, initialDate = '' }: Props = $props()

  let selectedDate = $state(initialDate)
  let isLoading = $state(false)
  let price = $derived(calculatePrice(selectedDate))

  $effect(() => {
    // 사이드이펙트 — cleanup 반환
    const subscription = subscribeToAvailability(productId)
    return () => subscription.unsubscribe()
  })
</script>

<!-- ❌ Svelte 4 문법 (금지) -->
<script>
  export let productId  // → $props() 사용
  import { writable } from 'svelte/store'  // → $state() 사용
  let store = writable(0)  // → let value = $state(0)
</script>
```

---

## 이벤트 핸들러

```svelte
<!-- ✅ Svelte 5 -->
<button onclick={handleClick}>확인</button>
<input oninput={handleInput} />
<form onsubmit={handleSubmit}>

<!-- ❌ Svelte 4 (금지) -->
<button on:click={handleClick}>
<input on:input={handleInput}>
```

---

## 모바일 터치 타겟

```css
/* 모든 인터랙티브 요소: 최소 44×44px */
button, a, [role="button"] {
  min-height: 44px;
  min-width: 44px;
}

/* 탭 인터페이스: 최소 48px 높이 */
.tab-item {
  min-height: 48px;
  padding: 0 16px;
}
```

---

## CSS 변수 (하드코딩 금지)

```css
/* ✅ 변수 사용 */
color: var(--color-primary);
background: var(--color-surface);
border-radius: var(--radius-md);
gap: var(--spacing-4);

/* ❌ 하드코딩 (금지) */
color: #ff4500;
background: #f5f5f5;
```

### 크레이지샷 디자인 토큰 (`src/app.css` 참조)

> 전체 토큰 정의: `src/app.css` | 디자인 가이드라인: `.cursor/rules/uiux.mdc`

```css
/* 주요 컬러 */
--cs-orange:       #FF4500   /* CrazyShot 오렌지 */
--cs-dark:         #100B32   /* 헤더·총금액 박스 */
--cs-purple:       #3B2F8A   /* CTA 버튼·선택 강조 */
--cs-lilac:        #ECEBF4   /* 페이지 배경·수량 박스 */
--cs-text:         #100B32   /* 기본 텍스트 */
--cs-text-dark:    #444444   /* 가격·보조 레이블 */
--cs-surface-gray: #f6f6f6   /* 폼 입력·결제금액 블록 */

/* 반경 */
--radius-md:   15px   /* 폼 입력 */
--radius-lg:   20px   /* 날짜 행·라디오 컨테이너 */
--radius-xl:   30px   /* CTA 버튼·총금액 박스 */
--radius-2xl:  50px   /* 흰 카드 (가장 중요) */

/* 레이아웃 */
--layout-pc-max:      1240px
--layout-section-gap: 50px
--layout-header-h:    100px
```

---

## 이미지 (Cloudinary CDN)

```svelte
<!-- ✅ Cloudinary 최적화 URL -->
<img
  src="https://res.cloudinary.com/crazyshot/image/upload/w_400,h_300,c_fill,f_auto,q_auto/{publicId}.jpg"
  alt="제품명 — 상세 설명"
  width="400"
  height="300"
  loading="lazy"
/>

<!-- ❌ 금지: alt 없음, 하드코딩 S3 URL, loading 없음 -->
```

---

## 로딩 상태

```svelte
<!-- ✅ 스켈레톤 로더 패턴 -->
{#if isLoading}
  <div class="skeleton" aria-label="로딩 중...">
    <div class="skeleton-line"></div>
  </div>
{:else}
  <ProductCard {product} />
{/if}

<!-- ✅ 버튼 로딩 상태 -->
<button disabled={isLoading} onclick={handleSubmit}>
  {#if isLoading}처리 중...{:else}예약하기{/if}
</button>
```

---

## 접근성 기준

```
이미지       : alt 필수 (장식용은 alt="")
버튼         : 명확한 텍스트 레이블 또는 aria-label
모달         : role="dialog" + aria-modal="true" + 포커스 트랩
폼 입력      : <label for="id"> 또는 aria-label
에러 메시지  : role="alert" + aria-live="assertive"
색상 대비    : 최소 4.5:1 (WCAG AA)
```

---

## 배송 마감 UI 표시 기준

```
epost/CJ   : 15:00 마감 표시
quick      : 17:00 마감 표시
locker     : 18:00 마감 표시
pickup     : 19:00 마감 표시
두발히어로  : 14:00 마감 (화면: 13:30 표시 — 여유 30분)
공휴일      : "다음 영업일" 표시 (public_holidays 테이블 조회)
```

---

## GATE C 확인 항목 (UI 관련)

```
[ ] 모든 인터랙티브 요소 44×44px 이상?
[ ] 하드코딩 색상 없음 (var(--) 사용)?
[ ] Cloudinary CDN URL 사용?
[ ] 이미지 alt 속성 존재?
[ ] 버튼·링크 명확한 레이블?
[ ] Svelte 4 문법 없음? (on:event → onevent)
[ ] writable store 대신 $state() 사용?
[ ] 새 컴포넌트 생성 전 기존 컴포넌트 확인?
```

---

*ui-mobile.md v3.1 | Harness Flow v3.1 | 모바일 퍼스트 UI*
