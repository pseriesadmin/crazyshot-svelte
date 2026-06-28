# uiux.md — CrazyShot UI/UX 디자인 시스템 v1.0
# Harness Flow v3.2 | 정본 (클로드 + 커서 공통 참조)
# 소스: Figma variables.json + Figma Make 0701OrderList
# 커서 자동 로딩: .cursor/rules/uiux.mdc (래퍼) → 이 파일을 참조

> 모든 CSS 값은 `src/app.css`의 CSS 변수를 통해 참조한다. 하드코딩 금지.

---

## 1. 컬러 팔레트

### 브랜드 컬러
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--cs-orange` | `#FF4500` | CrazyShot 대표 오렌지, 로고 강조 |
| `--cs-dark` | `#100B32` | 헤더 배경, 총금액 박스, 주요 텍스트 다크 |
| `--cs-purple` | `#3B2F8A` | CTA 버튼, 선택 상태, 강조 인터랙션 |
| `--cs-purple-hover` | `#2E2470` | 버튼 hover |
| `--cs-purple-light` | `#553FE0` | 파란 멤버십 배지 |
| `--cs-red-badge` | `#FF3535` | 빨간 딜 배지 |
| `--cs-lilac` | `#ECEBF4` | 페이지 배경, 수량 박스 배경 |
| `--cs-lilac-nav` | `rgba(225,222,243,0.7)` | Nav 필 반투명 배경 |

### 텍스트 컬러
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--cs-text` | `#100B32` | 기본 본문 텍스트 |
| `--cs-text-dark` | `#444444` | 보조 텍스트 (가격, 레이블) |
| `--cs-text-mid` | `#777777` | 3차 텍스트 |
| `--cs-text-light` | `#AAAAAA` | 힌트, 비활성 |
| `--cs-text-placeholder` | `#b6b6b6` | 폼 플레이스홀더 |

### 서피스 컬러
| 토큰 | 값 | 용도 |
|------|-----|------|
| `--cs-white` | `#FFFFFF` | 카드 배경, 하단 바 배경 |
| `--cs-surface-gray` | `#f6f6f6` | 폼 입력, 라디오 컨테이너, 결제금액 블록 |
| `--cs-points` | `#c1bbec` | 포인트 텍스트 (다크 박스 위) |

---

## 2. 타이포그래피

### 폰트 패밀리 (우선순위 순)
```css
--font-kr:           'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif  /* UI 기본 */
--font-kr-heading:   'SB AggroOTF', 'Noto Sans KR', sans-serif          /* 한글 헤드라인 */
--font-en-display:   'Tilt Warp', sans-serif                             /* 영문 메뉴·서브타이틀 */
--font-en-condensed: 'Config Condensed', sans-serif                      /* 영문 대형 광고 전용 */
```

### PC 타이포 스케일 (`--text-pc-*`)
| 토큰 | 크기/굵기 | 폰트 | 용도 |
|------|----------|------|------|
| `--text-pc-ad-en-80` | 80px Black Italic | Config Condensed | 랜딩 영문 광고 |
| `--text-pc-ad-kr-60` | 60px Bold | SB AggroOTF | 랜딩 한글 광고 |
| `--text-pc-ad-en-35` | 35px Regular | Tilt Warp | 영문 광고 서브 |
| `--text-pc-ad-kr-35` | 35px Bold | SB AggroOTF | 한글 타이틀 대형 |
| `--text-pc-htitle-25` | 25px Bold | Noto Sans KR | 페이지 헤더 타이틀 |
| `--text-pc-menu-en-20` | 20px Regular | Tilt Warp | 영문 메뉴·섹션 레이블 |
| `--text-pc-menu-kr-20` | 20px Medium | SB AggroOTF | 한글 메뉴 |
| `--text-pc-title-18` | 18px Bold | Noto Sans KR | 섹션 타이틀 |
| `--text-pc-title-16` | 16px Bold | Noto Sans KR | 카드 제목, 폼 레이블 |
| `--text-pc-body-14` | 14px Bold | Noto Sans KR | 본문 강조 |
| `--text-pc-script-12` | 12px Regular | Noto Sans KR | 캡션, 힌트 텍스트 |

