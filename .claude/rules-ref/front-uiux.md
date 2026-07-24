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
최소 지원 (PC-MIN): 1240px
최대 지원 (PC-MAX): 1600px
디자인 기준 해상도: 1920px
그리드: 12컬럼 / 거터 30px / 마진 100px
```

### PC 반응형 최대폭 옵션 정책 (2026-07-22 확정)

> 화면 레이아웃 개발 시 Stephen이 아래 두 옵션 중 하나를 명시한다.
> 명시된 즉시 해당 화면의 컨테이너에 적용한다. 전역 변수 변경 금지.

| Stephen 명시어 | 적용 값 | CSS |
|---|---|---|
| **`PC반응형 최대`** | 1600px | `max-width: 1600px` |
| **`PC반응형 최소`** | 1240px | `max-width: 1240px` |

```
적용 범위: 요청된 화면의 최상위 컨테이너(들)에만 적용
적용 방식: 하드코딩 직접 작성 (var(--layout-pc-max) 사용 금지 — 변수값 혼용 방지)

⛔ 전역 일괄 교체 금지 — 요청된 화면만 수정
⛔ --layout-pc-max 변수값 변경 금지 — 다른 화면 일괄 영향 방지
```

### 컨테이너 패턴

```css
/* ✅ PC반응형 최대 적용 시 */
.wrap {
  max-width: 1600px;
  margin: 0 auto;
  padding: 80px 100px;
}

/* ✅ PC반응형 최소 적용 시 */
.wrap {
  max-width: 1240px;
  margin: 0 auto;
  padding: 80px 100px;
}

@media (max-width: 1024px) {
  .wrap { padding: 60px 40px; }
}

@media (max-width: 640px) {
  .wrap { padding: 60px 20px; }
}
```

### 현재 화면별 적용 현황 (2026-07-22 기준)

| 화면 | 현재 적용값 | 비고 |
|---|---|---|
| `products/search` | 1600px | PC-MAX |
| `account` | 1600px | PC-MAX |
| `crazylog/[slug]` | 1600px | PC-MAX (일부) |
| GNB, layout, products/[id], checkout 등 | 1240px | `var(--layout-pc-max)` 참조 |
| products, hype-pack, help, payment 등 | 1240px | 하드코딩 |

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

## 13. 모바일 전용 공통 UI 컴포넌트 인덱스 ★★★

> ⛔ 이 섹션에 정의된 컴포넌트는 **모바일 전역 표준**이다.
> 신규 페이지 작업 시 반드시 이 인덱스를 먼저 확인하고, 동일 패턴이 있으면 기존 컴포넌트/패턴을 재사용한다.
> 새 컴포넌트를 만들기 전에 Stephen에게 먼저 확인할 것.

---

### 13-1. `sub-gnb_navi` / `d-navi-bar` — 페이지 내부 네비바 (PC·모바일)

> **정의:** GNB(전역 상단바) 아래에 표시되는 페이지 전용 탑바.  
> **모바일**: 왼쪽 뒤로가기 · 중앙 타이틀 · 오른쪽 햄버거(더보기) 3분할 pill.  
> **PC**: 왼쪽 뒤로가기 · 오른쪽 타이틀(`margin-left:auto`) + 액션 슬롯 투명 bar.

#### 시각 구조

```
[모바일]
┌─────────────────────────────────────────┐
│  ←   │        페이지 타이틀        │  ☰  │
└─────────────────────────────────────────┘
       pill — border-radius: 20px (--radius-lg)
       background: --cs-purple-op10 (페이지별) 또는 --cs-lilac+blur (SubGnb)

[PC]
┌──────────────────────────────────────────────────────────────┐
│  ← Back              [빈 공간]               타이틀  [actions] │
└──────────────────────────────────────────────────────────────┘
       bar — border-radius: 25px  background: rgba(225,222,243,0.4)
       타이틀 우측 정렬: margin-left:auto; order:3
```

---

#### PC 버전 — `.d-navi-bar` 스펙

```css
.d-navi-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 1240px;
  background: rgba(225, 222, 243, 0.4);   /* --cs-lilac 40% 반투명 */
  border-radius: 25px;                     /* 토큰 없음 — 하드코딩 유지 */
  padding: 20px 40px;
}

/* 뒤로가기 버튼 (화살표 + "Back" 텍스트) */
.d-back-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  font-weight: 700;
  color: var(--cs-text);
  min-height: 44px;
  padding: 0;
  transition: opacity 0.15s;
}
.d-back-btn:hover { opacity: 0.7; }

/* 타이틀 — 항상 우측으로 밀림 */
.d-navi-title {
  font: var(--text-pc-menu-kr-20);
  color: var(--cs-text-mid);
  margin-left: auto;
  order: 3;                                /* flex order로 항상 우측 배치 */
}

/* 액션 슬롯 (CMS 버튼 등 선택적 삽입) */
.d-navi-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 80px;
  justify-content: flex-end;
}
```

> **뒤로가기 화살표 아이콘**: `stroke="#100B32"`, `stroke-width="3"`, `stroke-linecap="round"`  
> SVG viewBox: `0 0 21.3844 17.1421`

---

#### 모바일 변이 비교

| 구분 | `SubGnb.svelte` (상품·Cart) | 페이지 인라인 `.m-nav-pill` (크레이지로그 뷰) |
|---|---|---|
| 배경 | `var(--cs-lilac)` + `backdrop-filter:blur(8px)` | `var(--cs-purple-op10)` |
| 최소 높이 | 52px | 60px |
| 타이틀 정렬 | `flex:1; text-align:center` | `position:absolute; left:50%; transform:translateX(-50%)` |
| border | `1px solid rgba(255,255,255,0.6)` | 없음 |

#### `.m-nav-pill` (인라인 버전) CSS 스펙

```css
.m-nav-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--cs-purple-op10);
  border-radius: 20px;                     /* --radius-lg */
  min-height: 60px;
  padding: 5px 20px;
  position: relative;
  width: 100%;
}

/* 뒤로가기 */
.m-back {
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
}

/* 타이틀 — 절대 중앙 배치 (좌우 버튼과 독립) */
.m-nav-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--cs-text);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  line-height: 1.6;
  letter-spacing: -0.5px;
}

