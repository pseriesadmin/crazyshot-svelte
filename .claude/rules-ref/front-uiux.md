# front-uiux.md — 크레이지샷 사용자(USER) 화면 표준 디자인 시스템
# Harness Flow v3.2 | 사용자(USER) 환경 전용 정본
# 소스: crazyshot-Front_design-system.json (2026-07-10) + 주메뉴 실측 (2026-07-19)
# 최종 업데이트: 2026-07-19

---

## ⛔ 환경 분리 절대 원칙

```
이 파일은 사용자(USER) 화면 전용이다.

❌ CMS 영역(src/routes/cms/)에서 이 파일 참조 금지
❌ CMS 컴포넌트에 사용자 디자인 토큰 혼용 금지

사용자 화면  → 이 파일 (front-uiux.md) 참조
CMS 화면     → cms-uiux.md 참조

같은 색상값이라도 의미와 역할이 다르다. 절대 혼용하지 않는다.
```

---

## 1. 컬러 시스템 (사용자 화면 기준)

> 기존 `src/app.css` CSS 변수명을 그대로 사용한다. 변수 명칭 변경 금지.

### 브랜드 팔레트

| JSON 토큰 | Hex | CSS 변수 (기존 유지) | 역할 |
|---|---|---|---|
| `purple-100` | `#100B32` | `--cs-dark` / `--cs-text` | 최상위 다크, 기본 텍스트 |
| `purple-90` | `#201857` | `--cs-purple-dark` | 진한 텍스트, 다크 강조 |
| `purple-80` | `#3B2F8A` | `--cs-purple` | 보조 액션, 아이콘, 스트로크 |
| `purple-60` | `#553FE0` | `--cs-purple-light` | 인터랙티브, 링크, 액센트 |
| `purple-20` | `#C1BBEC` | `--cs-purple-pale` / `--cs-points` | 서브텍스트, 보조 강조 |
| `purple-10` | `#E1DEF3` | `--cs-purple-op10` | 카드 배경, 영역 구분 |
| `purple-5` | `#ECEBF4` | `--cs-lilac` | 연한 배경, 섹션 구분 |
| `red-80` | `#FF3535` | `--cs-red-badge` | **주 CTA 버튼** (사용자 화면 actionPrimary) |
| `red-100` | `#CF0000` | `--cs-red` | CTA hover, 에러 강조 |
| `red-30` | `#FFB3B3` | `--cs-red-light` | 연한 레드, 포인트 |
| `red-10` | `#FFCFCF` | `--cs-chat-in-bg` | 배경 틴트 |
| `grey-90` | `#444444` | `--cs-text-dark` | 본문 텍스트 |
| `grey-70` | `#666666` | `--cs-text-mid` | 보조 텍스트, 캡션 |
| `grey-30` | `#AAAAAA` | `--cs-text-light` | 플레이스홀더, 비활성 |
| `grey-5` | `#F6F6F6` | `--cs-surface-gray` | 연한 배경 |
| `white` | `#FFFFFF` | `--cs-white` | 카드, 텍스트, 아이콘 |
| `orange` | `#FF4500` | `--cs-orange` | CrazyShot 브랜드 오렌지 (로고·포인트 전용) |

### 시맨틱 컬러 (사용자 화면 전용)

| 역할 | CSS 변수 | Hex | 설명 |
|---|---|---|---|
| **주 액션 (CTA)** | `--cs-red-badge` | `#FF3535` | 사용자 화면 메인 버튼 — 예약·결제·신청 |
| **주 액션 hover** | `--cs-red` | `#CF0000` | CTA hover 상태 |
| **보조 액션** | `--cs-purple` | `#3B2F8A` | 보조 버튼, 선택 강조 |
| **페이지 배경** | `--cs-lilac` | `#ECEBF4` | 섹션 배경 |
| **다크 배경** | `--cs-dark` | `#100B32` | 헤더, 총액 박스 |
| **기본 텍스트** | `--cs-text` | `#100B32` | 본문 |
| **보더 (강조)** | `--cs-purple` | `#3B2F8A` | 선택·포커스 보더 |
| **브랜드 오렌지** | `--cs-orange` | `#FF4500` | 로고·이벤트 포인트 전용, 버튼 사용 금지 |