### Mobile 타이포 스케일 (`--text-m-*`)
| 토큰 | 크기/굵기 | 용도 |
|------|----------|------|
| `--text-m-ad-kr-40` | 40px Bold SB Aggro | 모바일 랜딩 |
| `--text-m-ad-kr-30` | 30px Bold SB Aggro | 모바일 섹션 헤드 |
| `--text-m-menu-en-24` | 24px Tilt Warp | 모바일 영문 메뉴 |
| `--text-m-htitle-24B` | 24px Black Noto | 모바일 주요 제목 |
| `--text-m-title-21` | 21px Bold Noto | 카드 제목 |
| `--text-m-title-18B` | 18px Bold Noto | 소섹션 타이틀 |
| `--text-m-body-16B` | 16px Bold Noto | 본문 강조 |
| `--text-m-body-16L` | 16px Medium Noto | 기본 본문 |
| `--text-m-script-14B` | 14px Bold Noto | 레이블 강조 |
| `--text-m-script-14` | 14px Medium Noto | 가격·보조 정보 |
| `--text-m-script-12` | 12px Medium Noto | 캡션·힌트 |

### 적용 방법
```css
/* ✅ 올바른 방법 */
.section-title { font: var(--text-pc-title-18); color: var(--cs-text); }
.price-label   { font: var(--text-m-script-14); color: var(--cs-text-dark); }

/* ❌ 금지: 직접 값 입력 */
.section-title { font-size: 18px; font-weight: 700; font-family: 'Noto Sans KR'; }
```

---

## 3. 레이아웃 시스템

### 그리드 (Figma 기준)
- **PC-F**: 12컬럼, 거터 20px, 오프셋 25px (Stretch)
- **PC-C**: 12컬럼, 섹션 60px, 거터 20px (Center)
- **Mobile**: 4컬럼, 거터 20px, 오프셋 25px

### 컨테이너 토큰
```css
--layout-pc-max:      1240px   /* 콘텐츠 최대폭 */
--layout-pc-pad:      40px     /* PC 좌우 패딩 */
--layout-tab-pad:     32px     /* 태블릿 (≤1024px) */
--layout-mob-pad:     20px     /* 모바일 (≤640px) */
--layout-section-gap: 50px     /* 메인 섹션 간격 */
--layout-header-h:    100px    /* 헤더 고정 높이 */
--layout-footer-h:    80px     /* 하단 고정 바 높이 */
```

### 표준 페이지 컨테이너 패턴
```svelte
<div class="page-container">
  <!-- 콘텐츠 -->
</div>

<style>
.page-container {
  max-width: var(--layout-pc-max);
  margin: 0 auto;
  padding: var(--layout-section-gap) var(--layout-pc-pad);
  display: flex;
  flex-direction: column;
  gap: var(--layout-section-gap);
}
@media (max-width: 1024px) { .page-container { padding-inline: var(--layout-tab-pad); } }
@media (max-width: 640px)  { .page-container { padding-inline: var(--layout-mob-pad); gap: 28px; } }
</style>
```

---

## 4. 반경 (Border Radius)

| 토큰 | 값 | 적용 대상 |
|------|-----|----------|
| `--radius-xs` | 4px | 쿠폰 태그, 뱃지 텍스트 |
| `--radius-sm` | 8px | 소형 버튼, 검색 결과 |
| `--radius-md` | 15px | 폼 입력 필드 (`f-input`) |
| `--radius-lg` | 20px | 날짜 행, 라디오 컨테이너, nav 필 |
| `--radius-xl` | 30px | CTA 버튼, 총금액 다크 박스 |
| `--radius-2xl` | 50px | **흰 카드** (Order Items, Rental Options, Order Total) |
| `--radius-full` | 9999px | 배지 아이콘, 태그 |

---

## 5. 이펙트 (그림자)

```css
--shadow-outsh1:     10px 10px 0 rgba(5,0,38,1)        /* 강한 다크 — 텍스트 장식 */
--shadow-outsh2:     4px 4px 0 rgba(39,27,122,0.5)     /* 보라 반투명 — 인터랙티브 요소 */
--shadow-outsh3:     5px 5px 0 rgba(16,11,50,1)        /* #100B32 단색 — 카드/버튼 */
--shadow-outsh4:     0 0 15px rgba(255,255,255,0.5)    /* 흰 글로우 — 다크 배경 위 요소 */
--shadow-outsh5:     4px 5px 0 rgba(0,0,0,0.5)         /* 검은 그림자 — 사진 위 텍스트 */
--shadow-inner:      inset 0 0 60px rgba(0,0,0,0.6)   /* 이너 — 이미지 오버레이 */
--shadow-bottom-bar: 0 -2px 20px rgba(16,11,50,0.10)  /* 하단 바 */
```

