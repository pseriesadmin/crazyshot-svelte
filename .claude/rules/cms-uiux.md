# cms-design.md — CMS 전용 디자인 시스템
# Harness Flow v3.2 | crazyshot 관리자 화면 표준 정본
# 소스: CMS-Design-System-Tokens.json (2026-07-08) + 페이지 실측
# 최종 업데이트: 2026-07-09

> CMS는 PC 전용(min-width: 1280px). 모바일 반응형 없음.
> 모든 값은 `src/app.css` CSS 변수를 우선 사용. 하드코딩 금지.
> **토큰 정본**: `CMS-Design-System-Tokens.json` (product-list 1440×1413 실측, 2026-07-08)

---

## 0. CMS 표준 디자인 시스템 토큰 정본 (2026-07-08)

> 출처: `CMS-Design-System-Tokens.json` — product-list 1440×1413 실측 추출
> 아래 토큰이 모든 CMS 컴포넌트 작업의 **최우선 기준**이다.
> CSS 변수 열의 `—` 는 src/app.css에 등록이 필요한 미정의 토큰을 뜻한다.

### 0-1. 컬러 토큰

| 토큰명 | Hex | CSS 변수 | 용도 |
|---|---|---|---|
| `primary-900` | `#100B32` | `--cs-dark` / `--cs-text` | 본문 강조 텍스트, 아이콘 |
| `primary-800` | `#201857` | `--cs-purple-dark` | 주요 텍스트, 활성 탭, 토글 ON, GNB 배경 |
| `primary-600` | `#3B2F8A` | `--cs-purple` | 가격 텍스트, CTA 버튼, 탭 배경 |
| `primary-accent` | `rgba(39,27,122,0.5)` | — | 버튼 그림자 색상 (50% alpha) |
| `neutral-white` | `#FFFFFF` | `--cs-white` | 배경, 버튼 텍스트, 카드 배경 |
| `neutral-gray-100` | `#F7F7FA` | — | 최연한 배경 |
| `neutral-gray-150` | `#F6F6F6` | `--cs-surface-gray` | 서브 배경 |
| `neutral-gray-200` | `#F5F5F5` | — | 비활성 배경 |
| `neutral-gray-250` | `#F3F4F6` | — | 리스트 짝수행 배경 |
| `neutral-gray-500` | `#999999` | — | 비활성 텍스트, 플레이스홀더 |
| `neutral-gray-600` | `#666666` | `--cs-text-mid` | 보조 텍스트, 설명문 |
| `neutral-gray-border` | `#DDDDDD` | — | 구분선 (약한 보더) |
| `neutral-gray-stroke` | `#CCCCCC` | — | 비활성 보더 |
| `purpleTint-50` | `#F3F0FE` | — | 강조 배경 (최연한) |
| `purpleTint-100` | `#ECEBF4` | `--cs-lilac` | 보더, 구분선 (주력 보더 색상) |
| `purpleTint-150` | `#E8E4F8` | — | 카드/섹션 배경 |
| `purpleTint-200` | `#E1DEF3` | `--cs-purple-op10` | 활성 영역 배경, 선택 상태 |
| `danger-500` | `#FF3535` | `--cs-red-badge` | 삭제 텍스트, 경고 아이콘 |
| `danger-100` | `#FFE6E6` | — | 경고 아이콘 배경 |
| `danger-50` | `#FFCFCF` | `--cs-chat-in-bg` | 경고 뱃지 배경 |

### 0-2. 텍스트 컬러 토큰

| 토큰명 | Hex | CSS 변수 | 용도 |
|---|---|---|---|
| `textColor-default` | `#100B32` | `--cs-text` | 기본 본문 |
| `textColor-heading` | `#201857` | `--cs-purple-dark` | 강조/제목 |
| `textColor-secondary` | `#666666` | `--cs-text-mid` | 보조 텍스트 |
| `textColor-disabled` | `#999999` | — | 비활성/힌트 |
| `textColor-accent` | `#3B2F8A` | `--cs-purple` | 가격/액션 |
| `textColor-inverse` | `#FFFFFF` | `--cs-white` | 반전 (어두운 배경 위) |
| `textColor-danger` | `#FF3535` | `--cs-red-badge` | 위험/삭제 |

### 0-3. 타이포그래피 스케일

| 토큰명 | 크기 | 굵기 | 폰트 | line-height | letter-spacing | CSS 변수 | CMS 용도 |
|---|---|---|---|---|---|---|---|
| `heading-xl` | 22px | 900 (Black) | Noto Sans KR | auto | 0 | `--text-pc-hsub-22` | 상품 상세 제목 |
| `nav` | 20px | 500 (Medium) | SB AggroOTF | auto | 0 | `--text-pc-ad-kr-22` | GNB 내비게이션 메뉴 |
| `heading-md` | 16px | 700 (Bold) | Noto Sans KR | 200% | -0.5 | `--text-pc-title-16` | 탭 메뉴, 가격 태그 |
| `label-lg` | 14px | 700 (Bold) | Noto Sans KR | 100% | -0.5 | `--text-pc-body-14` | 버튼, 검색, 항목명 |
| `body-md` | 13px | 500 (Medium) | Noto Sans KR | auto | 0 | — | 카테고리 필터 텍스트 |
| `body-sm` | 13px | 400 (Regular) | Noto Sans KR | auto | 0 | — | 보조 설명 텍스트 |
| `label-sm` | 12px | 700 (Bold) | Noto Sans KR | auto | 0 | `--text-pc-script-12` | 가격, 뱃지, 서브라벨 |
| `body-xs` | 12px | 400 (Regular) | Noto Sans KR | auto | 0 | `--text-pc-script-12` | 카테고리 칩, 품번 |
| `caption` | 11px | 400 (Regular) | Noto Sans KR | 160% | 0 | `--text-pc-descript-10` | 상세 설명, QR 저장 |
| `meta` | 10px | 400 (Regular) | Noto Sans KR | auto | 0 | `--text-pc-descript-10` | 수량, 브랜드, 태그 |

> `body-md` (13px/500), `body-sm` (13px/400) 은 src/app.css에 미정의 — 사용 전 Stephen 승인 후 토큰 추가 필요.

### 0-4. 간격(Spacing) 토큰

| 토큰명 | 값 | 용도 |
|---|---|---|
| `spacing-xs` | 6px | 아이콘-텍스트 간격 |
| `spacing-sm` | 8px | 칩 내부, 인라인 요소 간격 |
| `spacing-md` | 10px | 리스트 아이템 간격 |
| `spacing-base` | 12px | 카드 내부 요소 간격 |
| `spacing-lg` | 16px | 섹션 내 그룹 간격 |
| `spacing-xl` | 20px | 카드 간 간격, 패널 간격 |
| `spacing-2xl` | 24px | 대 섹션 간격 |
| `spacing-3xl` | 30px | 영역 구분 간격 |
| `spacing-4xl` | 32px | 최대 영역 구분 |

### 0-5. 패딩(Padding) 토큰