> ⚠️ CMS 화면의 `actionPrimary = --cs-purple` 와 다르다.
> 사용자 화면 `actionPrimary = --cs-red-badge (#FF3535)`

---

## 2. 타이포그래피 (기존 CSS 변수 그대로 사용)

> CSS 변수명 변경 없음. 기존 `--text-pc-*` / `--text-m-*` 유지.

### PC 스케일 매핑

| JSON 키 | 크기/굵기 | 폰트 | CSS 변수 |
|---|---|---|---|
| `display-xl` | 80px Black Italic | Config Condensed | `--text-pc-ad-en-80` |
| `display-lg` | 60px Bold | SB AggroOTF | `--text-pc-ad-kr-60` |
| `display-md` | 35px Regular | Tilt Warp | `--text-pc-ad-en-35` |
| `heading-xl` | 35px Bold | SB AggroOTF | `--text-pc-ad-kr-35` |
| `heading-lg` | 25px Bold | Noto Sans KR | `--text-pc-htitle-25` |
| `heading-md` | 22px Black | Noto Sans KR | `--text-pc-hsub-22` |
| `menu-en` | 20px Regular | Tilt Warp | `--text-pc-menu-en-20` |
| `menu-kr` | 20px Medium | SB AggroOTF | `--text-pc-menu-kr-20` |
| `title` | 18px Bold | Noto Sans KR | `--text-pc-title-18` |
| `body` | 16px Bold | Noto Sans KR | `--text-pc-title-16` |
| `label` | 14px Bold | Noto Sans KR | `--text-pc-body-14` |
| `caption-bold` | 12px Bold | Noto Sans KR | `--text-pc-script-12` |
| `caption` | 12px Regular | Noto Sans KR | `--text-pc-script-12` |
| `fine` | 10px Regular | Noto Sans KR | `--text-pc-descript-10` |

### Mobile 스케일 매핑

| JSON 키 | 크기/굵기 | CSS 변수 |
|---|---|---|
| `display-xl` | 40px Bold SB Aggro | `--text-m-ad-kr-40` |
| `display-lg` | 30px Tilt Warp | `--text-m-ad-en-30` |
| `display-md` | 30px Bold SB Aggro | `--text-m-ad-kr-30` |
| `heading-xl` | 24px Black Noto | `--text-m-htitle-24B` |
| `heading-lg` | 21px Bold Noto | `--text-m-title-21` |
| `title` | 18px Bold Noto | `--text-m-title-18B` |
| `body` | 16px Bold Noto | `--text-m-body-16B` |
| `body-medium` | 16px Medium Noto | `--text-m-body-16L` |
| `label` | 14px Bold Noto | `--text-m-script-14B` |
| `label-medium` | 14px Medium Noto | `--text-m-script-14` |
| `caption` | 12px Medium Noto | `--text-m-script-12` |

---

## 3. 레이아웃 (사용자 화면 기준)

### PC 해상도 규격

```
최소 지원: 1240px
최대 지원: 1600px
콘텐츠 최대폭: 1600px (기존 --layout-pc-max: 1240px → 상향)
디자인 기준 해상도: 1920px
그리드: 12컬럼 / 거터 30px / 마진 100px
```

> ⚠️ `--layout-pc-max` 변수는 현재 1240px. 신규 페이지는 1600px 기준으로 작성.
> 기존 페이지 수정 시 별도 확인 후 진행.

### 컨테이너 패턴

```css
/* ✅ 사용자 화면 표준 컨테이너 */
.page-container {
  max-width: 1600px;
  margin: 0 auto;
  padding: 80px 100px;    /* JSON: sectionPadding pc top/bottom:80 left/right:100 */
}

@media (max-width: 1024px) {
  .page-container { padding: 60px 40px; }
}

@media (max-width: 640px) {
  .page-container { padding: 60px 20px; } /* JSON: sectionPadding mobile */
}
```