---

## 6. 컴포넌트 패턴

### 흰 카드
```css
.white-card {
  background: var(--cs-white);
  border-radius: var(--radius-2xl);  /* 50px */
  overflow: hidden;
}
```

### CTA 버튼 (Primary)
```css
.pay-btn {
  background: var(--cs-purple);
  color: var(--cs-white);
  border: none;
  border-radius: var(--radius-xl);  /* 30px */
  height: 60px;
  font: var(--text-pc-title-16);
}
.pay-btn:hover    { background: var(--cs-purple-hover); }
.pay-btn:disabled { background: #B0ABCC; cursor: not-allowed; }
```

### 헤더 (고정)
```css
.cs-header {
  position: fixed; top: 0; left: 0; right: 0; z-index: 200;
  background: var(--cs-dark);
  height: var(--layout-header-h);
}
```

### Nav 필 (반투명 라벤더)
```css
.nav-pill {
  background: var(--cs-lilac-nav);
  border: 1px solid rgba(255,255,255,0.6);
  backdrop-filter: blur(8px);
  border-radius: var(--radius-lg);  /* 20~25px */
  padding: 16px 32px;
  display: flex; align-items: center; justify-content: space-between;
}
```

### 폼 입력 필드
```css
.f-input {
  background: var(--cs-surface-gray);
  border: none;
  border-radius: var(--radius-md);  /* 15px */
  padding: 12px 20px;
  font: var(--text-m-script-14);
  color: var(--cs-text);
}
.f-input::placeholder { color: var(--cs-text-placeholder); }
.f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
```

### 배지 (아이콘 원형)
```css
/* 멤버십 배지: 40px 원형 */
.badge-red  { width: 40px; height: 40px; border-radius: 50%; background: var(--cs-red-badge); }
.badge-blue { width: 40px; height: 40px; border-radius: 50%; background: var(--cs-purple-light); }
```

### 날짜 행 (스플릿)
```css
.date-row-split { display: flex; border-radius: var(--radius-lg); overflow: hidden; }
.dr-left  { background: #444; padding: 14px 20px; flex: 1; }
.dr-right { background: #666; padding: 14px 20px; flex: 1; }
```

### 총금액 다크 박스
```css
.total-navy-box {
  background: var(--cs-dark);
  border-radius: var(--radius-xl);  /* 30px — 전체 radius */
  padding: 24px 40px;
  margin-top: 16px;
}
```

### 하단 고정 바
```css
.bottom-bar {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--cs-white);
  box-shadow: var(--shadow-bottom-bar);
  height: var(--layout-footer-h);
}
```

---

## 7. 배달 마감 UI 기준

| 배송 방식 | 마감 표시 |
|----------|---------|
| epost/CJ | 15:00 |
| quick    | 17:00 |
| locker   | 18:00 |
| pickup   | 19:00 |
| 두발히어로 | 화면 13:30 (실제 14:00) |
| 공휴일    | "다음 영업일" |

---

## 9. GNB (공통 헤더 네비게이션) 레이아웃 원칙

> 확정 기준: 2026-06-28 피그마 시안 반영

```
GNB 포지셔닝 전략: position: fixed (오버레이) — 절대 sticky/static 금지
- PC & 모바일 모두: GNB가 히어로/배너 콘텐츠 위에 오버레이
- GNB 전용 영역(별도 레이아웃 공간) 존재 금지
- 콘텐츠는 페이지 최상단(0px)부터 시작 — GNB가 레이아웃 흐름을 점유하지 않음
```

### GNB 래퍼 필수 CSS 패턴

```css
/* ✅ PC 데스크탑 GNB 래퍼 */
.gnb-desktop-wrap {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 50;
  pointer-events: none;   /* 클릭 영역은 nav 자체에서만 */
}

/* ✅ 모바일 GNB 래퍼 */
.gnb-mobile-wrap {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 50;
  background: transparent;   /* 배경색 없음 — 콘텐츠 투시 */
  pointer-events: none;
}

/* ✅ 공통: 실제 nav 요소는 pointer-events 복원 */
.gnb-desktop-nav,
.gnb-mobile-nav {
  pointer-events: all;
}
```

### ❌ 절대 금지 패턴

