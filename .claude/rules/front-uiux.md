# front-uiux.md — 크레이지샷 사용자(USER) 화면 표준 디자인 시스템
# Harness Flow v3.2 | 사용자(USER) 환경 전용 정본
# 소스: crazyshot-Front_design-system.json (2026-07-10)
# 최종 업데이트: 2026-07-10

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

*front-uiux.md | 사용자(USER) 화면 표준 디자인 시스템 | Harness Flow v3.2*
*소스: crazyshot-Front_design-system.json (2026-07-10)*
*대응 CMS 문서: cms-uiux.md (절대 혼용 금지)*