### 스페이싱 토큰 (JSON scale → 기존 --spacing-* 매핑)

| JSON | 값 | 용도 |
|---|---|---|
| `3xs` | 3px | 아이콘 내부 |
| `2xs` | 5px | 인라인 요소 |
| `xs` | 8px | 칩 내부 |
| `sm` | 10px | 아이템 간격 |
| `md` | 15px | 컴포넌트 내부 |
| `lg` | 20px | 카드 내부 |
| `xl` | 25px | 컨테이너 패딩 |
| `2xl` | 30px | 카드 간격 |
| `3xl` | 40px | 섹션 내 그룹 |
| `4xl` | 50px | 섹션 간격 (`--layout-section-gap`) |
| `5xl` | 60px | 대섹션 간격 |
| `6xl` | 80px | 페이지 상하 패딩 |
| `7xl` | 100px | 페이지 좌우 패딩 (PC) |

---

## 4. 반경 (Border Radius) — 사용자 화면 기준

| JSON 키 | 값 | CSS 변수 | 사용자 화면 적용 대상 |
|---|---|---|---|
| `button` | **30px** | `--radius-xl` | **CTA 버튼 (PC & Mobile 동일)** |
| `card` PC | **20px** | `--radius-2xl` | 흰 카드, 주요 컨테이너 |
| `card` Mobile | **15px** | `--radius-lg` | 모바일 카드 |
| `badge` | **99px** | `--radius-full` | 배지, 태그, 원형 요소 |
| `input` | **8px** | `--radius-sm` | 폼 입력 필드 |
| `image` | **10px** | `--cms-radius-sm` (10px) | 상품 이미지 |
| `avatar` | **50px** | — | 프로필 아바타 |

> 사용자 화면 버튼 반경 = **30px (`--radius-xl`)** — CMS(8px)와 다르다.

---

## 5. 버튼 컴포넌트 (사용자 화면 전용)