/* 햄버거 버튼 */
.m-hamburger {
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
}
.m-hamburger-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 16.5px;
}
```

#### ⛔ 햄버거(☰) 버튼 동작 규칙

```
항상 MobileMoreMenu 오버레이를 열어야 한다.
카테고리 드롭다운 · 별도 사이드 패널 등 다른 UI로 연결 금지.
```

#### 현재 구현체 목록 (모바일 전역)

| 페이지 | 파일 | 구현 방식 | 더보기 연동 |
|---|---|---|---|
| 상품 목록·상세·Cart | `src/lib/components/common/SubGnb.svelte` | 공통 컴포넌트 | ✅ |
| 로그인 | `src/routes/auth/login/+page.svelte` | 페이지 인라인 (`.m-topbar`) | ✅ |
| 크레이지로그 목록 | `src/routes/crazylog/list/+page.svelte` | 페이지 인라인 (`.m-top-nav`) | ✅ |
| 크레이지로그 뷰 | `src/routes/crazylog/view/[slug]/+page.svelte` | 페이지 인라인 (`.m-hamburger`) | ✅ |

> ⚠️ **신규 페이지 추가 시:** 위 테이블에 항목을 반드시 추가할 것.
> 공통화 우선 원칙: `SubGnb.svelte` 재사용 가능하면 인라인 구현 금지.

---

#### 🔴 PC 반응형 sub-gnb_navi 페이지 래퍼 표준 구조 — 강제 정책 (2026-07-22 확정)

> **AI 에이전트 필수:** `SubGnb`가 포함된 모든 USER 화면에서 아래 DOM·CSS 구조를 강제 적용한다.
> 위반 시 PC 초기 로드에서 SubGnb가 GNB 아래 숨겨지거나 콘텐츠와 간격이 발생한다.

**근거**
- GNB는 `position: fixed; top: 0; height: 100px (--layout-header-h)` — 레이아웃 공간 미점유
- SubGnb PC는 `position: sticky; top: 100px` — 스크롤 시 GNB 바로 아래 고정
- `page-root`에 `padding-top: var(--layout-header-h)` 없으면 초기 로드 시 SubGnb가 GNB 뒤로 숨김
- PC에서 `padding-top: 0`은 GNB 있는 화면에서 SubGnb 위치 오류의 직접 원인

**표준 DOM 구조**

```svelte
<!-- ✅ 강제 표준 — GNB가 렌더링되는 모든 USER 화면 -->
<div class="page-root">
  <SubGnb title="페이지 타이틀" />   ← page-root 첫 번째 자식 (단일 인스턴스)
  <div class="page-inner">
    <!-- 콘텐츠 -->
  </div>
</div>
```

**표준 CSS 패턴**

```css
/* ✅ 필수 — GNB 있는 페이지의 page-root */
.page-root {
  padding-top: 56px;                            /* Mobile: fixed GNB (~56px) 보정 */
}
@media (min-width: 641px) {
  .page-root { padding-top: var(--layout-header-h); }  /* PC: 100px — GNB 보정 */
}

/* ✅ 필수 — page-inner 공통 패턴 */
.page-inner {
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
}
```

**금지 패턴**

```
❌ PC에서 .page-root { padding-top: 0 }  → SubGnb가 GNB 아래 숨김
❌ <SubGnb pcOnly /> + <SubGnb mobileOnly /> 2개 분리 인스턴스  → 단일 <SubGnb /> 사용
❌ SubGnb를 page-root 밖(루트 레벨)에 단독 배치  → page-root 첫 자식으로 배치
❌ page-root 없이 SubGnb 인라인 배치
```

**예외**
- `/account`: GNB가 layout.svelte에서 제외(`!startsWith('/account')`)되므로 `padding-top: 0` 유지 가능.
  SubGnb에 `:global(.page-inner .sub-gnb-pc) { top: 0 }` 오버라이드 적용됨.

**GATE C 확인 항목**

```
[ ] SubGnb가 page-root 첫 번째 자식으로 배치?
[ ] page-root mobile: padding-top: 56px 적용?
[ ] page-root PC(≥641px): padding-top: var(--layout-header-h) (100px) 적용?
[ ] SubGnb 인스턴스 1개만 존재? (pcOnly/mobileOnly 분리 금지)
[ ] page-inner에 max-width: 1240px + margin: 0 auto 적용?
```

---

#### `SubGnb.svelte` 공통 컴포넌트 CSS 패턴

> ⚠️ **가로폭 확보 필수 규칙 (2026-07-22 확정)**
>
> `SubGnb`를 `flex-col items-center` 부모 안에 배치하면 pill이 content 너비로 수축된다.
> 반드시 `.sub-gnb-mobile`에 `align-self: stretch`를 적용해 부모의 center 정렬을 오버라이드한다.
> 좌우 여백은 본문 콘텐츠의 수평 패딩 값과 동일하게 `padding: 16px {본문-px} 0` 으로 맞춘다.
>
> ```css
> /* ✅ 올바른 패턴 */
> .sub-gnb-mobile {
>   align-self: stretch;          /* flex items-center 부모에서 수축 방지 */
>   padding: 16px 25px 0;         /* 본문 px-[25px] 와 동일 여백 */
> }
>
> /* ❌ 금지 — 부모가 items-center일 때 width:100% 단독 사용은 효과 없음 */
> .sub-gnb-mobile { width: 100%; }
> ```

```css
/* pill 컨테이너 */
.sub-gnb-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--cs-lilac);          /* 또는 blur 배경 */
  border: 1px solid rgba(255,255,255,0.6);
  backdrop-filter: blur(8px);
  border-radius: var(--radius-lg);      /* 20px */
  padding: 14px 20px;
  min-height: 52px;
}

/* 뒤로 / 햄버거 버튼 — 터치 타겟 44×44px 필수 */
.sub-gnb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}

/* 타이틀 */
.sub-gnb-title {
  font: var(--text-m-body-16B);
  color: var(--cs-text);
  text-align: center;
  flex: 1;
  padding: 0 8px;
}
```

#### 햄버거 아이콘 SVG (표준)

```html
<!-- 3선 햄버거: 중간선 --cs-red, 상하선 --cs-dark -->
<svg width="20" height="17" viewBox="0 0 20 17" fill="none">
  <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
  <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
</svg>
```

#### 더보기 연동 필수 패턴

```svelte
<script lang="ts">
  import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'
  let moreMenuOpen = $state(false)
</script>

<!-- 햄버거 버튼 -->
<button onclick={() => moreMenuOpen = true} aria-label="더보기 메뉴">...</button>