```css
/* ❌ GNB에 sticky 사용 — 레이아웃 공간 점유 */
.gnb-wrap { position: sticky; top: 0; }

/* ❌ GNB 래퍼에 배경색 설정 — 콘텐츠 가림 */
.gnb-mobile-wrap { background: var(--cs-lilac); }

/* ❌ GNB 아래 콘텐츠에 margin-top으로 보정 */
.hero { margin-top: -100px; }   /* GNB fixed → 보정 불필요 */
```

---

## 10. Hero 섹션 높이 기준

> 확정 기준: 2026-06-28

```
모바일 hero 기준 높이: 720px
PC hero 높이: 모바일 × 1.3 = 936px

비율 공식: PC hero height = 모바일 hero height × 1.3
```

```css
/* ✅ 표준 hero 높이 */
.m-hero { height: 720px; }   /* 모바일 */
.d-hero { height: 936px; }   /* PC (720 × 1.3) */
```

---

## 11. FloatingBar (모바일 플로팅 FAB) 인터랙션 원칙

> 확정 기준: 2026-06-28

### 아이콘 사이즈 기준

```
장바구니·검색 FAB: 모바일 55px / PC 40px
채팅 FAB: 크기 변경 금지 — 채팅 강조 의도 유지 (FloatingButton 컴포넌트 자체 크기)
```

### 모바일 Peek & Expand 인터랙션

```
기본 상태 (peek): 화면 우측 절반만 노출
  → transform: translateX(calc(50% + 24px))
  → 진입 조건: 페이지 최초 로드, 라우트 변경, 스크롤 발생

확장 상태 (expanded): 전체 노출 + 버블 애니메이션
  → 진입 조건: 플로팅 바 터치(탭)
  → 버블: scale 1.12, 0.32s ease-out

peek↔expanded 트랜지션: cubic-bezier(0.34, 1.28, 0.64, 1) 0.42s (스프링 바운스)
```

### CSS transform + position:fixed 버그 방지 원칙

```
⚠️ CSS transform이 적용된 조상 요소 내부에서 position:fixed 자식은
   뷰포트 기준이 아닌 transform 요소 기준으로 배치됨 → 모달 왜곡 발생

해결: peek 상태(transform 활성) 시 채팅 바텀시트 진입 차단
  → pointer-events: none으로 FloatingButton wrapper 차단
  → 확장 후(transform 해제)에만 바텀시트 열기 허용
```

```svelte
<!-- ✅ 올바른 패턴 -->
<div style={peekMode ? 'pointer-events:none' : ''}>
  <FloatingButton ... />
</div>

<!-- ❌ 금지: peek 상태에서 바텀시트 열림 허용 → 모달 왜곡 -->
```

### peek 상태에서 버튼 클릭 차단

```svelte
<!-- peek 중 장바구니·검색 직접 클릭 차단 (탭 → 확장 우선) -->
<button style={peekMode ? 'pointer-events:none' : ''} ...>
```

---

## 12. 퍼블리싱 완료 전 체크리스트

```
[ ] CSS 변수 사용 (--cs-* / --text-* / --radius-*) — 하드코딩 #hex 없음?
[ ] 흰 카드: border-radius: var(--radius-2xl) (50px)?
[ ] CTA 버튼: var(--cs-purple) + var(--radius-xl)?
[ ] 폼 입력: var(--cs-surface-gray) 배경, border 없음?
[ ] 텍스트 컬러: var(--cs-text) / var(--cs-text-dark) 사용?
[ ] 헤더 높이: var(--layout-header-h) (100px)?
[ ] 섹션 간격: gap: var(--layout-section-gap) (50px)?
[ ] 모든 인터랙티브 요소 최소 44×44px?
[ ] 이미지 alt 속성 존재?
[ ] Svelte 4 문법 없음? (on:event → onevent)
[ ] $state() 사용 (writable store 금지)?
[ ] GNB position: fixed? (sticky 금지)
[ ] GNB 래퍼 background: transparent?
[ ] Hero 높이: 모바일 720px / PC 936px?
[ ] FloatingBar peek 시 채팅 바텀시트 차단 (pointer-events:none)?
```

---

*uiux.md | CrazyShot UI/UX 디자인 시스템 정본 | Harness Flow v3.2*
*커서 래퍼: .cursor/rules/uiux.mdc | 클로드 참조: CLAUDE.md → 도메인 규칙 파일*
