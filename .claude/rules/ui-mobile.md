# ui-mobile.md — 모바일 UX 기준 + SvelteKit 5 UI 규칙
# Harness Flow v3.1 | 크레이지샷 모바일 퍼스트 UI

---

## ⛔ $state(prop) 초기화 절대 금지 (2026-07-07)

> 동일 내용 core-rules.md에도 등록. 모든 컴포넌트 작성 시 반드시 준수.

```svelte
<!-- ❌ 절대 금지 — prop으로 $state 초기화 (마운트 시 1회만 실행, prop 변경 무시됨) -->
let local = $state(product.name)
let local = $state(priceRules.find(r => r.duration_type === '24h')?.price)

<!-- ✅ 올바른 패턴 1 — 부모에서 {#key}로 재마운트 강제 -->
{#key data.selectedId}
  <DetailPanel product={data.selectedProduct} />
{/key}

<!-- ✅ 올바른 패턴 2 — prop 동기화가 필요할 때 $effect 사용 -->
let viewYear = $state(value ? parseInt(value.slice(0,4)) : today.getFullYear())
$effect(() => {
  if (value) viewYear = parseInt(value.slice(0, 4))
})
```

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
  <ProductDPCard {product} />
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

## GNB 모바일 레이아웃 원칙

> 확정 기준: 2026-08-10 구현값 반영 (GNB.svelte 정본)

```
모바일 GNB: position: fixed + background: transparent
- GNB가 히어로/배너 콘텐츠 위에 오버레이 (별도 상단 공간 없음)
- 콘텐츠는 top: 0 기준 시작 — GNB 높이만큼 padding 보정 금지
- 래퍼: pointer-events: none / nav 자체: pointer-events: all
```

### 모바일 GNB nav 확정값

| 속성 | 값 | 비고 |
|---|---|---|
| height | **61px** | 고정값 |
| border-radius | **22px** | pill 형태 |
| background | **#1d183e** | 다크 네이비 |
| padding | **0 20px** | 좌우 여백 |
| overflow | **visible** | BI 상하 넘침 허용 |

### 모바일 BI 로고 확정값

| 속성 | 값 | 비고 |
|---|---|---|
| width | **117px** | GNB 기준 +10% |
| height | **72px** | GNB(61px) 상하 ~5.5px 넘침 |
| transform | **translateY(-3px)** | 5% 상향 배치 |

> BI는 GNB 상하를 의도적으로 벗어남 (브랜드 강조). `overflow: visible` 필수.

### 모바일 아바타 버튼 확정값

| 속성 | 값 | 비고 |
|---|---|---|
| width / height | **40px** | 터치타겟 최소값 |
| border-radius | **50%** | 완전 원형 |
| background | **rgba(85, 63, 224, 0.60)** | --cs-purple-light 60% 불투명 |
| 이니셜 컬러 | **#ffffff** | 흰색 고정 |
| font-size | **18px** | Bold, uppercase |

> 아바타 BG 60% 투명도: GNB 다크 배경이 옅게 비춰 경계면 자연스럽게 혼합.

```css
/* ✅ 모바일 GNB 필수 패턴 */
.gnb-mobile-wrap {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 50;
  background: transparent;
  pointer-events: none;
}
.gnb-mobile-nav {
  height: 61px;
  border-radius: 22px;
  background: #1d183e;
  padding: 0 20px;
  overflow: visible;   /* BI 상하 넘침 허용 */
  pointer-events: all;
}
.gnb-logo-mobile {
  width: 117px;
  height: 72px;
  transform: translateY(-3px);  /* 5% 상향 배치 */
}
.gnb-avatar-btn {
  width: 40px; height: 40px;
  min-width: 40px; min-height: 40px;
}
.gnb-avatar-btn-initial {
  background: rgba(85, 63, 224, 0.60);
  border-radius: 50%;
  color: #ffffff;
}

/* ❌ 절대 금지 */
.gnb-mobile-wrap { position: sticky; }         /* 레이아웃 공간 점유 */
.gnb-mobile-wrap { background: var(--cs-lilac); } /* 배경색 가림 */
```

---

## 바텀 탭바 스크롤 인터랙션 — 강제 정책 (2026-07-22 확정)

> `BottomTabBar.svelte` 구현·수정 시 **반드시** 아래 스크롤 인터랙션을 포함한다.
> 정본 컴포넌트: `src/lib/components/common/BottomTabBar.svelte`

### 동작 규칙

```
스크롤 다운 → 바텀 탭바 가림  (translateY(+100%))
스크롤 업   → 바텀 탭바 보임  (translateY(0))
scrollY ≤ 50px → 항상 보임 (최상단 보호)
PC (≥768px) → 항상 숨김 (display: none) — 모바일 전용
```