<!-- 반드시 파일 최하단에 위치 -->
<MobileMoreMenu open={moreMenuOpen} onclose={() => moreMenuOpen = false} />
```

---

### 13-2. `sub-gnb_navi_b` — PC 전용 서브 GNB B타입 (Back Pill + 카테고리 아이콘 행)

> **"sub-gnb_navi_b 적용해" 언급 시 → 아래 스펙을 즉시 적용. 모바일 미지원(PC ≥641px 전용).**

#### 개요

| 항목 | 값 |
|---|---|
| **Stephen 명칭** | `sub-gnb_navi_b` |
| **반응형** | **PC 전용** (`≥641px`) — 모바일에서 `display: none` |
| **위치** | `position: sticky; top: 0; z-index: 50` — GNB 바로 아래 |
| **배경** | `var(--cs-lilac)` (`#ECEBF4`) + `border-bottom: 1px solid rgba(0,0,0,0.1)` |
| **레이아웃** | 좌: Back+타이틀 Pill / 우: 카테고리 아이콘 행 |
| **소스 정본** | `src/routes/checkout/+page.svelte` `.cart-header` |

#### 구조 개요

```
[sub-gnb_navi_b]
  ├── [.header-pill]            ← Back pill (뒤로가기 + 현재 페이지명)
  │     ├── ← 화살표 SVG (22×18px)
  │     ├── "Back" 텍스트 (--text-pc-title-16)
  │     └── "Cart" 타이틀 (--text-pc-menu-en-20)   ← 페이지별 교체
  └── [.cat-icons]             ← 카테고리 원형 아이콘 행 (≥641px에서 표시)
        └── .cat-icon-btn × N  ← 60×60px 원형 버튼
```

#### 표준 DOM 구조 (Svelte 5)

```svelte
<!-- PC 전용 서브 GNB B타입 — 모바일에서 display:none -->
<header class="sub-gnb-b">
  <div class="sub-gnb-b-inner">

    <!-- Back + 페이지 타이틀 Pill -->
    <button type="button" class="sub-gnb-b-pill" onclick={() => history.back()} aria-label="뒤로 가기">
      <div class="sub-gnb-b-pill-left">
        <svg class="sub-gnb-b-arrow" viewBox="0 0 21.3844 17.1421" fill="none" aria-hidden="true">
          <path d="M19.8844 8.5707L1.5 8.57107M8.57107 1.5L1.5 8.57107L8.57107 15.6421"
            stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
        </svg>
        <span class="sub-gnb-b-back">Back</span>
      </div>
      <span class="sub-gnb-b-title">페이지명</span>  <!-- 화면별 교체 -->
    </button>

    <!-- 카테고리 아이콘 행 (선택 사항 — 필요 시 추가) -->
    <div class="sub-gnb-b-cats">
      <button class="sub-gnb-b-cat-btn" title="카테고리명">
        <svg class="sub-gnb-b-cat-svg" viewBox="..." fill="none">...</svg>
      </button>
      <!-- 추가 카테고리 버튼 반복 -->
    </div>

  </div>
</header>
```

#### 표준 CSS 패턴

```css
/* ━━━ sub-gnb_navi_b 래퍼 ━━━ */
.sub-gnb-b {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--cs-lilac);           /* #ECEBF4 */
  border-bottom: 1px solid rgba(0,0,0,0.1);
  display: none;                          /* 모바일 숨김 */
}
@media (min-width: 641px) {
  .sub-gnb-b { display: block; }         /* PC에서만 표시 */
}

/* ━━━ 내부 컨테이너 ━━━ */
.sub-gnb-b-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  width: 100%;
  max-width: var(--layout-pc-max);
  margin: 0 auto;
  padding: 20px var(--layout-pc-pad);
  flex-wrap: nowrap;
  box-sizing: border-box;
}

/* ━━━ Back + 타이틀 Pill 버튼 ━━━ */
.sub-gnb-b-pill {
  background: rgba(225, 222, 243, 0.4);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 40px;
  border-radius: 25px;
  width: 100%;
  max-width: 460px;
  min-width: 0;
  min-height: 62px;
  flex: 0 1 460px;
  box-sizing: border-box;
  color: var(--cs-text);
  transition: background 0.2s;
}
.sub-gnb-b-pill:hover { background: rgba(225, 222, 243, 0.85); }

.sub-gnb-b-pill-left {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.sub-gnb-b-arrow {
  width: 22px;
  height: 18px;
  flex-shrink: 0;
}

.sub-gnb-b-back {
  font: var(--text-pc-title-16);         /* 16px Bold */
  color: var(--cs-text);
  white-space: nowrap;
}

.sub-gnb-b-title {
  font: var(--text-pc-menu-en-20);       /* 20px — 페이지명 */
  color: var(--cs-text);
  flex-shrink: 0;
  white-space: nowrap;
}

/* ━━━ 카테고리 아이콘 행 ━━━ */
.sub-gnb-b-cats {
  display: flex;
  flex-wrap: nowrap;
  gap: 30px;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}

.sub-gnb-b-cat-btn {
  background: #E1DEF3;
  border: none;
  cursor: pointer;
  border-radius: 30px;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.2s;
}
.sub-gnb-b-cat-btn:hover { background: #D0CCEB; }

.sub-gnb-b-cat-svg {
  width: 28px;
  height: 28px;
}
```

#### 타이포 토큰 요약

| 요소 | 토큰 | 크기 |
|---|---|---|
| Back 텍스트 | `--text-pc-title-16` | 16px Bold |
| 페이지 타이틀 | `--text-pc-menu-en-20` | 20px |
| 카테고리 아이콘 버튼 | — | 60×60px (border-radius: 30px) |
| 아이콘 SVG | — | 28×28px |

#### 적용 시 필수 확인 (⛔)

```
❌ 모바일에서 display:block 금지 — .sub-gnb-b { display: none } 기본값 필수
❌ position: fixed 금지 — sticky + top: 0 으로만 구현
❌ 카테고리 없는 화면에서 .sub-gnb-b-cats 렌더링 금지 — 조건부 렌더링
```

**GATE C 확인 항목**

```
[ ] 모바일(≤640px)에서 완전 숨김 (display: none)?
[ ] PC(≥641px)에서만 display: block?
[ ] position: sticky; top: 0 적용?
[ ] Back pill max-width: 460px; border-radius: 25px; min-height: 62px?
[ ] Back 텍스트 --text-pc-title-16 / 타이틀 --text-pc-menu-en-20?
[ ] 카테고리 버튼 60×60px; border-radius: 30px?
[ ] 아이콘 SVG 28×28px?
```

---

