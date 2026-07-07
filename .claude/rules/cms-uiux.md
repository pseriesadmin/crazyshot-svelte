# cms-design.md — CMS 전용 디자인 시스템
# Harness Flow v3.2 | crazyshot 관리자 화면 표준 정본
# 소스: +layout.svelte · products · codes · accounts · accounts/list · login 페이지 실측
# 최종 업데이트: 2026-07-02

> CMS는 PC 전용(min-width: 1280px). 모바일 반응형 없음.
> 모든 값은 `src/app.css` CSS 변수를 우선 사용. 하드코딩 금지.

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

## 6. 반경 (Border Radius) — CMS 3단계 카드 시스템

> CMS 본문 영역 카드형 레이아웃은 아래 3단계 전용 변수로 통일한다.
> 변수는 `.cms-shell`에 정의 (src/routes/cms/+layout.svelte).

### CMS 전용 카드 반경 변수 (본문 영역)

| CSS 변수 | 값 | 적용 대상 |
|---|---|---|
| `--cms-radius-sm` | **10px** | 입력폼·알림 배너·설명·정보 박스 |
| `--cms-radius-md` | **15px** | 목록형 카드 (테이블·데이터 패널 감싸기) |
| `--cms-radius-lg` | **30px** | 그룹·메인 카드 (폼 섹션·페이지 컨테이너) |

```
입력폼·알림 예시: .f-input, .error-msg, .error-banner, .invite-box, .af-preview, .info-box
목록형 예시:     .table-card (products), .panel (codes), .table-wrap (accounts/list)
그룹·메인 예시:  .accounts-card, .login-card, .form-section (edit/new)
```

### 전역 반경 변수 (비카드 요소)

| CSS 변수 | 값 | CMS 적용 대상 |
|---|---|---|
| `--radius-sm` | 8px | 소형 버튼·배지·태그·코드 pill·인라인 입력·이미지 |
| `--radius-xl` | 30px | GNB pill·CTA 버튼 |
| `--radius-full` | 9999px | 원형 배지·토글 트랙 |

> `--radius-md` (15px), `--radius-lg` (20px), `--radius-2xl` (50px) 은 CMS 본문 카드에 더 이상 사용하지 않음.
> 버튼·탭·배지 등 비카드 요소에서만 기존 전역 변수 그대로 사용.

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

### 7-3. 버튼 3종

```css
/* =====================================================
   CMS 표준 버튼 패턴 — 2가지 형태만 존재
   공통 원칙: filled(채운) 배경 + var(--cs-white) 텍스트 + Noto Sans KR
   ===================================================== */

/* 기본형 — 주요 액션 (등록·저장·확인) */
.btn-primary {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 20px;
  background: var(--cs-purple);   /* 필수 토큰 — 임의 변경 금지 */
  color: var(--cs-white);         /* 필수 토큰 — 임의 변경 금지 */
  border: none;
  border-radius: var(--radius-xl);
  font: var(--text-pc-body-14);   /* Noto Sans KR 14px 700 — 필수 */
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-primary:hover    { background: var(--cs-purple-hover); }
.btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

/* 삭제 경고형 — 파괴적 액션 (삭제·취소·철회) */
/* 기본형과 동일 패턴, background 색만 --cs-red-badge로 변경 */
.btn-danger {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 20px;
  background: var(--cs-red-badge); /* 필수 토큰 — 임의 변경 금지 */
  color: var(--cs-white);          /* 필수 토큰 — 임의 변경 금지 */
  border: none;
  border-radius: var(--radius-xl);
  font: var(--text-pc-body-14);    /* Noto Sans KR 14px 700 — 필수 */
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s;
}
.btn-danger:hover { background: var(--cs-red); }

/* Toolbar CTA — 페이지 상단 툴바 주요 액션 버튼 (등록·추가 등) */
/* ⚠️ btn-primary(인라인 36px)와 별도 — 툴바 전용 44px 사이즈 */
.cta-btn {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 20px;
  background: var(--cs-purple);   /* 필수 — 임의 변경 금지 */
  color: var(--cs-white);         /* 필수 — 임의 변경 금지 */
  border: none;
  border-radius: var(--radius-xl);
  font: var(--text-pc-body-14);   /* Noto Sans KR 14px 700 */
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.12s;
}
.cta-btn:hover { background: var(--cs-purple-hover); }
```

> **툴바 CTA 버튼 핵심 원칙**
> - `background: var(--cs-purple)` + `color: var(--cs-white)` + `font: var(--text-pc-body-14)` (Noto Sans KR 14px 700) 조합이 CMS 표준 툴바 버튼 스타일
> - 인라인 보조 버튼(`btn-primary` 36px)과 혼용 금지 — 툴바 전용 44px 유지
> - `<a>` 태그(`href`)와 `<button>` 태그 모두 적용 가능

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

```css
/* 표준 입력 */
.f-input {
  background: var(--cs-surface-gray);
  border: none;
  border-radius: var(--radius-md);   /* 15px */
  padding: 10px 16px;
  font: var(--text-m-script-14);
  color: var(--cs-text);
  width: 100%;
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

/* 인라인 소형 입력 (테이블 내 편집) */
.inline-input {
  background: var(--cs-surface-gray);
  border: none;
  border-radius: var(--radius-sm);   /* 8px */
  padding: 6px 10px;
  font: var(--text-m-script-12);
  color: var(--cs-text);
}
.inline-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
```

### 7-8. 토글 스위치

```svelte
<!-- ✅ CMS 표준 토글 패턴 -->
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
    width: 40px;
    height: 22px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--cs-disabled-toggle);  /* #d0d0d8 off 상태 */
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .toggle.toggle-on { background: var(--cs-purple); }
  .toggle-thumb {
    position: absolute;
    top: 2px; left: 2px;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: var(--cs-white);
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .toggle.toggle-on .toggle-thumb { transform: translateX(18px); }
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
[ ] 버튼(CTA·ghost·danger): --radius-xl (30px) 유지 (카드 변수 사용 금지)?
[ ] 버튼 3종(primary·ghost·danger) 스펙 준수?
[ ] 토글: role="switch" + aria-checked 속성?
[ ] 모달: role="dialog" + aria-modal="true"?

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
❌ 모바일 반응형 미디어 쿼리 추가 (CMS는 PC 전용)
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
*소스 추출: src/routes/cms/ 전체 페이지 실측 기준*