### 표준 구현 패턴 (BottomTabBar.svelte 정본 기준)

```svelte
<script lang="ts">
  // 스크롤 인터랙션: 다운 → 가림, 업 → 보임
  let hidden = $state(false)
  let lastY = 0

  function onScroll() {
    const y = window.scrollY
    if (y > lastY && y > 50) hidden = true   // 스크롤 다운 → 가림
    else if (y < lastY)       hidden = false  // 스크롤 업 → 보임
    lastY = y
  }

  $effect(() => {
    lastY = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })
</script>

<div class="tab-bar" class:hidden>
  ...
</div>
```

```css
.tab-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 50;
  background: var(--cs-lilac);
  box-shadow: 0 -4px 24px rgba(0,0,0,0.1);
  height: 70px;
  transform: translateY(0);
  transition: transform 0.3s ease;   /* ← 필수 */
}
.tab-bar.hidden {
  transform: translateY(100%);       /* ← 아래로 가림 */
}
@media (min-width: 768px) {
  .tab-bar { display: none; }        /* ← PC 숨김 */
}
```

### GATE C 확인 항목

```
[ ] 스크롤 다운 → translateY(+100%) 가림 동작?
[ ] 스크롤 업 → translateY(0) 보임 동작?
[ ] scrollY ≤ 50px 구간 항상 보임 처리?
[ ] transition: transform 0.3s ease 적용?
[ ] passive 스크롤 리스너 사용?
[ ] $effect cleanup에서 removeEventListener 호출?
[ ] PC(≥768px)에서 display:none 처리?
```

---

## GNB · SubGnb 스크롤 인터랙션 — 강제 정책 (2026-07-22 확정)

> GNB (`GNB.svelte`) 또는 SubGnb (`SubGnb.svelte`) 구현·수정 시 **반드시** 아래 스크롤 인터랙션을 함께 적용한다.

### 동작 규칙

```
스크롤 다운 → GNB / SubGnb 가림  (translateY(-100%))
스크롤 업   → GNB / SubGnb 보임  (translateY(0))
최상단(scrollY ≤ 60px) → 항상 보임
```

### 표준 구현 패턴 (Svelte 5 Runes)

```svelte
<script lang="ts">
  import { browser } from '$app/environment'

  let lastScrollY = $state(0)
  let hidden = $state(false)

  $effect(() => {
    if (!browser) return
    const onScroll = () => {
      const y = window.scrollY
      hidden = y > lastScrollY && y > 60   // 다운 → 가림 / 60px 이하 항상 보임
      lastScrollY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  })
</script>

<!-- 래퍼에 hidden 클래스 바인딩 -->
<div class="gnb-wrap" class:gnb-hidden={hidden}>
  ...
</div>
```

```css
/* ✅ 필수 트랜지션 */
.gnb-wrap {
  transition: transform 0.3s ease;
}
.gnb-wrap.gnb-hidden {
  transform: translateY(-100%);
}
```

### PC · Mobile 공통 적용

```
PC (≥641px)  : GNB 데스크탑 래퍼에 동일 패턴 적용
Mobile (≤640px): GNB 모바일 래퍼에 동일 패턴 적용
SubGnb       : PC SubGnb 래퍼에 동일 패턴 적용 (sticky top 연동)
```

### GATE C 확인 항목

```
[ ] GNB 구현 시 스크롤 다운 → 가림 / 스크롤 업 → 보임 인터랙션 포함?
[ ] SubGnb 구현 시 동일 스크롤 인터랙션 포함?
[ ] transition: transform 0.3s ease 적용?
[ ] scrollY ≤ 60 구간 항상 보임 처리?
[ ] passive 스크롤 리스너 사용?
[ ] $effect cleanup에서 removeEventListener 호출?
```

---

## FloatingBar 모바일 인터랙션 원칙

> 확정 기준: 2026-08-10 구현값 반영 (FloatingBar.svelte 정본)

### FAB 아이콘 크기 확정값

| 버튼 | 모바일 (< 640px) | PC (≥ 640px) | 비고 |
|---|---|---|---|
| 장바구니 · 검색 | **55 × 55px** | 40 × 40px | SVG 크기 |
| 채팅 FAB | **70 × 70px** | 70 × 70px | FloatingButton.svelte 내부 — 변경 금지 |

### 위치 확정값

```
position: fixed
right:  24px
bottom: 100px
z-index: 200
flex-direction: column
gap: 10px
```

### Peek & Expand 인터랙션 확정값