### 13-3. `MobileMoreMenu` — 더보기 전체화면 오버레이

| 항목 | 값 |
|---|---|
| 컴포넌트 경로 | `src/lib/components/common/MobileMoreMenu.svelte` |
| Props | `open: boolean`, `onclose: () => void` |
| 트리거 | 항상 `sub-gnb_navi` 햄버거(☰) 버튼 |
| 애니메이션 | 오른쪽에서 슬라이드인 `0.28s cubic-bezier(0.22,1,0.36,1)` |
| 배경 | `var(--cs-dark)` (`#100B32`) 전체화면 |
| 메뉴 항목 | Hypepack `/hype-pack` · All `/products` · Members `/members` · Crazylog `/crazylog` · Help `/help` |

> ⛔ 이 컴포넌트는 **단독 호출 금지** — 반드시 `sub-gnb_navi` 햄버거를 통해서만 열린다.

---

### 13-4. `FloatingBar` — 모바일 우하단 FAB 바 (채팅 플로팅 그룹)

#### 구성 개요

| 요소 | 컴포넌트 | 파일 위치 | 크기 (Mobile / PC) |
|---|---|---|---|
| **전체 그룹** | `FloatingBar` | `common/FloatingBar.svelte` | — |
| 장바구니 FAB | 인라인 `<button>` | `FloatingBar.svelte` 내 | 55px / 40px |
| 검색 FAB | 인라인 `<button>` | `FloatingBar.svelte` 내 | 55px / 40px |
| **채팅 FAB** | `FloatingButton` | `chat/FloatingButton.svelte` | **70px / 40px** |

#### FloatingBar 레이아웃 스펙

| 항목 | 값 |
|---|---|
| 컴포넌트 경로 | `src/lib/components/common/FloatingBar.svelte` |
| 위치 | `position: fixed; right: 24px; bottom: 100px; z-index: 200` |
| 정렬 방향 | `flex-direction: column; gap: 10px` (위→아래: 장바구니 → 검색 → 채팅) |
| Peek 상태 | 스크롤 발생 또는 라우트 진입 시 → `translateX(calc(50% + 15px))` (오른쪽 절반 숨김, 44px 노출 보장) |
| Expand 상태 | FAB 바 탭 시 → `translateX(0)` 전체 노출 |
| 트랜지션 | `0.42s cubic-bezier(0.34, 1.28, 0.64, 1)` (spring-bounce, 모바일 ≤639px 전용) |
| Bubble 애니메이션 | Expand 시 버튼 `scale(1.12)` 최대, `0.32s ease-out` |
| PC (≥640px) | Peek 트랜지션 없음, FAB 아이콘 40px |

#### FloatingBar Props

| Prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `userId` | `string` | `'guest'` | FloatingButton에 전달 |
| `userName` | `string` | `'게스트'` | FloatingButton에 전달 |
| `userHandle` | `string` | `'guest'` | FloatingButton에 전달 |
| `contextType` | `string` | `'general'` | 채팅 컨텍스트 종류 (상품·예약 등) |
| `contextId` | `string?` | `undefined` | 컨텍스트 ID (상품/예약 ID 등) |

> ⚠️ `contextType` / `contextId` — 현재 페이지의 상품·예약 컨텍스트를 채팅에 전달. 일반 페이지는 기본값 유지.

---

#### 13-3-1. `FloatingButton` — 채팅 FAB 서브 컴포넌트

| 항목 | 값 |
|---|---|
| 컴포넌트 경로 | `src/lib/components/chat/FloatingButton.svelte` |
| 아이콘 | 커스텀 SVG (보라 원 + 흰 말풍선) — `viewBox="0 0 70 70"` |
| 크기 | 모바일 **70px** / PC(≥640px) **40px** |
| 배경 | `background: none` + `drop-shadow(0 4px 10px rgba(16,11,50,0.22))` |
| hover | `scale(1.07)` |
| active | `scale(0.95)` |

##### 상태별 시각

| 상태 | 시각 표현 |
|---|---|
| 기본 | 보라 원(`#3B2F8A`) + 흰 말풍선 아이콘 |
| 미읽음 있음 (`has-unread`) | **레드 원점** (우측 상단, `--cs-red-badge`) + **전파 링** (ripple ×2, 2.4s 무한 반복) |
| 열림 (`isOpen`) | 레드 원점·링 숨김 |

##### 미읽음 배지 상세

| 항목 | 값 |
|---|---|
| 레드 원점 크기 | Mobile: 11px / PC: 10px |
| 레드 원점 색상 | `--cs-red-badge` (`#FF3535`) + `border: 2px solid white` |
| 레드 원점 위치 | Mobile: `top:1px; right:1px` / PC: `top:-1px; right:-1px` |
| ripple 색상 | `--cs-red-badge` 80% 불투명 |
| ripple 크기 | `scale(1.65)` 까지 확산 + `opacity: 0` 페이드아웃 |
| ripple 타이밍 | ripple-1: 즉시, ripple-2: `0.8s delay` — 모두 `2.4s ease-out infinite` |

##### FloatingButton Props

| Prop | 타입 | 필수 | 설명 |
|---|---|---|---|
| `userId` | `string` | ✅ | Supabase Auth 사용자 ID (미로그인: `'guest'`) |
| `userName` | `string` | ✅ | 채팅 표시명 |
| `userHandle` | `string` | — | 핸들 (기본 `''`) |
| `contextType` | `string` | — | 채팅 컨텍스트 종류 |
| `contextId` | `string` | — | 컨텍스트 ID (상품/예약 ID 등) |

##### 내부 동작

| 기능 | 설명 |
|---|---|
| 세션 자동 복구 | 페이지 로드 시 Supabase Auth 세션 존재 시 `loadUserSession()` 으로 기존 채팅 세션 복구 → `chatStore.activeSessionId` 설정 |
| 백그라운드 구독 | `activeSessionId` 설정 직후 Realtime 구독 시작 → 채팅 닫힌 상태에서도 관리자 메시지 수신 |
| 미읽음 카운트 | `chatStore.unreadCount` — 채팅 열기 시 `resetUnreadCount()` 자동 호출 |
| 바텀시트 연동 | `ChatBottomSheet` (`chat/ChatBottomSheet.svelte`) — `isOpen` 으로 제어 |

```svelte
<!-- ✅ 표준 사용 패턴 (FloatingBar 내부 — 외부 직접 호출 금지) -->
<div style={peekMode ? 'pointer-events:none' : ''}>
  <FloatingButton
    {userId}
    {userName}
    {userHandle}
    {contextType}
    {contextId}
  />
</div>
```