| 토큰명 | 단축형 | 용도 |
|---|---|---|
| `padding-chip` | `5px 10px` | 칩, 태그, 소형 버튼 |
| `padding-button` | `8px 14px` | 기본 버튼, 뱃지 |
| `padding-listItem` | `10px 0px` | 리스트 행 |
| `padding-card` | `15px 20px` | 카드, 패널 내부 |
| `padding-section` | `20px` | 섹션 컨테이너 |
| `padding-minimal` | `2px` | 아이콘 래퍼 |
| `padding-pageSm` | `0px 20px` | 페이지 좌우 여백 (소) |
| `padding-pageMd` | `0px 30px` | 페이지 좌우 여백 (중) |
| `padding-pageLg` | `0px 40px` | 페이지 좌우 여백 (대) |

### 0-6. 보더 반경(Border Radius) 토큰

| 토큰명 | 값 | CSS 변수 매핑 | 용도 |
|---|---|---|---|
| `radius-xs` | 2px | — | 인풋 내부 요소 |
| `radius-sm` | 3px | — | 소형 태그 |
| `radius-md` | 6px | — | 칩, 소형 뱃지 |
| `radius-base` | 8px | `--radius-sm` | 카드, 입력 필드, 검색 입력 |
| `radius-cta` | **15px** | `--radius-md` | CTA 버튼 (ctaPrimary·ctaSecondary) |
| `radius-lg` | 10px | `--cms-radius-sm` | 패널, 모달 |
| `radius-xl` | 16px | — | 대형 카드, 이미지 래퍼 |
| `radius-pill` | 30px | `--radius-xl` / `--cms-radius-lg` | 필(pill) 버튼, 라운드 칩 |

> CMS 컴포넌트 반경 기준: **pill(30px) = `--radius-xl`**, **CTA(15px) = `--radius-md`**, **base(8px) = `--radius-sm`**, **lg(10px) = `--cms-radius-sm`**

### 0-7. 보더(Border) 토큰

| 토큰명 | 색상 | 두께 | 용도 |
|---|---|---|---|
| `border-default` | `#ECEBF4` (purpleTint-100) | 1px solid | 카드, 입력필드, 구분선 (주력) |
| `border-active` | `#201857` (primary-800) | 2px solid | 활성 탭, 선택 상태 |
| `border-inactive` | `#CCCCCC` (gray-stroke) | 2px solid | 비활성 보더 |

### 0-8. 그림자(Shadow) 토큰

| 토큰명 | CSS 값 | CSS 변수 | 용도 |
|---|---|---|---|
| `shadow-card` | `0px 1px 4px rgba(0,0,0,0.06)` | — | 카드, 패널 미세 엘리베이션 |

### 0-9. 컴포넌트 스펙 (JSON components 섹션)