```
Peek 상태 (기본): transform: translateX(calc(50% + 15px))
  → 진입 조건: 페이지 로드 / 라우트 변경 / 스크롤 발생

Expand 상태: transform: translateX(0)
  → 진입 조건: FAB 바 탭

트랜지션: 0.42s cubic-bezier(0.34, 1.28, 0.64, 1)  ← 스프링 바운스 (< 640px 전용)
```

### 버블 애니메이션 확정값 (Expand 시 아이콘 반응)

```css
@keyframes fab-expand-bubble {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.12); }   /* 최대 오버슈트 */
  70%  { transform: scale(0.96); }   /* 언더슈트 */
  100% { transform: scale(1); }
}
/* duration: 0.32s ease-out | .fab-bar.bubbling .fab-btn svg 에 적용 */
```

### 버튼 인터랙션 확정값

```css
.fab-btn:hover  { transform: scale(1.07); }
.fab-btn:active { transform: scale(0.95); }
filter: drop-shadow(0 4px 10px rgba(16, 11, 50, 0.22));
```

### ⚠️ CSS transform + position:fixed 충돌 규칙

```
transform이 적용된 조상 내 position:fixed 자식 → 뷰포트 기준 배치 무효화
→ peek 상태(transform 활성) 중 fixed 모달(바텀시트) 열기 금지

해결: peek 상태에서 FloatingButton wrapper에 pointer-events:none 적용
     확장(transform 해제) 후에만 바텀시트 열기 허용
```

---

## 그룹형 플로팅 메뉴(.fab-group) 감쇠 스프링 바운스 표준

> 확정 기준: 2026-08-09 | 적용 화면: `/cms/mobile`, `/cms/mobile/rentals` (다중 FAB을 하나의
> 세로 그룹으로 묶어 스크롤 방향에 따라 peek/expand 하는 패턴)

### 스크롤 방향 트리거
```
업스크롤   → peek(절반 숨김): transform: translateX(calc(50% + 20px))
다운스크롤 → expand(팝아웃):  transform: translateX(0)
```

### 표본 수치값(감쇠 스프링 물리) — 재사용 시 이 값을 기준으로 삼을 것

```
원리: 매 반동(overshoot)마다 진폭이 직전 대비 45~50%로 줄어들며 부호가 교대(+/-)되는
      감쇠 진동(damped oscillation)을 keyframe 스톱으로 근사.

시작 진폭: peek 이동값 = translateX(calc(50% + 20px))
          = fab-group 너비(75px)의 50%(37.5px) + 20px = 57.5px

[Expand — 다운스크롤, 팝아웃] @keyframes fab-pop-out
  0%    +57.5px   (peek 위치에서 시작)
  28%   -21px     (1차 오버슈트, 진폭 대비 약 -37%)
  46%   +10px     (직전 대비 약 48%)
  61%   -5px      (50%)
  73%   +2.5px    (50%)
  83%   -1.2px    (48%)
  91%   +0.6px    (50%)
  100%  0px       (정지)
  duration: 0.5s (기준 0.62s에서 20% 단축)
  easing:   cubic-bezier(0.25, 0.1, 0.25, 1)

[Peek — 업스크롤, 절반 숨김] @keyframes fab-peek-in — 미세 감쇠(팝아웃보다 진폭 작게)
  0%    0px
  55%   65px      (목표 57.5px 대비 +13% 오버슈트)
  78%   53px      (목표 대비 -8% 언더슈트)
  92%   58.5px    (목표 대비 +1.7%)
  100%  57.5px = calc(50% + 20px)  (정지)
  duration: 0.22s (기준 0.28s에서 20% 단축)
  easing:   cubic-bezier(0.25, 0.1, 0.25, 1)

양방향 모두 animation-fill-mode: forwards 필수(애니메이션 종료 후 되튐 방지).
```

> 재사용 규칙: 새로운 그룹형 FAB에 동일 패턴을 적용할 때는 이 표의 비율(진폭 감쇠율 45~50%,
> peek 오버슈트 +13%/-8%/+1.7%)을 그대로 유지하고, 그룹 너비·이동거리(px)만 대상 컴포넌트
> 크기에 맞게 재계산할 것 — 감쇠율 자체를 임의로 바꾸지 않는다.

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
[ ] GNB position: fixed + background: transparent?
[ ] Hero 높이: 모바일 720px / PC 936px?
[ ] FloatingBar peek 중 fixed 모달 차단(pointer-events:none)?
[ ] 채팅 FAB 크기 70px(모바일) — 임의 변경 금지?
```

---

*ui-mobile.md v3.2 | Harness Flow v3.2 | 모바일 퍼스트 UI*