> ⛔ `FloatingButton` 단독 직접 호출 금지 — 반드시 `FloatingBar` 내부를 통해 호출
> ⛔ 채팅 FAB 크기 (70px 모바일 / 40px PC) 임의 변경 금지 — Stephen 확인 필수
> ⛔ Peek 상태(transform 활성) 중 `ChatBottomSheet` 열기 금지 → `pointer-events:none` 차단

##### GATE C 확인 항목 (FloatingButton)

```
[ ] 채팅 FAB 70px 유지 (모바일) / 40px (PC ≥640px)?
[ ] 미읽음 레드 원점 위치·크기 정확 (Mobile: top1/right1 11px)?
[ ] ripple 2개 (0.8s delay 차이) 2.4s 무한 반복?
[ ] Peek 상태 중 pointer-events:none 유지?
[ ] FloatingBar를 통해서만 호출?
[ ] $effect cleanup에서 Realtime 구독 해제?
```

---

### 13-4. 의사소통 명칭 대조표 (Stephen ↔ AI 에이전트)

> 이 표는 **컴포넌트 이름 오인을 방지**하기 위한 정본이다.
> Stephen이 명칭을 언급하면 AI는 이 표를 먼저 조회한다.

| Stephen 명칭 | 실제 컴포넌트/패턴 | 파일 위치 | 설명 |
|---|---|---|---|
| `sub-gnb_navi` | 모바일 탑바 pill (뒤로←·타이틀·햄버거☰) | 페이지별 인라인 또는 `SubGnb.svelte` | 공통 GNB 아래 모바일 전용 서브 네비 |
| `더보기 메뉴` | `MobileMoreMenu` | `common/MobileMoreMenu.svelte` | 햄버거 클릭 시 열리는 전체화면 오버레이 |
| `FloatingBar` / `FAB 바` / `채팅 플로팅 그룹` | `FloatingBar` + `FloatingButton` | `common/FloatingBar.svelte` | 장바구니·검색·채팅 우하단 고정 버튼 그룹 |
| `채팅 FAB` / `채팅 버튼` | `FloatingButton` | `chat/FloatingButton.svelte` | 채팅 서브 컴포넌트 — FloatingBar 내부 전용 |
| `GNB` / `주 네비` | `GNB` | `common/GNB.svelte` | 전역 상단 네비 (PC: 다크 pill, 모바일: 투명 로고바) |
| `SubGnb` | `SubGnb` 공통 컴포넌트 | `common/SubGnb.svelte` | 상품·Cart 페이지 전용 sub-gnb_navi 구현체 |
| `바텀탭` / `탭바` | 홈 바텀 탭바 | `routes/+page.svelte` 내 `.m-tab-bar` | 홈 전용 — Home·All·Members·Crazylog·More |

> 🔴 **AI 에이전트 필수 행동 규칙:**
> 1. Stephen이 컴포넌트 명칭을 언급하면 → 이 표에서 먼저 매핑 확인
> 2. 매핑이 불확실하면 → 스크린샷 또는 파일 경로 요청 후 진행
> 3. 작업 전 "○○ 컴포넌트(파일: ○○.svelte)를 수정합니다" 명시 후 착수

---

## 14. 기본 상품 DP — 상품 노출 전역 공통 컴포넌트 ★★★

> 🔴 **전역 표준**: `/products`, `/hype-pack`, `/help` 등 상품을 노출하는 모든 화면에 동일하게 적용한다.
> 소스 실측: `src/routes/products/+page.svelte` (2026-07-21)

### 14-1. Mobile — MD Picks 가로 스크롤 트랙 (`.md-picks-track`)

```
[모바일 — MD Picks 수평 스크롤]
┌────────────────────────────────────────────────────────────────┐
│  ← scroll →                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│  │ 이미지   │  │ 이미지   │  │ 이미지   │                     │
│  │ 200×200  │  │ 200×200  │  │ 200×200  │                     │
│  │ r:20px↑  │  │ r:20px↑  │  │ r:20px↑  │                     │
│  ├──────────┤  ├──────────┤  ├──────────┤                     │
│  │ 상품명   │  │ 상품명   │  │ 상품명   │                     │
│  │ 가격     │  │ 가격     │  │ 가격     │                     │
│  └──────────┘  └──────────┘  └──────────┘                     │
│     card w:200px                                               │
└────────────────────────────────────────────────────────────────┘
```

```css
/* 트랙 — 가로 스크롤 컨테이너 */
.md-picks-track {
  display: flex;
  gap: 15px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.md-picks-track::-webkit-scrollbar { display: none; }

/* 카드 — 고정폭 세로 레이아웃 */
.md-pick-card {
  flex: none;
  width: 200px;
  text-decoration: none;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  transition: transform 0.2s;
}
.md-pick-card:hover { transform: scale(1.02); }

/* 이미지 박스 — 상단 반경만 적용 */
.md-pick-img-box {
  width: 100%;
  height: 200px;
  border-radius: 20px 20px 0 0;   /* --radius-lg 상단만 */
  overflow: hidden;
  position: relative;
  background: #e1def3;             /* --cs-lilac-deep 계열 플레이스홀더 */
}
```

### 14-2. Mobile — 상품 리스트 그리드 공통 인포 블록 (`.m-prod-info`)

> `.md-pick-card`, `.m-prod-card` 등 모바일 카드 하단 인포에 공통 적용

```css
/* 인포 영역 — 카드 하단 패딩 블록 */
.m-prod-info { padding: 5px 5px 10px; }

/* 상품명 */
.m-prod-name {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: #1d183e;                  /* ≈ --cs-text */
  line-height: 1.6;
  letter-spacing: -0.5px;
  margin: 0 0 2px;
}

/* 가격 — 보라 강조 */
.m-prod-price {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: #3b2f8a;                  /* --cs-purple */
  line-height: 2;
  letter-spacing: -0.5px;
  margin: 0;
}
```

### 14-3. PC — 상품 플랫 그리드 (`.d-prod-grid` / `.d-prod-flat`)

```
[PC — 2열 플랫 카드 그리드]
┌──────────────────────────────────────────────────────────────────┐
│  ┌────────────┐       ┌────────────┐                             │
│  │ 이미지     │       │ 이미지     │                             │
│  │ 290×290    │       │ 290×290    │                             │
│  ├────────────┤       ├────────────┤                             │
│  │ 가격 (굵게)│       │ 가격 (굵게)│  ← 가격이 상품명 위에 위치  │
│  │ 상품명     │       │ 상품명     │                             │
│  └────────────┘       └────────────┘                             │
│   card: 290×410px · r:40px · info bg: #e1def3                   │
└──────────────────────────────────────────────────────────────────┘
```