| 컴포넌트 | 배경 | 텍스트 | 반경 | 패딩 | 기타 |
|---|---|---|---|---|---|
| `gnb` | primary-800 (#201857) | white / SB AggroOTF 20px/500 | — | 15px 40px | — |
| `signOutButton` | primary-600 (#3B2F8A) | white / Tilt Warp 20px/400 | pill (30px) | 8px 14px | — |
| `tabActive` | white | primary-800 / Noto 16px/700 | — | — | border-bottom: 2px primary-800 |
| `tabInactive` | transparent | gray-600 / Noto 16px/700 | — | — | — |
| `searchInput` | white | gray-600 / Noto 14px/700 | base (8px) | 10px 20px | border-default |
| `infoPanel` | gray-250 (#F3F4F6) | gray-600 / Noto 11px/400 / lh:160% | lg (10px) | 16px | — |

> **⚠️ 버튼·칩·카드 스펙은 아래 Section 0-10 / 0-11 (실측 정본)을 우선 적용.**
> components 섹션은 GNB·탭·searchInput·infoPanel에만 참조.

---

### 0-10. standardButtons — 실측 버튼 스펙 (정본)

> 출처: JSON `standardButtons` 섹션 — "디자인 시안에서 측정된 용도별 표준 버튼 컴포넌트 스펙"
> **이 값이 Section 0-9 components보다 우선한다.**

| 키 | 레이블 | height | BG | 반경 | 패딩 | 폰트 토큰 | 폰트 색 |
|---|---|---|---|---|---|---|---|
| `ctaPrimary` | CTA 기본 (상품등록) | **44px** | primary-600 `#3B2F8A` | **15px** (`--radius-md`) | 0 30px | label-lg 14px/700 | white |
| `ctaSecondary` | CTA 보조 (검색) | **44px** | white | **15px** (`--radius-md`) | 0 30px | label-lg 14px/700 | primary-800 `#201857` |
| `actionSave` | 액션 소형 (빠른 등록) | **34px** | primary-600 `#3B2F8A` | lg **10px** | 10px 20px | label-sm 12px/700 | white |
| `danger` | 위험 (삭제) | **40px** | danger-50 `#FFCFCF` | base **8px** | 0 20px | label-lg 14px/700 | danger-500 `#FF3535` |
| `categoryChipActive` | 카테고리 칩 활성 | **30px** | primary-800 `#201857` | base **8px** | 8px 14px | body-xs 12px/400 | white |
| `categoryChipDefault` | 카테고리 칩 기본 | **30px** | white | base **8px** | 8px 14px | body-xs 12px/400 | primary-900 `#100B32` |
| `priceTagSmall` | 가격 태그 소 (리스트) | **24px** | purpleTint-200 `#E1DEF3` | base **8px** | 5px 10px | label-sm 12px/700 | primary-600 `#3B2F8A` |
| `priceTagLarge` | 가격 태그 대 (상세) | **42px** | purpleTint-200 `#E1DEF3` | base **8px** | 5px 10px | heading-md 16px/700 | primary-600 `#3B2F8A` |
| `badgeCategory` | 카테고리 뱃지 소형 | **22px** | purpleTint-100 `#ECEBF4` | lg **10px** | 5px 10px | meta 10px/400 | primary-800 `#201857` |
| `badgeStock` | 재고 뱃지 | **22px** | gray-250 `#F3F4F6` | base **8px** | 5px 10px | meta 10px/400 | gray-600 `#666666` |
| `toggleStatusTag` | 노출 상태 태그 | **23px** | purpleTint-100 `#ECEBF4` | 2xl **20px** | 5px 10px | caption 11px/700 | gray-600 `#666666` |
| `closeCircle` | 닫기 원형 버튼 | **24×24** | purpleTint-100 `#ECEBF4` | **12px** (원형) | 0 | — 12px/700 | gray-600 |
| `toggleSwitch` | 토글 스위치 ON | **36×20** | primary-600 `#3B2F8A` | lg **10px** | 2px | — | — |

**ctaSecondary (보조 버튼) 추가 스펙:**
- border: `search` — `#201857` 1px solid

**categoryChipDefault 추가 스펙:**
- border: `default` — `#ECEBF4` 1px solid

**⚠️ 기존 지침과 다른 값 (JSON 실측 우선 적용):**
```
danger 버튼  : BG danger-50(#FFCFCF) + 텍스트 danger-500(#FF3535) — 빨강 배경 아님
categoryChip : radius base(8px) — pill(30px) 아님
toggleSwitch : ON 색 primary-600(#3B2F8A) / 크기 36×20 / radius lg(10px)
```

---

### 0-11. standardCards — 실측 카드 BG UI 스펙 (정본)

> 출처: JSON `standardCards` 섹션 — "디자인 시안에서 측정된 카드 레이아웃 BG UI 스펙"

| 키 | 레이블 | BG | 반경 | 패딩 | 그림자 | 기타 |
|---|---|---|---|---|---|---|
| `productListCard` | 상품 리스트 카드 (사이드바) | white | 2xl **20px** | 15px 20px | shadow-card | 400×132 |
| `productDetailCard` | 상품 상세 헤더 | — (없음) | **0** | 20px | — | 984×151 |
| `inlineListRow` | 인라인 리스트 행 | gray-150 `#F6F6F6` | xl **15px** | 15px 20px | — | 984×54 |
| `infoPanel` | 안내 정보 패널 | gray-250 `#F3F4F6` | lg **10px** | 16px | — | font: 11px/400/lh:160% |
| `pageContainer` | 전체 페이지 컨테이너 | purpleTint-100 `#ECEBF4` | **0** | — | — | 1440px |

**productListCard 자식 요소:**
- `thumbnailWrapper`: 60×60 / BG purpleTint-150(`#E8E4F8`) 또는 purpleTint-50(`#F3F0FE`) / radius lg(10px)
- `infoColumn`: 285×auto / BG 없음

**카드 BG 토큰 요약:**
```
흰 카드 (리스트)   : white         + radius 2xl (20px)
행 배경 (인라인)   : gray-150      + radius xl  (15px)
안내 패널          : gray-250      + radius lg  (10px)
페이지 배경        : purpleTint-100 (--cs-lilac)
썸네일 래퍼        : purpleTint-150 또는 purpleTint-50 + radius lg (10px)
```

---

## ⛔ 토큰 허용 범위 절대 지침 (CMS 전용)

> **uiux.md의 토큰 허용 범위 절대 지침과 동일하게 적용.**
> CMS 추가 제약은 아래와 같다.

### CMS 본문 허용 토큰 범위

```
공통 컬러  : --cs-*           (uiux.md Section 1 전체)
공통 반경  : --radius-*       (uiux.md Section 4 전체)
공통 그림자: --shadow-*
공통 레이아웃: --layout-*
CMS 카드   : --cms-radius-*   (sm:10px / md:15px / lg:30px — +layout.svelte 정의)
CMS 폰트   : --text-pc-*      (pc-com 범위 6종 + GNB 전용 2종)
              --text-m-* 사용 절대 금지 (CMS 본문에서)
```

### ❌ CMS 추가 금지 사항

```
❌ --text-m-* 모바일 폰트 토큰 CMS 본문 사용 금지 (GNB 제외)
❌ 새 CSS 변수(--custom-*) 임시 생성 후 사용 금지
❌ 허용 목록 외 rgba() 하드코딩 금지
❌ 허용 목록 외 #hex 하드코딩 금지
```

### ✅ CMS 허용 예외 하드코딩 (이 목록이 전부)

```css
/* purple tint — CSS 변수 미정의 */
rgba(59,47,138,0.04~0.12)  /* 행·hover·탭·선택·강조 */
/* red tint — CSS 변수 미정의 */
rgba(255,53,53,0.08~0.10)  /* 에러 배경 */
/* 로딩 오버레이 */
rgba(16,11,50,0.78)
/* codes 페이지 카테고리 컬러 (--bc 동적 주입) */
CAM:#FF4500  OPT:#3B2F8A  LGT:#F59E0B  AUD:#0EA5E9
SPT:#10B981  MON:#6366F1  PWR:#EC4899  MED:#8B5CF6
STD:#14B8A6  VID:#F97316  ACC:#84CC16  PKG:#06B6D4
/* Nav 필 테두리 */
border: 1px solid rgba(255,255,255,0.6);

/* ── CMS 표준 디자인 토큰 JSON에서 확인된 미정의 값 ── */
/* 카드 그림자 (shadow-card) */
box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
/* border-default 색상 */
border: 1px solid #ECEBF4;   /* purpleTint-100 = --cs-lilac */
/* 중립 배경 계열 (gray-250 infoPanel 배경) */
#F3F4F6  /* neutral-gray-250 */
/* 비활성 보더 (border-inactive) */
#CCCCCC  /* neutral-gray-stroke */
```

---

## 1. 레이아웃 구조

### 쉘 구조 (3-tier)

```
┌─────────────────────────────────────┐
│  .cms-topbar-wrap  (top-global GNB) │  height: 74px pill + padding-top 20px
├─────────────────────────────────────┤
│  .cms-subtabbar    (서브 탭바)        │  height: auto (약 48px)
├─────────────────────────────────────┤
│  .cms-main         (콘텐츠 영역)      │  flex: 1, overflow: hidden
└─────────────────────────────────────┘
```

```css
/* 전체 쉘 */
.cms-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 1280px;
  background: var(--cs-lilac);  /* #ECEBF4 */
  overflow: hidden;
}

/* 탑바 래퍼 */
.cms-topbar-wrap {
  flex-shrink: 0;
  padding: 20px 16px 0;         /* 상단 20px 여백으로 pill 부상 효과 */
  background: var(--cs-lilac);
}

/* 콘텐츠 */
.cms-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

### 페이지 콘텐츠 래퍼 (각 +page.svelte 표준)

```css
/* 스크롤 가능한 페이지 래퍼 */
.page-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px 32px;
}
```

---

## 2. GNB (최상단 탭바)

### 스펙
```
배경색  : var(--cs-dark)    #100B32
형태    : border-radius: var(--radius-xl)  30px  — pill 형태
높이    : 74px
레이아웃: 로고(좌) / 대메뉴+로그아웃(우)  justify-content: space-between
내부 패딩: 0 30px
```

### 대메뉴 탭
```css
.top-tab {
  color: rgba(255,255,255,0.50);   /* 비활성 */
  font: var(--text-pc-ad-kr-22);  /* SB AggroOTF 22px Medium */
  min-height: 44px;
  transition: color 0.15s;
}
.top-tab:hover  { color: rgba(255,255,255,0.85); }
.top-tab.active { color: var(--cs-white); }

/* 탭 간격 */
.topbar-nav { gap: 50px; }
```

### 서브 탭바
```css
.cms-subtabbar {
  display: flex;
  justify-content: center;
  gap: 4px;
  padding: 10px 16px 6px;
  background: transparent;
}

.sub-tab {
  padding: 6px 20px;
  border-radius: var(--radius-md);   /* 15px */
  color: var(--cs-text-mid);         /* #666666 */
  font: var(--text-m-script-14B);
  min-height: 34px;
  transition: background 0.15s, color 0.15s;
}
.sub-tab:hover  { background: rgba(59,47,138,0.08); color: var(--cs-text); }
.sub-tab.active { background: var(--cs-white); color: var(--cs-purple); }
```

### 로그아웃 버튼
```css
.logout-btn {
  background: var(--cs-red-badge);   /* #FF3535 */
  border-radius: var(--radius-lg);   /* 20px */
  color: var(--cs-white);
  font: var(--text-pc-menu-en-20);   /* Tilt Warp 20px */
  width: 130px;
  height: 54px;
}
```

---

## 3. 컬러 팔레트 (CMS 사용 빈도순)

| CSS 변수 | 값 | CMS 주요 용도 |
|---|---|---|
| `--cs-text` | `#100B32` | 기본 본문·제목 |
| `--cs-purple` | `#3B2F8A` | CTA 버튼·활성 탭·강조 |
| `--cs-white` | `#FFFFFF` | 카드·패널·활성 서브탭 배경 |
| `--cs-surface-gray` | `#f6f6f6` | 입력 필드·테이블 행 hover |
| `--cs-lilac` | `#ECEBF4` | 페이지 배경 |
| `--cs-text-mid` | `#666666` | 보조 텍스트·비활성 탭 |
| `--cs-text-light` | `#AAAAAA` | 힌트·비활성·플레이스홀더 |
| `--cs-text-dark` | `#444444` | 보조 레이블·설명 |
| `--cs-dark` | `#100B32` | GNB 배경·총액 박스 |
| `--cs-red-badge` | `#FF3535` | 삭제·경고·로그아웃 버튼 |
| `--cs-orange` | `#FF4500` | 로딩 dot·강조 포인트 |
| `--cs-success-light` | `#10B981` | 성공 배지·통계 |
| `--cs-disabled-button` | `#B0ABCC` | 비활성 버튼 |
| `--cs-info` | `#0EA5E9` | 정보·날짜 강조 파랑 |
| `--cs-warning` | `#F59E0B` | 경고·강조 노랑 |
| `--cs-bg-row-hover` | `#fafafa` | 테이블 행 hover |

### CMS 전용 허용 하드코딩 (CSS 변수 미정의 값)
```css
rgba(59,47,138,0.04)   /* purple tint 극연 — 행 배경 */
rgba(59,47,138,0.06)   /* purple tint 연   — 행 hover */
rgba(59,47,138,0.08)   /* purple tint 중   — 탭 hover */
rgba(59,47,138,0.10)   /* purple tint 강   — 선택 배경 */
rgba(59,47,138,0.12)   /* purple tint 강조 — 강조 영역 */
rgba(255,53,53,0.08)   /* red tint — 에러 행 배경 */
rgba(255,53,53,0.10)   /* red tint — 에러 강조 배경 */
rgba(16,11,50,0.78)    /* dark 오버레이 — 로딩 스크린 */

/* CMS 표준 디자인 토큰 JSON 2026-07-08 추가 */
box-shadow: 0px 1px 4px rgba(0,0,0,0.06)       /* shadow-card */
border: 1px solid #ECEBF4                       /* border-default (purpleTint-100) */
border: 2px solid #201857                       /* border-active (primary-800) */
border: 2px solid #CCCCCC                       /* border-inactive (gray-stroke) */
#F3F4F6   /* neutral-gray-250 — infoPanel 배경 */
#FFE6E6   /* danger-100 — 경고 아이콘 배경 */
#F5F5F5   /* neutral-gray-200 — 비활성 배경 */
```

---

## 4. 타이포그래피 (CMS 본문 — pc-com 토큰 전용)

> CMS 본문 영역은 Figma 디자인 토큰의 **pc-com 범위**만 사용한다.
> GNB(대메뉴·영문버튼)는 별도 토큰 유지.
> `--text-m-*` 모바일 토큰 사용 금지.

### 본문 영역 (6종)

| CSS 변수 | Figma 원본 | 크기/굵기 | CMS 용도 |
|---|---|---|---|
| `--text-pc-descript-10` | `pc-descript_com_10` | 10px 300 Noto | 최소 보조 텍스트 (라벨 대문자·뎁스 배지·역할 표기) |
| `--text-pc-script-12` | `pc-script_com_12` | 12px 400 Noto | 배지·캡션·테이블 헤더·힌트 |
| `--text-pc-body-14` | `pc-body_com_14b` | 14px 700 Noto | 기본 본문·레이블·탭·입력값·셀 |
| `--text-pc-title-16` | `pc-title_com_16b` | 16px 700 Noto | CTA 버튼·확인 모달 메시지 |
| `--text-pc-title-18` | `pc-title_com_18b` | 18px 700 Noto | 섹션 타이틀·stat 수치 |
| `--text-pc-htitle-25` | `pc-htitle_com_25b` | 25px 700 Noto | 페이지 h1 제목 |

### GNB 전용 (변경 금지)

| CSS 변수 | 크기/굵기 | 용도 |
|---|---|---|
| `--text-pc-ad-kr-22` | 22px Medium SB Aggro | GNB 대메뉴 (한글) |
| `--text-pc-menu-en-20` | 20px Regular Tilt Warp | GNB 영문 버튼 |

---

## 5. 간격 시스템 (CMS 실측)

| 용도 | 값 |
|---|---|
| 페이지 패딩 (좌우) | `24px` |
| 페이지 패딩 (상하) | `20px 32px` |
| 카드 내부 패딩 | `20px` (소) / `28px` (중) |
| 섹션 간격 | `20px` |
| 인풋 패딩 | `8px 12px` (소) / `10px 16px` (중) |
| 테이블 셀 패딩 | `10px 16px` |
| 버튼 패딩 | `8px 16px` (소) / `10px 20px` (중) |
| 행 간격 (gap) | `8px` (소) / `12px` (중) / `16px` (대) |

---

## 6. 반경 (Border Radius) — CMS 표준 토큰 기준

> **기준**: CMS-Design-System-Tokens.json `borderRadius` 섹션 (2026-07-08 확정)
> CMS 본문 영역 카드형 레이아웃은 아래 3단계 전용 변수로 통일한다.
> 변수는 `.cms-shell`에 정의 (src/routes/cms/+layout.svelte).

### CMS 표준 반경 토큰 (JSON 정본)

| JSON 토큰 | 값 | CSS 변수 | 적용 대상 |
|---|---|---|---|
| `radius-xs` | 2px | — | 인풋 내부 마이크로 요소 |
| `radius-sm` | 3px | — | 소형 태그 |
| `radius-md` | 6px | — | 칩, 소형 뱃지, 가격 태그 (`priceTag`) |
| `radius-base` | **8px** | `--radius-sm` | 카드, 입력 필드, 검색 입력 (`searchInput`, `productCard`) |
| `radius-cta` | **15px** | `--radius-md` | CTA 버튼 (`ctaPrimary`, `ctaSecondary`, `.cta-btn`, `.btn-primary` 44px) |
| `radius-lg` | **10px** | `--cms-radius-sm` | 패널, 모달, 정보박스 (`infoPanel`) |
| `radius-xl` | 16px | — | 대형 카드, 이미지 래퍼 |
| `radius-pill` | **30px** | `--radius-xl` / `--cms-radius-lg` | 필 버튼, 라운드 칩, GNB, 카테고리 칩, 토글 (`signOutButton`, `categoryChip`, `toggleOn`) |

### CMS 전용 카드 반경 변수 (본문 영역 — +layout.svelte 정의)

| CSS 변수 | 값 | JSON 토큰 대응 | 적용 대상 |
|---|---|---|---|
| `--cms-radius-sm` | **10px** | `radius-lg` | 입력폼·알림 배너·설명·정보 박스, infoPanel |
| `--cms-radius-md` | **15px** | — | 목록형 카드 (테이블·데이터 패널 감싸기) |
| `--cms-radius-lg` | **30px** | `radius-pill` | 그룹·메인 카드 (폼 섹션·페이지 컨테이너), GNB pill |

```
radius-base (8px) 적용 예시: .table-card, .f-input, .search-in, .product-card
radius-cta (15px) 적용 예시: .cta-btn, .btn-primary, .btn-secondary (44px CTA)
radius-lg (10px) 적용 예시: .info-box, .info-panel, .error-banner, .modal-dialog
radius-pill (30px) 적용 예시: .gnb-pill, .category-chip, .logout-btn, .toggle-track
```

### 전역 반경 변수 (비카드 요소)

| CSS 변수 | 값 | CMS 적용 대상 |
|---|---|---|
| `--radius-sm` | 8px | 카드·입력 (= JSON radius-base) |
| `--radius-md` | **15px** | CTA 버튼 (= JSON radius-cta) |
| `--radius-xl` | 30px | GNB pill·카테고리 칩·토글 (= JSON radius-pill) |
| `--radius-full` | 9999px | 원형 배지·토글 트랙 |

### codes 페이지 전용 — 카테고리 컬러 (하드코딩 허용)
```css
/* 카테고리별 루트 컬러 (--bc CSS 변수로 동적 주입) */
CAM: #FF4500   OPT: #3B2F8A   LGT: #F59E0B   AUD: #0EA5E9
SPT: #10B981   MON: #6366F1   PWR: #EC4899   MED: #8B5CF6
STD: #14B8A6   VID: #F97316   ACC: #84CC16   PKG: #06B6D4
```

---

## 7. 컴포넌트 패턴

### 7-1. 페이지 헤더

```svelte
<div class="page-header">
  <h1 class="page-title">상품 목록</h1>
  <p class="page-sub">등록된 상품을 관리합니다.</p>
</div>

<style>
  .page-header { margin-bottom: 20px; }
  .page-title  { font: var(--text-m-title-21); color: var(--cs-text); margin: 0 0 4px; }
  .page-sub    { font: var(--text-m-script-14); color: var(--cs-text-mid); margin: 0; }
</style>
```

### 7-2. 툴바 (검색 + CTA)

```svelte
<div class="toolbar">
  <div class="search-wrap">
    <input class="search-in" placeholder="검색..." />
  </div>
  <button class="btn-primary">+ 등록</button>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .search-in {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px 12px;
    font: var(--text-m-script-14);
    color: var(--cs-text);
    width: 240px;
  }
  .search-in::placeholder { color: var(--cs-text-placeholder); }
  .search-in:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
</style>
```

### 7-3. 버튼 종류별 스펙

> **기준**: JSON `standardButtons` 실측값 (Section 0-10) — components 섹션보다 우선

```css
/* =====================================================
   CMS 표준 버튼 패턴 — JSON standardButtons 실측 기준
   공통: Noto Sans KR / border-radius: var(--radius-md) 15px (ctaPrimary·ctaSecondary)
   ===================================================== */

/* ① CTA 기본 — 주요 액션 (등록·저장) | height 44px | JSON: ctaPrimary */
.btn-primary,
.cta-btn {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 30px;
  background: var(--cs-purple);    /* primary-600 #3B2F8A */
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-md); /* radius-cta = 15px */
  font: var(--text-pc-body-14);    /* label-lg: Noto 14px/700 */
  letter-spacing: -0.5px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s;
  text-decoration: none;
  box-shadow: none;
}
.btn-primary:hover,
.cta-btn:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

/* ② CTA 보조 — 검색·확인 | height 44px | JSON: ctaSecondary */
.btn-secondary {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 30px;
  background: var(--cs-white);
  color: var(--cs-purple-dark);    /* primary-800 #201857 */
  border: 1px solid #201857;       /* border-search: primary-800 1px */
  border-radius: var(--radius-md); /* radius-cta = 15px */
  font: var(--text-pc-body-14);    /* label-lg: Noto 14px/700 */
  letter-spacing: -0.5px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  text-decoration: none;
}
.btn-secondary:hover { background: rgba(59,47,138,0.06); }

/* ③ 액션 소형 — 패널 내 빠른 등록 | height 34px | JSON: actionSave */
.btn-action {
  display: inline-flex;
  align-items: center;
  height: 34px;
  padding: 10px 20px;
  background: var(--cs-purple);    /* primary-600 */
  color: var(--cs-white);
  border: none;
  border-radius: var(--cms-radius-sm); /* radius-lg = 10px */
  font: var(--text-pc-script-12);      /* label-sm: Noto 12px/700 */
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-action:hover { background: var(--cs-purple-hover); }

/* ④ 위험 — 삭제·철회 | height 40px | JSON: danger */
/* ⚠️ BG = danger-50(#FFCFCF) 연분홍, 텍스트 = danger-500(#FF3535) 빨강 — 빨강 배경 아님 */
.btn-danger {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 20px;
  background: var(--cs-chat-in-bg); /* danger-50 #FFCFCF */
  color: var(--cs-red-badge);        /* danger-500 #FF3535 */
  border: none;
  border-radius: var(--radius-sm);   /* radius-base = 8px */
  font: var(--text-pc-body-14);      /* label-lg: Noto 14px/700 */
  letter-spacing: -0.5px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-danger:hover { background: #ffb3b3; }
```

**버튼 종류 요약표:**

| 클래스 | 용도 | height | BG | 텍스트 색 | 반경 |
|---|---|---|---|---|---|
| `.btn-primary` / `.cta-btn` | 주요 액션 (등록·저장) | 44px | `--cs-purple` | white | **15px** |
| `.btn-secondary` | 보조 (검색·취소) | 44px | white | `--cs-purple-dark` | **15px** |
| `.btn-action` | 소형 인라인 액션 | 34px | `--cs-purple` | white | 10px |
| `.btn-danger` | 삭제·위험 | 40px | `--cs-chat-in-bg`(연분홍) | `--cs-red-badge` | 8px |

> `<a>` 태그(`href`)와 `<button>` 태그 모두 적용 가능

### 7-4. 카드 (흰 컨테이너) — 3단계 반경 시스템

```css
/* 그룹·메인 카드: 폼 섹션, 페이지 컨테이너 (30px) */
.form-section,
.accounts-card,
.login-card {
  background: var(--cs-white);
  border-radius: var(--cms-radius-lg);   /* 30px */
}

/* 목록형 카드: 테이블·데이터 패널 (15px) */
.table-card,
.panel,
.table-wrap {
  background: var(--cs-white);
  border-radius: var(--cms-radius-md);   /* 15px */
  overflow: hidden;
}

/* 입력폼·알림 카드: 인풋·에러·설명 박스 (10px) */
.f-input,
.error-msg,
.error-banner,
.invite-box,
.info-box {
  border-radius: var(--cms-radius-sm);   /* 10px */
}
```

### 7-5. 테이블

```css
.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font: var(--text-m-script-14);
  color: var(--cs-text);
}

thead th {
  background: var(--cs-lilac);
  color: var(--cs-text-mid);
  font: var(--text-m-script-12);
  padding: 10px 16px;
  text-align: left;
  white-space: nowrap;
}

tbody tr { border-bottom: 1px solid var(--cs-surface-gray); }
tbody tr:hover { background: rgba(59,47,138,0.04); }
tbody tr:last-child { border-bottom: none; }

td { padding: 10px 16px; vertical-align: middle; }
```

### 7-6. 배지

```css
/* 공통 베이스 */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font: var(--text-m-script-12);
  white-space: nowrap;
  line-height: 1.6;
}

/* 상태별 */
.badge-active   { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
.badge-inactive { background: var(--cs-surface-gray); color: var(--cs-text-light); }
.badge-error    { background: rgba(255,53,53,0.10);   color: var(--cs-red-badge); }
.badge-info     { background: rgba(59,47,138,0.08);   color: var(--cs-purple); }
```

### 7-7. 입력 필드 (CMS 표준)

> **JSON 정본**: `searchInput` (white/gray-600/Noto 14px 700/base 8px/padding 10px 20px/border-default)

```css
/* 표준 검색 입력 | JSON: searchInput */
.search-in,
.f-input-search {
  background: var(--cs-white);          /* white — JSON searchInput */
  border: 1px solid #ECEBF4;           /* border-default (purpleTint-100) */
  border-radius: var(--radius-sm);      /* radius-base = 8px */
  padding: 10px 20px;                   /* padding-card 상하 + pageSm 좌우 */
  font: var(--text-pc-body-14);         /* gray-600 색상과 조합 */
  color: var(--cs-text-mid);            /* gray-600 */
  width: 100%;
}
.search-in::placeholder,
.f-input-search::placeholder { color: var(--cs-text-light); }
.search-in:focus,
.f-input-search:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; border-color: var(--cs-purple); }

/* 폼 입력 (배경 gray, 테두리 없음 — 기존 패턴 유지) */
.f-input {
  background: var(--cs-surface-gray);   /* gray-150 */
  border: none;
  border-radius: var(--radius-sm);      /* radius-base = 8px (JSON 기준) */
  padding: 10px 16px;
  font: var(--text-pc-body-14);
  color: var(--cs-text);
  width: 100%;
}
.f-input::placeholder { color: var(--cs-text-light); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

/* 인라인 소형 입력 (테이블 내 편집) */
.inline-input {
  background: var(--cs-surface-gray);
  border: none;
  border-radius: var(--radius-sm);      /* radius-base = 8px */
  padding: 6px 10px;
  font: var(--text-pc-script-12);
  color: var(--cs-text);
}
.inline-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
```

### 7-7-1. 유사이름 제안 (`CmsSimilarNameInput`) — 공통 컴포넌트 ★

> **기능명**: 유사이름 제안  
> **컴포넌트**: `src/lib/components/cms/CmsSimilarNameInput.svelte`  
> **타입**: `src/lib/types/cms-similar-name.ts` → `SimilarNameItem`  
> **최초 적용**: `src/routes/cms/products/new/+page.svelte` (상품명)  
> **추가일**: 2026-07-09

한글·영문 일부 입력 시 DB에서 유사 이름을 검색해 **입력폼 바로 아래 플로팅 레이어**로 제안한다.  
CMS 화면에서 동일 UX가 필요하면 **페이지별 인라인 구현 금지** — 아래 공통 컴포넌트를 재사용한다.

#### 사용 조건

| 항목 | 기준 |
|---|---|
| 데이터 소스 | `source` — `product_name` · `brand` · `product_search`(상품명·브랜드·설명·캡션) |
| 최소 입력 | 2글자 (`minChars`, 브랜드는 1글자 권장) |
| 디바운스 | 280ms (`debounceMs`) |
| 제외 | `deleted_at IS NOT NULL` 항목 제외 |
| 수정 화면 | `excludeId`로 현재 레코드 제외 |

#### Props

| Prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `value` | `string` (bindable) | `''` | 입력값 |
| `id` / `name` | `string` | — | 폼 필드 식별·전송 |
| `placeholder` | `string` | `''` | 플레이스홀더 |
| `required` | `boolean` | `false` | 필수 여부 |
| `categoryLabels` | `Record<string,string>` | `{}` | 메타 카테고리 한글 라벨 |
| `excludeId` | `string \| null` | `null` | 자기 자신 제외 (수정 화면) |
| `source` | `'product_name' \| 'brand' \| 'product_search'` | `'product_name'` | DB 검색 대상 |
| `activeOnly` | `boolean` | `false` | `product_search` 시 활성 상품만 |
| `minChars` | `number` | `2` | 검색 시작 최소 글자 |
| `debounceMs` | `number` | `280` | 검색 지연 |
| `limit` | `number` | `8` | 최대 제안 수 |
| `oninput` | `(value: string) => void` | — | 입력 변경 콜백 (슬러그 연동 등) |
| `onselect` | `(item, previousValue) => void` | — | 제안 선택 콜백 |
| `field` | `Snippet<[SimilarNameFieldControl]>` | **필수** | 페이지에서 `.f-input` input 렌더 스니펫 |

#### 표준 사용 예 (상품명 + 슬러그 연동)

> **필수**: `field` 스니펫에서 페이지 scoped `.f-input`을 직접 렌더 — 컴포넌트 내부 input 생성 금지 (Svelte scoped CSS 깨짐 방지)

```svelte
<script lang="ts">
  import CmsSimilarNameInput from '$lib/components/cms/CmsSimilarNameInput.svelte'
  import type { SimilarNameItem } from '$lib/types/cms-similar-name'

  let nameVal = $state('')
  let slugVal = $state('')

  function onNameInput(val: string) {
    if (!slugVal || slugVal === autoSlug(val.slice(0, -1), category)) {
      slugVal = autoSlug(val, category)
    }
  }

  function onNameSelect(item: SimilarNameItem, previousValue: string) {
    const prevAuto = autoSlug(previousValue, category)
    if (!slugVal || slugVal === prevAuto) {
      slugVal = autoSlug(item.name, category)
    }
  }
</script>

<label for="name">상품명</label>
<CmsSimilarNameInput
  id="name"
  name="name"
  bind:value={nameVal}
  placeholder="..."
  categoryLabels={CATEGORY_LABELS}
  oninput={onNameInput}
  onselect={onNameSelect}
  required
>
  {#snippet field(c)}
    <input
      type="text"
      class="f-input"
      id={c.id}
      name={c.name}
      placeholder={c.placeholder}
      required={c.required}
      value={c.value}
      oninput={c.oninput}
      onkeydown={c.onkeydown}
      onfocus={c.onfocus}
      onblur={c.onblur}
      aria-autocomplete={c.ariaAutocomplete}
      aria-expanded={c.ariaExpanded}
      aria-controls={c.ariaControls}
      autocomplete="off"
    />
  {/snippet}
</CmsSimilarNameInput>
```

#### UI·접근성 규격 (컴포넌트 내장 — 재정의 금지)

```
레이어 위치   : 입력폼 하단 4px margin, position relative (인플로우 — 아래 필드 밀어냄, 겹침 방지)
레이어 스타일 : white BG / --cms-radius-sm / 보라 tint 보더 / shadow
항목 구성     : 이름(14px) + 메타(브랜드·카테고리·품번, 12px)
키보드        : ↑↓ 이동 · Enter 선택 · Esc 닫기
ARIA          : aria-autocomplete="list" · role="listbox" · role="option"
autocomplete  : off (브라우저 자동완성과 충돌 방지)
```

#### 재활용 체크리스트 (GATE C)

```
[ ] 유사이름 제안 필요 화면 → CmsSimilarNameInput 사용 (인라인 복제 금지)?
[ ] `field` 스니펫으로 페이지 `.f-input` 직접 렌더 (컴포넌트 내부 input 금지)?
[ ] 수정 화면에서 excludeId 전달?
[ ] 선택 시 부가 필드(슬러그 등)는 onselect/oninput에서만 처리?
```

### 7-7-2. 목록 제안 피커 (`CmsSuggestPicker`) — 로컬 옵션 공통 ★

> **용도**: `<select>` 대체 — 페이지 로드 옵션을 유사이름 제안 UI로 선택  
> **컴포넌트**: `src/lib/components/cms/CmsSuggestPicker.svelte`  
> **타입**: `src/lib/types/cms-suggest-picker.ts`  
> **최초 적용**: `products/new` 조합그룹 선택

`CmsSimilarNameInput`과 동일하게 **`field` 스니펫 + 페이지 `.f-input` 필수**.

| Prop | 설명 |
|---|---|
| `selectedId` | 선택 id (bindable) |
| `options` | `{ id, label, meta?[] }[]` |
| `minChars` | 기본 `0` (포커스 시 전체 목록) |

### 7-8. 토글 스위치

> **JSON 정본**: `standardButtons.toggleSwitch` — 36×20px / ON: primary-600(#3B2F8A) / radius lg(10px) / padding 2px
> ⚠️ components.toggleOn(primary-800)보다 standardButtons 실측값 우선

```svelte
<!-- ✅ CMS 표준 토글 패턴 | JSON: standardButtons.toggleSwitch -->
<button
  class="toggle"
  class:toggle-on={isActive}
  onclick={handleToggle}
  role="switch"
  aria-checked={isActive}
>
  <span class="toggle-thumb"></span>
</button>

<style>
  .toggle {
    position: relative;
    width: 36px;                            /* JSON 실측: 36px */
    height: 20px;                           /* JSON 실측: 20px */
    border: none;
    border-radius: var(--cms-radius-sm);    /* radius-lg = 10px */
    background: var(--cs-disabled-toggle);  /* off 상태 */
    cursor: pointer;
    padding: 2px;                           /* padding-minimal 토큰 */
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle.toggle-on { background: var(--cs-purple); } /* primary-600 #3B2F8A — JSON 실측 */
  .toggle-thumb {
    position: absolute;
    top: 2px; left: 2px;
    width: 16px; height: 16px;             /* JSON innerCircle: 16px */
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .toggle.toggle-on .toggle-thumb { transform: translateX(16px); }
</style>
```

### 7-10. 정보 패널 (infoPanel)

> **JSON 정본**: `infoPanel` (background: gray-250 #F3F4F6 / text: gray-600 Noto 11px/400/lh:160% / borderRadius: lg 10px / padding: 16px)

```svelte
<!-- ✅ CMS 표준 정보 패널 | JSON: infoPanel -->
<div class="info-panel">
  <slot />
</div>

<style>
  .info-panel {
    background: #F3F4F6;                    /* neutral-gray-250 — CSS 변수 미정의 */
    border-radius: var(--cms-radius-sm);    /* radius-lg = 10px */
    padding: 16px;                          /* spacing-lg */
    font: var(--text-pc-descript-10);       /* caption 토큰 — 11px/400/Noto/lh:160% 근사 */
    color: var(--cs-text-mid);              /* gray-600 */
    line-height: 160%;                      /* caption lh 기준 */
  }
</style>
```

### 7-11. 가격 태그 (priceTag)

> **JSON 정본**: `priceTag` (background: purpleTint-200 #E1DEF3 / text: primary-600 Noto 12px/700 / borderRadius: md 6px / padding: 5px 10px)

```svelte
<!-- ✅ CMS 가격 태그 | JSON: priceTag -->
<span class="price-tag">{price}</span>

<style>
  .price-tag {
    display: inline-flex;
    align-items: center;
    background: var(--cs-purple-op10);     /* purpleTint-200 #E1DEF3 */
    color: var(--cs-purple);               /* primary-600 */
    border-radius: 6px;                    /* radius-md — CSS 변수 미정의 */
    padding: 5px 10px;                     /* padding-chip 토큰 */
    font: var(--text-pc-script-12);        /* label-sm 토큰: 12px/700 */
    font-weight: 700;
    white-space: nowrap;
  }
</style>
```

### 7-12. 카테고리 칩 (categoryChip)

> **JSON 정본**: `standardButtons.categoryChipActive` (primary-800/white/Noto 12px/400/**base 8px**/height 30px)
> **JSON 정본**: `standardButtons.categoryChipDefault` (white/primary-900/Noto 12px/400/**base 8px**/height 30px/border-default)
> ⚠️ components 섹션 pill(30px) 아님 — standardButtons 실측 8px 우선

```svelte
<!-- ✅ 전체 선택 칩 (활성) -->
<button class="chip chip-all">전체</button>
<!-- ✅ 일반 칩 -->
<button class="chip chip-default">카테고리</button>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    height: 30px;                           /* JSON 실측: 30px */
    border-radius: var(--radius-sm);        /* radius-base = 8px — JSON 실측 */
    padding: 5px 10px;                      /* padding-chip 토큰 */
    font: var(--text-pc-script-12);         /* body-xs: 12px/400 */
    font-weight: 400;
    white-space: nowrap;
    cursor: pointer;
    border: none;
    transition: background 0.12s;
  }
  .chip-all {
    background: var(--cs-purple-dark);      /* primary-800 #201857 */
    color: var(--cs-white);
  }
  .chip-default {
    background: var(--cs-white);
    color: var(--cs-text);                  /* primary-900 */
    border: 1px solid #ECEBF4;             /* border-default (purpleTint-100) */
  }
  .chip-default:hover { background: rgba(59,47,138,0.06); }
</style>
```

### 7-9. 확인 모달 (삭제 등)

```svelte
{#if showConfirm}
  <div class="confirm-backdrop" onclick={handleCancel} role="presentation">
    <div class="confirm-dialog" role="dialog" aria-modal="true">
      <p class="confirm-msg">{confirmMessage}</p>
      <p class="confirm-sub">{confirmSub}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={handleCancel}>취소</button>
        <button class="confirm-ok"     onclick={handleConfirm}>삭제</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-backdrop {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .confirm-dialog {
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 28px 32px;
    min-width: 320px;
    max-width: 420px;
    text-align: center;
  }
  .confirm-msg     { font: var(--text-m-script-14B); color: var(--cs-text); margin: 0 0 8px; }
  .confirm-sub     { font: var(--text-m-script-12);  color: var(--cs-text-mid); margin: 0 0 20px; }
  .confirm-actions { display: flex; gap: 10px; justify-content: center; }
  .confirm-cancel  { /* .btn-ghost 스타일 */ }
  .confirm-ok      { /* .btn-danger 스타일 */ }
</style>
```

### 7-10. 네비게이션 로딩 오버레이

```svelte
<!-- +layout.svelte에서 관리 — 직접 구현 금지 -->
<!-- beforeNavigate/afterNavigate로 isNavigating 제어 -->
{#if isNavigating}
  <div class="nav-loading-overlay">
    <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="nav-loading-logo" />
    <div class="nav-loading-dots">
      <span></span><span></span><span></span>
    </div>
  </div>
{/if}
```

---

## 8. 폼 레이아웃 패턴

### 그리드 폼 (2열)
```css
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.form-grid .form-full { grid-column: 1 / -1; }

.form-field label {
  display: block;
  font: var(--text-m-script-12);
  color: var(--cs-text-mid);
  margin-bottom: 6px;
}
```

### 인라인 폼 (테이블 내 등록)
```css
.add-form-inline {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 16px;
  background: rgba(59,47,138,0.04);
  border-top: 1px solid var(--cs-surface-gray);
}
```

---

## 9. 역할 배지 (cms_role)

```css
.role-tag { /* 공통 베이스 — .badge 상속 */ }
.role-superadmin { background: rgba(59,47,138,0.12); color: var(--cs-purple); }
.role-manager    { background: rgba(59,47,138,0.08); color: var(--cs-purple-light); }
.role-partner    { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
```

---

## 10. 에러·피드백 패턴

```css
/* 인라인 에러 바 (폼 하단) */
.error-bar {
  background: var(--cs-bg-error);
  border-left: 3px solid var(--cs-red-badge);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font: var(--text-m-script-12);
  color: var(--cs-error);
  margin-top: 8px;
}

/* 빈 상태 */
.no-data {
  text-align: center;
  padding: 40px 20px;
  font: var(--text-m-script-14);
  color: var(--cs-text-light);
}
```

---

## 11. GATE C 확인 항목 (CMS 퍼블리싱)

```
[standardButtons JSON 실측 준수 — 2026-07-08 기준 최우선]
[ ] CTA 기본 버튼 (.btn-primary): height 44px / var(--cs-purple) / radius-md 15px?
[ ] CTA 보조 버튼 (.btn-secondary): height 44px / white + border primary-800 / radius-md 15px?
[ ] 소형 액션 버튼 (.btn-action): height 34px / var(--cs-purple) / radius-cms-sm 10px?
[ ] 위험 버튼 (.btn-danger): height 40px / **연분홍 BG**(#FFCFCF) / 빨강 텍스트(#FF3535)?
[ ] 토글 스위치 (.toggle-on): width 36px / height 20px / radius-cms-sm 10px / **--cs-purple**(primary-600)?
[ ] 카테고리 칩 (.chip): height 30px / **radius-sm 8px** (pill 30px 금지)?

[standardCards JSON 실측 준수 — 2026-07-08 기준]
[ ] 상품 목록 카드: white BG / radius-2xl 20px / padding 15px 20px / shadow-card?
[ ] 인라인 목록 행: gray-150 BG / radius-xl 15px / padding 15px 20px?
[ ] infoPanel: gray-250(#F3F4F6) BG / radius-lg 10px(--cms-radius-sm) / padding 16px?
[ ] priceTag: purpleTint-200(#E1DEF3) BG / radius-md 6px / padding 5px 10px?

[CMS 표준 디자인 토큰 JSON 공통]
[ ] shadow-card (0px 1px 4px rgba(0,0,0,0.06)) — 목록 카드 적용?
[ ] border-default (#ECEBF4) — 구분선·카드 보더?
[ ] searchInput: white BG + border-default 1px #ECEBF4?
[ ] GNB 배경: primary-800 (#201857 = --cs-purple-dark)?

[토큰 범위 준수 — 절대 지침]
[ ] 사용한 CSS 변수가 모두 src/app.css 또는 --cms-radius-* 정의 범위 내에 있는가?
[ ] 허용 목록 외 하드코딩(#hex / rgba / px) 없는가?
[ ] --text-m-* 모바일 폰트 토큰을 CMS 본문에서 사용하지 않았는가?
[ ] 임시 CSS 변수 임의 생성 없는가?

레이아웃
[ ] 페이지 래퍼에 overflow-y: auto 있음? (cms-main은 overflow: hidden)
[ ] 최소 너비 min-width: 1280px 설정?
[ ] GNB 탑바: position static (이미 fixed 레이아웃으로 구성됨)

컬러·스타일
[ ] 배경색: var(--cs-lilac) / 카드: var(--cs-white)?
[ ] 하드코딩 hex 없음? (허용 목록 외)
[ ] purple tint: rgba(59,47,138,...) 패턴 사용?

컴포넌트
[ ] 테이블 헤더 배경: var(--cs-lilac)?
[ ] 그룹·메인 카드: --cms-radius-lg (30px)?
[ ] 목록형 카드(테이블·패널): --cms-radius-md (15px)?
[ ] 입력폼·알림·설명 박스: --cms-radius-sm (10px)?
[ ] CTA 버튼 반경: --radius-md (15px) — --radius-xl 30px 금지?
[ ] 버튼 4종(primary·secondary·action·danger) 스펙 준수?
[ ] 토글: role="switch" + aria-checked 속성?
[ ] 모달: role="dialog" + aria-modal="true"?
[ ] 유사이름 제안: CmsSimilarNameInput 공통 컴포넌트 사용 (인라인 복제 금지)?

타이포그래피 (pc-com 토큰 전용)
[ ] --text-m-* 모바일 토큰 미사용 (금지)?
[ ] 최소 보조 텍스트 (뎁스배지·역할라벨): --text-pc-descript-10?
[ ] 배지·캡션·테이블 헤더: --text-pc-script-12?
[ ] 기본 본문·레이블·입력값: --text-pc-body-14?
[ ] CTA 버튼·모달 메시지: --text-pc-title-16?
[ ] 섹션 타이틀: --text-pc-title-18?
[ ] 페이지 h1: --text-pc-htitle-25?
[ ] 힌트 컬러: var(--cs-text-light)?

접근성
[ ] 인터랙티브 요소 최소 44×44px?
[ ] 버튼에 명확한 텍스트 또는 aria-label?
[ ] 에러 메시지 role="alert"?

네비게이션
[ ] 로딩 오버레이는 +layout.svelte에서만 관리?
[ ] beforeNavigate/afterNavigate로 isNavigating 제어?
```

---

## 12. 절대 금지 사항

```
❌ 유사이름 제안 UI를 페이지에 인라인 복제 — `CmsSimilarNameInput` 재사용 필수
❌ `CmsSimilarNameInput` 내부에 input 직접 생성 — `field` 스니펫 + 페이지 `.f-input` 필수
❌ position: fixed 남용 — 레이아웃 컨텍스트 오염 주의
❌ 글로벌 스타일 :global() 임의 추가 — +layout.svelte에서만
❌ 별도 로딩 스피너 컴포넌트 생성 — 레이아웃 오버레이 재사용
❌ 테이블 직접 DML (INSERT/UPDATE/DELETE) — RPC 경유 필수
❌ 관리자 액션 전 cms_role 확인 누락

[토큰 위반 — 즉시 기각]
❌ src/app.css 미정의 CSS 변수 임의 생성·사용
❌ 기존 토큰 매핑 가능한 값의 하드코딩 (#hex / px / rgba)
❌ --text-m-* 모바일 폰트 토큰 CMS 본문 사용
❌ 허용 목록 외 예외 하드코딩 (상단 절대 지침 목록 외)
```

---

*cms-design.md | CrazyShot CMS 전용 디자인 시스템 정본 | Harness Flow v3.2*
*참조: uiux.md (공통 토큰) · ui-mobile.md (Svelte 5 문법) · security-auth.md (인증)*
*토큰 정본: CMS-Design-System-Tokens.json (product-list 1440×1413, 2026-07-08 추출)*
*소스 추출: src/routes/cms/ 전체 페이지 실측 + JSON 토큰 병합*