> **CTA primary = Red (#FF3535)** — CMS(purple)와 다르다.

```css
/* ✅ 사용자 화면 주 CTA 버튼 (예약·결제·신청) */
.cs-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 50px;                          /* JSON: button pc height 50px */
  padding: 0 30px;                       /* JSON: button pc paddingX 30px */
  background: var(--cs-red-badge);       /* actionPrimary: red-80 #FF3535 */
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-xl);       /* button: 30px */
  font: var(--text-pc-title-16);         /* 16px Bold Noto */
  cursor: pointer;
  transition: background 0.15s;
  text-decoration: none;
  white-space: nowrap;
}
.cs-btn-primary:hover    { background: var(--cs-red); } /* hover: red-100 #CF0000 */
.cs-btn-primary:disabled { background: #B0ABCC; cursor: not-allowed; }

/* ✅ 모바일 */
@media (max-width: 640px) {
  .cs-btn-primary {
    height: 44px;                        /* JSON: button mobile height 44px */
    padding: 0 20px;                     /* JSON: button mobile paddingX 20px */
    font: var(--text-m-body-16B);
  }
}

/* ✅ 보조 버튼 (보라색) */
.cs-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 50px;
  padding: 0 30px;
  background: var(--cs-purple);          /* actionSecondary: purple-80 */
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-xl);       /* 30px */
  font: var(--text-pc-title-16);
  cursor: pointer;
  transition: background 0.15s;
}
.cs-btn-secondary:hover { background: var(--cs-purple-hover); }

/* ✅ 고스트 버튼 (테두리만) */
.cs-btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 50px;
  padding: 0 30px;
  background: transparent;
  color: var(--cs-purple);
  border: 2px solid var(--cs-purple);
  border-radius: var(--radius-xl);       /* 30px */
  font: var(--text-pc-title-16);
  cursor: pointer;
  transition: all 0.15s;
}
.cs-btn-ghost:hover { background: var(--cs-purple); color: var(--cs-white); }
```

**버튼 종류 요약표:**

| 클래스 | 용도 | BG | 반경 |
|---|---|---|---|
| `.cs-btn-primary` | 예약·결제·신청 (메인 CTA) | `--cs-red-badge` #FF3535 | 30px |
| `.cs-btn-secondary` | 보조 액션, 장바구니 | `--cs-purple` #3B2F8A | 30px |
| `.cs-btn-ghost` | 취소·더보기 | 투명 + 보라 보더 | 30px |

---

## 6. 컴포넌트 패턴

### 흰 카드
```css
.cs-card {
  background: var(--cs-white);
  border-radius: var(--radius-2xl);   /* PC: 20px */
  overflow: hidden;
  box-shadow: none;                   /* 오프셋 그림자 사용 금지 */
}

@media (max-width: 640px) {
  .cs-card { border-radius: var(--radius-lg); } /* Mobile: 15px */
}
```

### 폼 입력
```css
.cs-input {
  background: var(--cs-surface-gray);
  border: none;
  border-radius: var(--radius-sm);    /* input: 8px */
  padding: 12px 20px;
  font: var(--text-pc-body-14);
  color: var(--cs-text);
}
.cs-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
```

### 그라데이션 (사용 가능 3종)
```css
/* 프로모 배너 */
.gradient-promo    { background: linear-gradient(to right, #FF3535 0%, #C1BBEC 41%); }
/* 이미지 오버레이 */
.gradient-overlay  { background: linear-gradient(to bottom, transparent 0%, rgba(16,11,50,0.6) 40%, #100B32 100%); }
/* 강한 프로모 */
.gradient-strong   { background: linear-gradient(to right, #FF3535 0%, #3B2F8A 41%); }
```

---

## 7. GATE C 체크리스트 (사용자 화면 퍼블리싱)

```
[환경 분리 — 최우선]
[ ] CMS 토큰(cms-uiux.md)을 사용자 화면에 혼용하지 않았는가?
[ ] 사용자 화면 CTA 버튼: --cs-red-badge (#FF3535) 사용?
[ ] 브랜드 오렌지(--cs-orange): 버튼에 사용하지 않음 (로고·포인트 전용)?

[버튼]
[ ] 주 CTA: height 50px(PC) / 44px(Mobile) / radius --radius-xl (30px)?
[ ] 보조 버튼: --cs-purple 배경 / radius 30px?
[ ] 버튼 box-shadow 없음 (오프셋 그림자 금지)?
[ ] hover 상태: primary → --cs-red (#CF0000) / secondary → --cs-purple-hover?

[레이아웃]
[ ] 콘텐츠 최대폭 1600px 기준 (신규 페이지)?
[ ] 섹션 패딩: PC 80px(상하) 100px(좌우) / Mobile 60px(상하) 20px(좌우)?
[ ] GNB: position fixed / background transparent?

[컬러]
[ ] 기본 텍스트: --cs-text (#100B32)?
[ ] 페이지 배경: --cs-lilac (#ECEBF4)?
[ ] 하드코딩 hex 없음 (var(--) 사용)?

[타이포]
[ ] CSS 변수 --text-pc-* / --text-m-* 사용?
[ ] 하드코딩 font-size / font-weight 없음?

[공통]
[ ] 터치 타겟 최소 44×44px?
[ ] 이미지 alt 속성?
[ ] Svelte 5 문법 (on:event → onevent / $state / $props)?
[ ] box-shadow 오프셋 그림자(4px 4px 0) 없음?
```

---

## 8. 절대 금지 사항

```
❌ 사용자 화면 CTA에 --cs-orange(#FF4500) 사용 — 로고 전용
❌ 사용자 화면 CTA에 --cs-purple 사용 (보조 버튼만 허용)
❌ 버튼 반경 8px 사용 — CMS 전용, 사용자 화면은 30px
❌ CMS 버튼 클래스(.btn-primary)를 사용자 화면에 사용
❌ 사용자 화면에서 cms-uiux.md 참조
❌ 버튼에 box-shadow 오프셋 그림자 추가 (4px 4px 0 등)
❌ CSS 변수 명칭 --cs-purple-100 등 신규 체계 사용 (기존 --cs-* 유지)
```

---

## 9. 프론트 관리자(isCms) 설정 오버레이 패턴

> **적용 화면**: `/products` 카테고리/히어로/그리드/MD픽 섹션 (2026-07-19 실측)
> **조건**: `data.isCms === true` 일 때만 렌더. 게스트·일반 사용자에게 노출 금지.

### 9-1. 관리자 인라인 편집 버튼 (`.admin-edit-btn`)

사용자 화면 위에 관리자 설정 버튼을 반투명 다크 레이어로 오버레이한다.

```css
/* ✅ 사용자 화면 관리자 오버레이 버튼 공통 */
.admin-edit-btn {
  background: rgba(16, 11, 50, 0.75);   /* --cs-dark 75% 투명 */
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-sm);       /* 8px */
  padding: 6px 12px;
  font-family: 'Noto Sans KR', sans-serif;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  white-space: nowrap;
  transition: background 0.12s;
  z-index: 20;
}
.admin-edit-btn:hover { background: rgba(16, 11, 50, 0.92); }
```

**위치 변형 3종:**

| 변형 | 클래스 | 위치 | 용도 |
|---|---|---|---|
| 플로팅 | `.admin-float-btn` | `position: absolute; top:10px; right:10px` | 히어로·그리드·MD픽 섹션 우측 상단 |
| 오버레이 숨김 | `.admin-cat-btn` | `position: absolute; top:6px; right:6px; opacity:0` | 카테고리 영역 — hover 시 노출 |
| 빈 상태 | `.admin-md-empty-btn` | 인라인 | MD픽 비어있을 때 가운데 등록 유도 |

```css
/* 플로팅 버튼 */
.admin-float-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 20;
}

/* 카테고리 hover 노출 */
.admin-cat-btn {
  position: absolute;
  top: 6px; right: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  /* + .admin-edit-btn 기본 스타일 상속 */
}
.cat-icons:hover .admin-cat-btn {
  opacity: 1;
  pointer-events: all;
}

/* 빈 상태 유도 버튼 — dashed 보더 */
.admin-md-empty-btn {
  background: rgba(59, 47, 138, 0.12);
  color: var(--cs-purple);
  border: 1px dashed var(--cs-purple);
  padding: 16px 32px;
  border-radius: var(--radius-xl);      /* 30px */
  min-height: 56px;
}
```

### 9-2. 관리자 설정 모달 진입 패턴

```svelte
<!-- ✅ isCms 조건부 렌더 — 항상 {#if data.isCms} 로 감쌀 것 -->
{#if data.isCms}
  <button
    class="admin-edit-btn admin-float-btn"
    onclick={() => { activeModal = 'hero' }}
    aria-label="헤더 상품 설정"
  >
    ✦ 헤더 상품 설정
  </button>
{/if}
```

**설정 모달 키 4종 (`activeModal` 상태값):**

| 값 | 설명 | 컴포넌트 |
|---|---|---|
| `'categories'` | 카테고리 아이콘·순서 설정 | `ProductCategoryModal.svelte` |
| `'hero'` | 히어로 슬라이더 상품 설정 | `ProductHeroModal.svelte` |
| `'grid'` | 상품 그리드 배치 설정 | `ProductGridModal.svelte` |
| `'md_picks'` | MD 추천 상품 설정 | `ProductMdPickModal.svelte` |

```svelte
<!-- 모달 렌더링 패턴 -->
{#if data.isCms}
  {#if activeModal === 'categories'}
    <ProductCategoryModal
      categories={data.categories}
      initialSettings={data.settings.categories}
      onclose={() => { activeModal = null }}
    />
  {/if}
  <!-- ... 나머지 모달 -->
{/if}
```

### 9-3. GATE C 확인 항목 (관리자 설정 UI)

```
[ ] .admin-edit-btn 렌더를 {#if data.isCms}로 감쌌는가?
[ ] .admin-float-btn position: absolute 부모에 position: relative 있는가?
[ ] 관리자 버튼 min-height: 32px (터치 타겟 보조)?
[ ] .admin-md-empty-btn — dashed 보더 + var(--cs-purple) 배경?
[ ] 카테고리 오버레이(.admin-cat-btn) — 기본 opacity:0 + hover 1?
[ ] activeModal $state 타입: 4개 키 + null 유니온?
```

---

## 10. 크레이지로그 라이트 에디터 — 쓰기 화면 패턴

> **적용 화면**: `/crazylog/[slug]` (신규 작성 & 수정) — PC·모바일 공통
> **특이사항**: GNB·FloatingBar·Footer를 `body.crazylog-write` 클래스로 숨김 처리

### 10-1. 전체 레이아웃 (쓰기 화면 전용)

```svelte
<svelte:head>
  <style>
    /* 쓰기 화면: GNB·FloatingBar·Footer 숨김 */
    body.crazylog-write .gnb-mobile-wrap,
    body.crazylog-write .gnb-desktop-wrap { display: none !important; }
    body.crazylog-write .fab-bar           { display: none !important; }
    body.crazylog-write .site-footer       { display: none !important; }
  </style>
</svelte:head>
```

```typescript
// +page.svelte — $effect로 body 클래스 마운트/언마운트
$effect(() => {
  document.body.classList.add('crazylog-write')
  return () => document.body.classList.remove('crazylog-write')
})
```

### 10-2. 에디터 박스 스타일

```css
/* 모바일 에디터 감싸기 */
.m-editor-box {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);   /* 15px */
  overflow: hidden;
}

.m-editor-inner {
  background: var(--cs-surface-gray);
  min-height: 280px;
}

/* fmt-toolbar 스티키 고정 (스크롤 중에도 서식 툴바 노출) */
.m-editor-inner :global(.fmt-toolbar) {
  background: var(--cs-surface-gray);
  border-bottom: 1px solid var(--cs-border);
  position: sticky;
  top: 0;
  z-index: 5;
}

/* PC 에디터 카드 */
.d-editor-card {
  flex: 1;
  background: var(--cs-white);
  border-radius: var(--radius-xl);   /* 30px */
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
```

### 10-3. 로그 등록·수정 제출 버튼 (`.m-submit` / `.d-submit`)

> 사용자 화면의 CTA와 다른 특수 스타일 — 양방향 화살표 아이콘 포함

```css
/* 모바일 제출 */
.m-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  width: 100%;
  max-width: 340px;
  margin: 0 auto;
  padding: 15px 20px;
  background: var(--cs-text-dark);   /* #444444 — 회색 계열 */
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-xl);   /* 30px */
  font: var(--text-m-body-16B);
  letter-spacing: -0.5px;
  min-height: 44px;
  transition: opacity 0.15s;
  cursor: pointer;
}
.m-submit:hover:not(:disabled)  { opacity: 0.85; }
.m-submit:disabled               { opacity: 0.5; cursor: not-allowed; }

/* PC 제출 */
.d-submit {
  /* .m-submit과 동일하되 아래만 다름 */
  width: 100%;
  font: var(--text-pc-title-16);
  min-height: 50px;
}
```

**아이콘 구성 — 양방향 화살표:**
```svelte
<!-- 좌측 화살표 (고정 stroke #AAAAAA) -->
<svg width="15" height="10" viewBox="0 0 17 12" fill="none">
  <path d="M16 6H1M5.615 1L1 6l4.615 5" stroke="#AAAAAA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
<span>{isSubmitting ? '등록 중...' : isEdit ? '로그 수정' : '로그 등록'}</span>
<!-- 우측 화살표 (transform: rotate(180deg) scaleY(-1)) -->
<svg class="submit-r" width="15" height="10" viewBox="0 0 17 12" fill="none">
  <path d="M16 6H1M5.615 1L1 6l4.615 5" stroke="#AAAAAA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

> ⚠️ 이 버튼은 `--cs-red-badge(#FF3535)` 또는 `--cs-purple`을 사용하지 않는다.
> 콘텐츠 작성 확정 행위임을 나타내는 `--cs-text-dark(#444444)` 전용.

### 10-4. 에디터 내 미디어 툴바 이미지 삽입 버튼

```css
/* CmsContentEditor 내 미디어 삽입 툴바 버튼 */
.d-tb-btn, .m-tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-sm);   /* 8px */
  background: transparent;
  color: var(--cs-text);
  font: var(--text-pc-body-14);
  cursor: pointer;
  min-width: 44px;
  transition: background 0.12s;
}
.d-tb-btn:hover, .m-tb-btn:hover { background: rgba(59,47,138,0.08); }
```

---

## 11. 크레이지로그 콘텐츠 에디터 (`CmsContentEditor`) — 미디어 툴바 규격

> **컴포넌트**: `src/lib/components/cms/CmsContentEditor.svelte`
> 크레이지샷 전용 블록 에디터. 사용자 쓰기 화면(`/crazylog/[slug]`)에서 `hideMediaToolbar={true}`로 호출.

### 11-1. 미디어 삽입 툴바 (`.media-toolbar`)

```
배경: var(--cs-surface-gray)
보더: border-bottom 1px #ECEBF4
패딩: 8px 12px
버튼 높이: 34px
```

**버튼 5종 + 구분 + 액션 2종:**

| 버튼 | 아이콘 | 레이블 | 동작 |
|---|---|---|---|
| 텍스트 | `T` | 텍스트 | `addText()` — 텍스트 블록 추가 |
| 사진 | 🖼 | 사진 | `openPhotoModal()` — 레이아웃 선택 후 이미지 블록 추가 |
| 유튜브 | ▶ | 유튜브 | `addYoutube()` — 유튜브 URL 입력 블록 추가 |
| HTML | `</>` | HTML | `addHtml()` — HTML 붙여넣기 블록 추가 |
| 구분선 | `──` | 구분선 | `addDivider()` — hr 블록 추가 |
| ─ sep ─ | `flex: 1` | — | 좌·우 그룹 분리 |
| 모두삭제 | — | 모두삭제 | `showClearConfirm = true` — 확인 모달 후 전체 삭제 |
| 미리보기 | — | 미리보기 | `showPreview = true` — 전체 콘텐츠 미리보기 |

```css
/* 모두삭제 버튼 — 레드 강조 */
.tb-clear {
  color: var(--cs-red-badge);           /* #FF3535 */
  font: var(--text-pc-script-12);
  font-weight: 700;
}
.tb-clear:hover { background: rgba(255,53,53,0.08); }

/* 미리보기 버튼 — 보라 CTA */
.tb-preview {
  background: var(--cs-purple);
  color: var(--cs-white);
  padding: 0 16px;
}
.tb-preview:hover { background: var(--cs-purple-hover); }
```

### 11-2. 텍스트 서식 툴바 (`.fmt-toolbar`)

```
패딩: 6px 12px
최소 높이: 44px (터치 타겟)
flex-wrap: wrap (좁은 화면 대응)
```

**구성 요소:**
- 서체 선택 `<select>` — 최대폭 110px, 보더 `1px solid #ECEBF4`
- 폰트 크기 스피너 (`−` / 숫자 / `+`) — 인라인 그룹, 보더 `1px solid #ECEBF4`
- 단락 버튼: `본문`, `H2`, `H3`
- 서식 버튼: **B**, *I*, <u>U</u>, ~~S~~, 링크
- 정렬 버튼: 좌·중·우 (`<`)
- 색상 피커: 글자색·배경색

```css
.fmt-btn {
  min-width: 32px;
  height: 30px;
  border-radius: var(--radius-sm);   /* 8px */
  background: transparent;
  color: var(--cs-text);
  font: var(--text-pc-script-12);
}
.fmt-btn:hover { background: rgba(59,47,138,0.08); }
.fmt-btn.fmt-active { background: rgba(59,47,138,0.14); color: var(--cs-purple); }
```

### 11-3. 블록 타입 (`ContentBlock`)

```typescript
type BlockType = 'text' | 'image' | 'youtube' | 'html' | 'divider'

// 이미지 블록 레이아웃 3종
type ImageLayout = 'individual' | 'collage' | 'slide'
```

### 11-4. 이미지 업로드 API

```
POST /api/cms/upload
FormData: { product_id: string, thumb: Blob(WebP), large: Blob(WebP) }
Response: { largeUrl: string }
```

> `product_id`는 `content/{uuid}` 형식의 임시 prefix. 상품과 무관한 콘텐츠 저장용.

### 11-5. Head 이미지 설정 (롱프레스 2초)

```typescript
// 썸네일 이미지 중 하나를 2초 롱프레스 → isHead: true 설정
// 포스트 목록 썸네일(headImageUrl)로 사용됨
// 중복 isHead 방지: setHeadImage()는 모든 이미지 블록의 isHead를 false → 대상만 true
```

---

## 12. `SuggestPicker` — 제안 선택 피커 (CMS·USER 공통 컴포넌트) ★★★

> **컴포넌트**: `src/lib/components/common/SuggestPicker.svelte`
> **타입**: `src/lib/types/suggest-picker.ts` → `SuggestPickerOption`, `SuggestPickerVariant`
> ⚠️ CMS 전용처럼 보이지만 USER 화면에서도 동일 컴포넌트 사용. `<select>` 대체 표준.

### 12-1. variant 2종 — USER 화면 적용 기준

| `variant` | 용도 | meta 구성 |
|---|---|---|
| `'category'` | 분류(카테고리) 필터·선택 | `[이름, 코드]` — 2줄 보조정보 |
| `'brand'` | 브랜드·키워드 필터·선택 | 없음 — 라벨 단일 표시 |

### 12-2. 표준 호출 패턴 (USER 화면)

```svelte
<script lang="ts">
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  let selectedId = $state<string | null>(null)
  const options: SuggestPickerOption[] = [
    { id: 'SONY', label: 'SONY' },
    { id: 'CANON', label: 'CANON' },
  ]
</script>

<!-- variant="brand" : 브랜드·키워드 단일 라벨 표시 -->
<SuggestPicker
  id="brand-picker"
  variant="brand"
  bind:selectedId
  options={options}
  placeholder="브랜드 검색..."
  onselect={(opt) => handleSelect(opt.id)}
>
  {#snippet field(c)}
    <input type="text" class="search-input"
      id={c.id} value={c.value} placeholder={c.placeholder}
      oninput={c.oninput} onkeydown={c.onkeydown}
      onfocus={c.onfocus} onblur={c.onblur}
      aria-autocomplete={c.ariaAutocomplete}
      aria-expanded={c.ariaExpanded}
      aria-controls={c.ariaControls}
      autocomplete="off" />
  {/snippet}
</SuggestPicker>
```

> USER 화면의 input 클래스는 CMS `.f-input`이 아닌 **페이지 고유 클래스** 사용 — 스타일은 호출처 CSS에서 직접 정의

### 12-3. ⛔ 절대 금지

```
❌ <select> 태그로 드롭다운 선택 구현 — SuggestPicker 사용
❌ CmsSuggestPicker / cms-suggest-picker 경로로 신규 import — 공통 경로만 사용
❌ USER 화면에서 .f-input 클래스 그대로 재사용 — 페이지 고유 클래스로 스타일 분리
❌ SuggestPicker를 overflow:hidden 부모 안에 배치 — 드롭다운 레이어(z-index:40) 노출 불가
❌ field 스니펫 없이 컴포넌트 사용 — 반드시 {#snippet field(c)} 패턴 필수
```

### 12-4. 드롭다운 레이어 내장 스펙 (수정 금지)

```
background: var(--cs-white)
border: 1.5px solid rgba(59,47,138,0.2)
border-radius: 10px
box-shadow: 0 8px 24px rgba(16,11,50,0.12)
max-height: 280px · overflow-y: auto
hover/선택: background var(--cs-purple-op10)
키보드: ↑↓ 이동 · Enter 선택 · Esc 닫기
```

---

*front-uiux.md | 사용자(USER) 화면 표준 디자인 시스템 | Harness Flow v3.2*
*소스: crazyshot-Front_design-system.json (2026-07-10)*
*대응 CMS 문서: cms-uiux.md (절대 혼용 금지)*