```css
/* 그리드 래퍼 — 2열, 행간 50px */
.d-prod-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 50px 20px;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
}

/* 플랫 카드 — 세로 레이아웃, 전체 반경 40px */
.d-prod-flat {
  width: 290px;
  height: 410px;
  border-radius: 40px;             /* 토큰 없음 — 하드코딩 유지 */
  overflow: clip;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.2s;
}
.d-prod-flat:hover { transform: scale(1.02); }

/* 이미지 박스 */
.d-flat-img-box {
  width: 100%;
  height: 290px;
  overflow: hidden;
  flex-shrink: 0;
}
.d-flat-img { width: 100%; height: 100%; object-fit: cover; }

/* 인포 블록 — 연보라 배경 */
.d-flat-info {
  background: #e1def3;             /* --cs-lilac-deep */
  width: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

/* 가격 — 상품명보다 위 (DOM 순서: price → name) */
.d-flat-price {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 900;
  font-size: 18px;
  color: #100b32;                  /* --cs-text */
  line-height: 1;
  letter-spacing: -0.5px;
  margin: 0;
  white-space: nowrap;
}

/* 상품명 — ellipsis 처리 */
.d-flat-name {
  font-family: 'Noto Sans KR', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: #444;                     /* --cs-text-dark */
  line-height: 2;
  letter-spacing: -0.5px;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### 14-4. Product DP Card — 전역 공통 상품 카드 컴포넌트 ★★★

> 🔴 **공식 컴포넌트**: `src/lib/components/products/ProductDPCard.svelte`
> 소스: Figma node `2914-7618` (2026-07-22) · 피그마 실측 기반 정본

#### 컴포넌트 호출

```svelte
<ProductDPCard
  id={product.id}
  name={product.name}
  category={product.category}
  imageUrl={product.image_urls[0]}
  price24h={price24h}
  price12h={price12h}
  href="/products/{product.slug}"
  wished={false}
  onWishToggle={(id) => handleWish(id)}
/>
```

#### Props — DB 연동 매핑

| Prop | DB 소스 | 타입 | 설명 |
|---|---|---|---|
| `id` | `products.id` | `string` | UUID |
| `name` | `products.name` | `string` | 상품명 (필수) |
| `category` | `products.category` | `ProductCategoryEnum` | camera·lens·drone 등 |
| `imageUrl` | `products.image_urls[0]` | `string` | Cloudinary URL (필수) |
| `price24h` | `price_rules WHERE duration_type='24h'` | `number \| null` | Day 가격 |
| `price12h` | `price_rules WHERE duration_type='12h'` | `number \| null` | 12H 가격 (없으면 미노출) |
| `href` | `/products/{slug}` | `string` | 클릭 이동 경로 |
| `wished` | 찜 상태 | `boolean` | 초기 찜 여부 |
| `onWishToggle` | — | `(id) => void` | 없으면 하트 버튼 미노출 |

#### PC 버전 스펙 (Figma 정본)

```
카드 width:        290px
이미지:            290 × 290px  · border-radius: 30px · object-fit: cover
찜 버튼:           36×36px · top: 12px · right: 12px
텍스트 패딩:       padding: var(--spacing-5) 0 0 (좌우 패딩 없음) · gap: var(--spacing-5) (flex-col)
카테고리:          --text-pc-script-12 + font-weight: 700 (12px Bold) · #AAA (--cs-text-light)
가격 레이블:       --text-pc-body-14 (14px Bold) · #100B32 (--cs-text) · tracking: -0.5px
가격 숫자:         --text-pc-title-18 (18px Black/900) · #100B32 (--cs-text) · tracking: -0.5px · tabular-nums
상품명:            --text-pc-body-14 (14px Bold) · #666 (--cs-text-mid) · tracking: -0.5px
```

```
[PC — Product DP Card]
┌──────────────────────────────┐  width: 290px
│                              │
│         이미지               │  290×290px
│    border-radius: 30px       │  object-fit: cover
│    [♡ 36px · top:12 right:12]│
│                              │
├──────────────────────────────┤  padding-top: var(--spacing-5) (좌우 패딩 없음)
│  camera                      │  --text-pc-script-12 Bold #AAA (--cs-text-light) — category
│                              │  gap: var(--spacing-5)
│  Day 35,000 / 12H 25,000     │  label: --text-pc-body-14 / num: --text-pc-title-18 (18px Black)
│                              │  gap: var(--spacing-5)
│  SONY FE 24-105 F4 G OSS     │  14px Bold #666 (--cs-text-mid)
└──────────────────────────────┘
```

#### Mobile 버전 스펙 (PC 대비 60% 비율 · 토큰 한 단계 업 적용)

```
카드 width:        174px        (290 × 0.6)
이미지:            174 × 174px  · border-radius: 18px · object-fit: cover
찜 버튼:           22×22px · top: 7px · right: 7px
텍스트 패딩:       padding: var(--spacing-3) 0 0 (좌우 패딩 없음) · gap: var(--spacing-3)
카테고리:          --text-m-script-12 (12px Bold) · #AAA (--cs-text-light)
가격 레이블:       --text-m-script-14B (14px Bold) · #100B32 (--cs-text) · tracking: -0.5px
가격 숫자:         --text-m-body-16B (16px Black/900) · #100B32 (--cs-text) · tracking: -0.5px
상품명:            --text-m-script-14B (14px Bold) · #666 (--cs-text-mid) · tracking: -0.5px
```

```
[Mobile — Product DP Card]
┌──────────────┐  width: 174px
│              │
│    이미지    │  174×174px · border-radius: 18px
│  [♡22·t7·r7]│
│              │
├──────────────┤  padding-top: var(--spacing-3) (좌우 패딩 없음)
│  camera      │  --text-m-script-12 Bold #AAA (--cs-text-light)
│  Day 120,000 │  label --text-m-script-14B / num --text-m-body-16B (16px Black)
│  / 12H 80,000│
│  SONY A7S3   │  14px Bold · #666 (--cs-text-mid)
└──────────────┘
```

#### 반응형 적용 (`@media`)

```svelte
<!-- 부모 컨테이너에서 class로 크기 제어 -->
<div class="card-wrap">
  <ProductDPCard ... />
</div>

<style>
  /* Mobile 기본: 174px — 좌우 패딩 없음 */
  :global(.card-wrap .pc-card)       { width: 174px; }
  :global(.card-wrap .pc-img-wrap)   { width: 174px; height: 174px; border-radius: 18px; }
  :global(.card-wrap .pc-info)       { padding: var(--spacing-3) 0 0; gap: var(--spacing-3); }

  /* PC: 290px — 좌우 패딩 없음 */
  @media (min-width: 768px) {
    :global(.card-wrap .pc-card)      { width: 290px; }
    :global(.card-wrap .pc-img-wrap)  { width: 290px; height: 290px; border-radius: 30px; }
    :global(.card-wrap .pc-info)      { padding: var(--spacing-5) 0 0; gap: var(--spacing-5); }
  }
</style>
```

> ⛔ `ProductDPCard` 내부 CSS 직접 수정 금지 (타이포·색상 토큰 교체는 예외)
> - **금지**: `width` · `height` · `border-radius` 직접 수정 → 반드시 부모 래퍼 `:global()` 오버라이드로만 처리
> - **허용**: 타이포 토큰 · 색상 토큰 · 스페이싱 토큰 변경 (디자인 시스템 정합 시)

### 14-5. 전역 적용 원칙

| 항목 | 규칙 |
|---|---|
| **적용 화면** | `/products`, `/hype-pack`, `/help`, `/members` 등 상품 노출 전 화면 |
| **PC 카드** | `.d-prod-grid` + `.d-prod-flat` (290×410px, r:40px) |
| **Mobile MD Picks** | `.md-picks-track` + `.md-pick-card` (w:200px, 가로 스크롤) |
| **Mobile 리스트** | `.m-prod-card` (50% 2열, r:20px 상단만) |
| **인포 블록** | `.m-prod-info` + `.m-prod-name` + `.m-prod-price` — 모바일 카드 전역 공통 |
| **이미지 배경** | `#e1def3` (이미지 로딩 전 플레이스홀더) |
| **인포 배경** | `#e1def3` (PC `.d-flat-info`) |
| **가격 DOM 순서** | PC: 가격 → 이름 (위→아래) / Mobile: 이름 → 가격 (위→아래) |
| **hover 효과** | `transform: scale(1.02)` 0.2s — 모바일·PC 동일 |
| **신규 상품 DP 추가 시** | 위 클래스 재사용 — 임의 신규 클래스 작성 금지 |

---

## 15. 파일 업로드 표준 정책 — 강제 적용 ★★★

> 🔴 **AI 에이전트 필수:** 프롬프트에 **"이미지 업로드"** 또는 **"파일 등록"** 이 포함되면
> 별도 언급 없이 아래 표준 포맷·로직을 즉시 적용한다.

### 15-1. 허용 파일 포맷 (전역 표준)

| 포맷 | MIME 타입 | 확장자 | 용도 |
|---|---|---|---|
| PNG | `image/png` | `.png` | 이미지 |
| JPEG | `image/jpeg` | `.jpg` `.jpeg` | 이미지 |
| WebP | `image/webp` | `.webp` | 이미지 (Cloudinary 최적 포맷) |
| HEIF | `image/heif`, `image/heic` | `.heif` `.heic` | iOS 촬영 원본 |
| PDF | `application/pdf` | `.pdf` | 증명서·서류 |

```
⛔ 허용 포맷 외 파일 업로드 금지 (GIF · BMP · TIFF · SVG · EXE 등)
⛔ 포맷 리스트는 이 정책이 정본 — 개별 화면에서 임의 확장 금지
```

### 15-2. HTML `<input accept>` 표준값

```html
<!-- ✅ 모든 파일 업로드 input에 반드시 적용 -->
<input
  type="file"
  accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
/>
```

```svelte
<!-- ✅ Svelte 5 컴포넌트 패턴 -->
<script lang="ts">
  const ACCEPTED_FORMATS = 'image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf'
  const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.heif', '.heic', '.pdf']
</script>

<input type="file" accept={ACCEPTED_FORMATS} />
```

### 15-3. 클라이언트 검증 로직 (필수)

```typescript
// src/lib/utils/fileValidation.ts — 전역 공용 헬퍼
export const UPLOAD_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heif',
  'image/heic',
  'application/pdf',
] as const

export type UploadMimeType = typeof UPLOAD_ACCEPTED_TYPES[number]

export function validateUploadFile(file: File): { ok: boolean; error?: string } {
  if (!UPLOAD_ACCEPTED_TYPES.includes(file.type as UploadMimeType)) {
    return {
      ok: false,
      error: `지원하지 않는 파일 형식입니다. (PNG · JPEG · WebP · HEIF · PDF만 허용)`,
    }
  }
  return { ok: true }
}
```

### 15-4. 서버사이드 검증 (필수 — 클라이언트 검증만으로 완결 불가)

```typescript
// +page.server.ts / +server.ts — 서버에서 반드시 재검증
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp',
  'image/heif', 'image/heic', 'application/pdf',
])

export const actions = {
  upload: async ({ request }) => {
    const form = await request.formData()
    const file = form.get('file') as File

    if (!file || !ALLOWED_MIME.has(file.type)) {
      return fail(400, { error: '허용되지 않는 파일 형식입니다.' })
    }
    // → Supabase Storage 업로드 진행
  }
}
```

### 15-5. UX 규칙

```
드래그앤드롭 지원 시   : 동일 MIME 필터 적용 (dragover + drop 이벤트)
파일 선택 후 미리보기  : 이미지 → <img> 미리보기 / PDF → 파일명 + 아이콘 표시
오류 메시지 위치       : 업로드 버튼 하단 · role="alert" · color: var(--cs-error)
오류 문구              : "PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요."
로딩 상태              : 버튼 disabled + 텍스트 "업로드 중..."
```

### 15-6. GATE C 확인 항목

```
[ ] <input accept="..."> 에 5종 MIME 타입 전부 포함?
[ ] 클라이언트 validateUploadFile() 호출?
[ ] 서버사이드 MIME 재검증 존재?
[ ] 오류 메시지 role="alert" + --cs-error 색상?
[ ] 허용 외 포맷 업로드 시 업로드 차단 확인?
```

---

## 16. 콤보 버튼 선택 그룹 — 수평 단일 선택 UI ★★★

> **AI 에이전트 필수:** "콤보 버튼", "옵션 선택 버튼", "수령 방법 선택" 등 수평 단일 선택 UI 언급 시 → 아래 스펙을 즉시 적용.

### 16-1. 개요

| 항목 | 값 |
|---|---|
| **소스 정본** | `src/routes/checkout/+page.svelte` `.delivery-combo / .combo-btn` |
| **용도** | 단일 선택 옵션 그룹 (수령 방법·날짜 유형 등) |
| **레이아웃** | 수평 flex, 가로 스크롤 (`overflow-x: auto`) — PC·모바일 공통 |
| **반응형 기준** | **PC 기본값** → `@media (max-width: 640px)` 모바일 오버라이드 |
| **선택 상태** | `.combo-btn-active` — `--cs-purple` 채움 |
| **비선택 상태** | 흰 배경 + `#DCDCDC` 1.5px 보더 |

### 16-2. 구조

```svelte
<div class="combo-wrap">
  {#each options as opt}
    <button
      class="combo-btn"
      class:combo-btn-active={selected === opt.value}
      onclick={() => selected = opt.value}
    >
      <span class="combo-label">{opt.label}</span>
      {#if opt.fee}<span class="combo-fee">{opt.fee}</span>{/if}
    </button>
  {/each}
</div>
```

### 16-3. 반응형 스펙 비교

| 속성 | PC (기본값 · ≥641px) | Mobile (`≤640px`) | 비율 |
|---|---|---|---|
| 패딩 | `9px 16px` | `8px 12px` | 상하 89% / 좌우 75% |
| 레이블 폰트 | `13px` Bold | `12px` Bold | 92% |
| 요금 폰트 | `11px` Medium | `10px` Medium | 91% |
| border-radius | `var(--radius-xl)` (30px) | `var(--radius-xl)` (30px) | 동일 |
| 보더 | `#DCDCDC 1.5px` | `#DCDCDC 1.5px` | 동일 |
| 버튼 간격 | `gap: 6px` | `gap: 6px` | 동일 |
| 선택 배경 | `var(--cs-purple)` | `var(--cs-purple)` | 동일 |

> `border-radius`, `border`, `gap`, 선택 색상 — PC·모바일 동일 유지.
> 패딩·폰트만 모바일에서 소폭 축소 (약 10~25% 감소).

### 16-4. CSS 표준 패턴 (PC 기본 + 모바일 오버라이드)

```css
/* ━━━ 래퍼 — 가로 스크롤 ━━━ */
.combo-wrap {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.combo-wrap::-webkit-scrollbar { display: none; }

/* ━━━ 개별 버튼 (PC 기본값) ━━━ */
.combo-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;                      /* PC 기본 */
  border-radius: var(--radius-xl);        /* 30px — 반응형 불변 */
  border: 1.5px solid #DCDCDC;
  background: #fff;
  cursor: pointer;
  transition: all 0.18s;
  flex-shrink: 0;
  white-space: nowrap;
}
.combo-btn:hover {
  border-color: var(--cs-purple);
  background: #F5F4FA;
}

/* 선택 상태 */
.combo-btn-active {
  border-color: var(--cs-purple);
  background: var(--cs-purple);
}

/* 레이블 (PC 기본값) */
.combo-label {
  font-size: 13px;                        /* PC 기본 */
  font-weight: 700;
  color: var(--cs-text);
}
.combo-btn-active .combo-label { color: #fff; }

/* 요금 보조 텍스트 (PC 기본값) */
.combo-fee {
  font-size: 11px;                        /* PC 기본 */
  font-weight: 500;
  color: var(--cs-text-mid);
}
.combo-btn-active .combo-fee { color: rgba(255,255,255,0.8); }

/* ━━━ 모바일 오버라이드 (≤640px) ━━━ */
@media (max-width: 640px) {
  .combo-btn   { padding: 8px 12px; }    /* 상하 -1px / 좌우 -4px */
  .combo-label { font-size: 12px; }      /* 13px → 12px */
  .combo-fee   { font-size: 10px; }      /* 11px → 10px */
}
```

### 16-5. 토큰 요약

| 요소 | PC | Mobile |
|---|---|---|
| 패딩 | `9px 16px` | `8px 12px` |
| 레이블 | `13px` Bold · `--cs-text` | `12px` Bold · `--cs-text` |
| 요금 | `11px` Medium · `--cs-text-mid` | `10px` Medium · `--cs-text-mid` |
| 선택 레이블 | 13px · `#fff` | 12px · `#fff` |
| 선택 요금 | 11px · `rgba(255,255,255,0.8)` | 10px · `rgba(255,255,255,0.8)` |
| 반경 | `--radius-xl` (30px) | `--radius-xl` (30px) — 동일 |
| 보더 | `#DCDCDC 1.5px` | `#DCDCDC 1.5px` — 동일 |
| 선택 배경 | `var(--cs-purple)` | `var(--cs-purple)` — 동일 |
| 간격 | `gap: 6px` | `gap: 6px` — 동일 |

### 16-6. 금지 사항 (⛔)

```
❌ radio input + label 구현 금지 — 버튼 배열로만 구현
❌ <select> 드롭다운 대체 금지
❌ 선택 상태에 box-shadow 추가 금지 (USER 화면 그림자 금지 원칙)
❌ border-radius를 --radius-xl 외 값으로 변경 금지
❌ 모바일에서 border-radius / border / gap 별도 오버라이드 금지 (PC와 동일 유지)
```

### 16-7. GATE C 확인 항목

```
[ ] 선택 상태: border-color + background = var(--cs-purple)?
[ ] 비선택 보더: #DCDCDC 1.5px?
[ ] border-radius: var(--radius-xl) (30px) — PC·모바일 동일?
[ ] 레이블 색상 선택 시 #fff, 비선택 시 --cs-text?
[ ] 요금 텍스트 있는 경우 .combo-fee 클래스 사용?
[ ] 래퍼에 overflow-x: auto + scrollbar-width: none?
[ ] box-shadow 없음?
[ ] @media (max-width: 640px) 오버라이드 — padding/font-size만 축소?
[ ] 모바일: .combo-btn padding: 8px 12px?
[ ] 모바일: .combo-label font-size: 12px?
[ ] 모바일: .combo-fee font-size: 10px?
```

---

*front-uiux.md | 사용자(USER) 화면 표준 디자인 시스템 | Harness Flow v3.2*
*소스: crazyshot-Front_design-system.json (2026-07-10)*
*대응 CMS 문서: cms-uiux.md (절대 혼용 금지)*
