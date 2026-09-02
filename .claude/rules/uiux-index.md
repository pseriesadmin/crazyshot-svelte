# uiux-index.md — UI/UX 빠른 참조 인덱스
# 전체 정본: .claude/rules-ref/cms-uiux.md · front-uiux.md

---

## ⛔ 환경 분리 (절대 원칙)

| 화면 | 정본 파일 | 로드 명령 |
|---|---|---|
| 사용자(USER) `/routes/` | `front-uiux.md` | `@.claude/rules-ref/front-uiux.md` |
| 관리자(CMS) `/routes/cms/` | `cms-uiux.md` | `@.claude/rules-ref/cms-uiux.md` |

> 두 파일의 토큰을 절대 혼용하지 않는다. 같은 색상값이라도 역할이 다르다.

---

## 컬러 핵심 (화면별 비교)

| 역할 | USER 화면 | CMS 화면 |
|---|---|---|
| **주 CTA 버튼** | `--cs-red-badge` `#FF3535` | `--cs-purple` `#3B2F8A` |
| **CTA hover** | `--cs-red` `#CF0000` | — |
| **보조 버튼** | `--cs-purple` `#3B2F8A` | — |
| **페이지 배경** | `--cs-lilac` `#ECEBF4` | `--cs-surface-gray` `#F6F6F6` |
| **기본 텍스트** | `--cs-text` `#100B32` | `--cs-text` `#100B32` |
| **보조 텍스트** | `--cs-text-dark` `#444444` | `--cs-text-mid` `#666666` |
| **보더 (주력)** | `--cs-purple` `#3B2F8A` | `--cs-lilac` `#ECEBF4` (1px) |
| **브랜드 오렌지** | `--cs-orange` `#FF4500` — 로고 전용, 버튼 금지 | — |

---

## 버튼 핵심

| 구분 | USER 화면 | CMS 화면 |
|---|---|---|
| **주 CTA 배경** | `--cs-red-badge` (#FF3535) | `--cs-purple` (#3B2F8A) |
| **버튼 반경** | `--radius-xl` **30px** | `--radius-md` **15px** |
| **높이 (PC)** | 50px | 36px |
| **높이 (Mobile)** | 44px | — (PC 전용) |
| **box-shadow** | ❌ 오프셋 그림자 금지 | ✅ 허용 (`4px 4px 0`) |

---

## 반경 (Border Radius) 핵심

| CSS 변수 | 값 | USER 용도 | CMS 용도 |
|---|---|---|---|
| `--radius-sm` | 8px | 폼 입력 | 카드·입력·검색 |
| `--radius-md` | 15px | 모바일 카드 | **CTA 버튼** |
| `--radius-lg` | 20px | PC 카드 | — |
| `--radius-xl` | 30px | **CTA 버튼** | Pill 버튼 |
| `--radius-full` | 99px | 배지·태그 | 배지·태그 |

---

## 🔴 CMS 카드 라운드값(대/중/소) 정책 ★★★ (2026-08-15 확정)

> **"cms 표준 디자인 시스템 지침 정책 중 라운드값 대 or 중 or 소 적용" 언급 시 → 재도출 없이 아래 표를 즉시 적용.**
> 대상: CMS 카드·패널·컨테이너류(`ProductDetailPanel`·`RentalDetailPanel`·`_FormatTab.svelte` 등 CMS 카드 149+곳과 동일 계열). USER 화면에는 적용하지 않음(우측 열은 CMS 전용).

| 등급 | 값 | 적용 CSS |
|---|---|---|
| **대(large)** | 30px | `var(--cms-radius-lg)` |
| **중(medium)** | 20px | `var(--radius-lg)` ⚠️ 아래 참고 |
| **소(small)** | 10px | `var(--cms-radius-sm)` |

> ⚠️ **"중" 값 20px은 기존 `--cms-radius-md`(15px)와 다른 값이다** — 이 정책이 신규 확정된 기준이며
> `--cms-radius-md`를 "중"으로 임의 매핑하지 말 것. CMS 네임스페이스에 20px 전용 토큰이 없어
> 제네릭 `--radius-lg`(20px)를 그대로 사용한다. `app.css`의 `--cms-radius-md` 실제 값(15px)은
> 기존 사용처(149+곳) 보호를 위해 이 정책만으로 변경하지 않는다 — 값 자체를 바꿔야 한다면
> 별도로 Stephen에게 먼저 확인 후 진행(요청범위 외 수정 절대 금지 원칙).

---

## 레이아웃 핵심

| 항목 | USER 화면 | CMS 화면 |
|---|---|---|
| 최대폭 (PC-MAX) | **1600px** → Stephen이 `PC반응형 최대` 명시 시 즉시 적용 | 1280px min (PC 전용) |
| 최대폭 (PC-MIN) | **1240px** → Stephen이 `PC반응형 최소` 명시 시 즉시 적용 | — |
| 섹션 패딩 PC | 80px(상하) 100px(좌우) | 20px~40px |
| 섹션 패딩 Mobile | 60px(상하) 20px(좌우) | — |
| GNB | position: fixed / transparent | position: fixed / `--cs-purple-dark` |

---

## 타이포 빠른 참조

```
PC:  --text-pc-htitle-25  (25px Bold)  제목
     --text-pc-title-18   (18px Bold)  소제목
     --text-pc-title-16   (16px Bold)  버튼·본문
     --text-pc-body-14    (14px Bold)  레이블
     --text-pc-script-12  (12px)       캡션

Mobile: --text-m-htitle-24B  (24px Black)  제목
        --text-m-title-18B   (18px Bold)   소제목
        --text-m-body-16B    (16px Bold)   버튼·본문
        --text-m-script-14B  (14px Bold)   레이블
        --text-m-script-12   (12px)        캡션
```

> ⚠️ **예외(2026-08-26 확정)** — `/account` 마이페이지 "섹션 타이틀"(대여 경험·관심가져봄·대여
> 정보·내정보)은 위 표의 일반 "소제목" 행(PC `--text-pc-title-18` / Mobile `--text-m-title-18B`)과
> 짝을 다르게 쓴다: **PC `--text-pc-title-18` ↔ Mobile `--text-m-title-21`**(18px이 아니라
> 21px). Stephen이 명시적으로 선택한 페어링이니 이 컨텍스트에서 `--text-m-title-18B`로 되돌리지
> 말 것. 세부 적용 위치·근거 → `@.claude/rules-ref/front-uiux.md §18`.

---

## 모바일 전용 공통 컴포넌트 (USER 화면 — ≤767px)

> 🔴 **AI 에이전트 필수:** Stephen이 아래 명칭 언급 시 → 이 표로 먼저 매핑 확인 후 작업

| Stephen 명칭 | 실제 컴포넌트 | 파일 위치 | 비고 |
|---|---|---|---|
| **`sub-gnb_navi`** | 모바일 탑바 pill (←·타이틀·☰) | 페이지 인라인 또는 `common/SubGnb.svelte` | ☰ 클릭 → 반드시 MobileMoreMenu |
| **`sub-gnb_navi_b`** | **PC 전용** 서브 GNB B타입 (Back Pill 단독 — 카테고리 아이콘 없음) | 페이지 인라인 `.sub-gnb-b` | **PC ≥641px 전용 · 모바일 미지원** · bg transparent · 아웃라인 없음 |
| **`sub-gnb_navi_c`** | **상품상세정보 전용 GNB** (Back Pill + 카테고리 아이콘 행 포함 — sub-gnb_navi_b와 별도 독립 스펙) | 페이지 인라인 `.sub-gnb-b` | `/products/[id]` 전용 · PC ≥641px · 카테고리 아이콘 행 필수 포함 |
| **`더보기 메뉴`** | `MobileMoreMenu` | `common/MobileMoreMenu.svelte` | ☰ 통해서만 열림 |
| **`FloatingBar`** | FAB 바 (장바구니·검색·채팅) | `common/FloatingBar.svelte` | 우하단 fixed |
| **`GNB`** | 전역 상단 네비 | `common/GNB.svelte` | PC·모바일 공용 |
| **`바텀탭`** | 모바일 바텀 탭바 | `common/BottomTabBar.svelte` | 스크롤 다운 가림·업 보임 의무 |

> 세부 규칙 → `@.claude/rules-ref/front-uiux.md §13`

> **🔴 `sub-gnb_navi_b 적용해` 입력 시 → `front-uiux.md §13-2` 스펙 즉시 적용. Back Pill 단독 구조(카테고리 아이콘 없음), PC(≥641px) 전용, 모바일 display:none 강제.**
>
> **🔴 `sub-gnb_navi_c 적용해` 또는 `상품상세정보 전용 GNB 적용해` 입력 시 → `front-uiux.md §13-3` 스펙 즉시 적용. Back Pill + 카테고리 아이콘 행 포함, `/products/[id]` 전용, PC(≥641px) 전용.**

> ⚠️ **GNB · SubGnb 구현·수정 시 스크롤 인터랙션 의무 적용**
> 스크롤 다운 → 가림 / 스크롤 업 → 보임 — 표준 패턴: `ui-mobile.md §GNB 스크롤 인터랙션`

---

## 공통 컴포넌트 빠른 참조 (CMS·USER 동일 사용)

| 컴포넌트 | 경로 | variant | 세부 규칙 |
|---|---|---|---|
| **SuggestPicker** | `$lib/components/common/SuggestPicker.svelte` | `category` / `brand` / `generic` | cms §12 · front §12 |
| 타입 | `$lib/types/suggest-picker.ts` | — | `SuggestPickerOption`, `SuggestPickerVariant` |
| **체크아이콘(CheckIcon) 버튼** | 인라인 SVG + CSS `currentColor` (컴포넌트 파일 없음) | — | 약관 동의·선택 체크 표준. 비선택: `.checkbox-btn-terms { color: --cs-purple-op10 }` / 선택: `.checked { color: --cs-purple }`. `<input type="checkbox">` 신규 작성 금지. path 데이터 + 패턴 → `front-uiux.md §17` |
| **ChevronIcon**(`arrow01`) | `$lib/components/common/ChevronIcon.svelte` | `direction`: `right`(기본)/`left`/`up`/`down` | props: `size`(기본 8) · `color`(기본 `#aaaaaa`) — 흰 카드 위 리스트 이동 화살표 표준 |
| **Arrow02Icon**(`arrow02`) | `$lib/components/common/Arrow02Icon.svelte` | 방향 고정(우측, 직선+화살촉형) | props: `size`(기본 16) · `color`(기본 `currentColor`) — 랜딩·상세이동 버튼용 심플 화살표 표준(2026-08-07, `AdminChatPanel.svelte` `.cs-detail-link` 최초 적용) |
| **close-red**(강조닫기버튼) | 클래스 `.close-btn`/`.rep-close-btn` (CMS 전용, 컴포넌트 파일 없음) | 배치: `flex`(margin-left:auto) 또는 `absolute`(카드 코너) | cms-uiux.md §0-10-A · 28×28px · `✕` 문자(SVG 금지) · hover 시 `--cs-red-badge` 강조 |

> ⛔ `<select>` 금지 — 드롭다운 목록 선택은 `SuggestPicker` 단독 표준
> ⛔ 구경로 `CmsSuggestPicker` / `cms-suggest-picker` 신규 작성 금지
> ⛔ 리스트·아코디언·페이지 이동 화살표(`M1 1L7 7L1 13` 패턴) 인라인 SVG 신규 작성 금지 — `ChevronIcon`(`arrow01`) 단독 표준
> ⛔ 랜딩·상세이동 버튼용 직선+화살촉형 화살표(`line`+`polyline`, viewBox `0 0 24 24`) 인라인 SVG 신규 작성 금지 — `Arrow02Icon`(`arrow02`) 단독 표준
> ⛔ CMS Detail Panel/카드 닫기 버튼에 SVG 아이콘 신규 작성 금지 — `close-red`(✕ 문자) 단독 표준

---

## 🔴 CmsPagination — CMS 표준 인덱스 UI ★★★

> **"표준 인덱스 UI 반영해" 언급 시 → 아래 컴포넌트를 즉시 적용. 인라인 구현 절대 금지.**

| 항목 | 내용 |
|---|---|
| **공식 명칭** | `CmsPagination` |
| **파일** | `$lib/components/cms/CmsPagination.svelte` |
| **적용 화면** | 목록이 있는 모든 CMS 화면 |
| **세부 규칙** | `cms-uiux.md §7-14` |

### Props

| Prop | 타입 | 설명 |
|---|---|---|
| `page` | `number` | 현재 페이지 (1-indexed) |
| `totalPages` | `number` | 전체 페이지 수 |
| `onpage` | `(p: number) => void` | 페이지 변경 콜백 |
| `variant` | `'top' \| 'bottom' \| 'inline'` | 배치 위치 (기본: `inline`) |
| `ariaLabel` | `string` | 접근성 레이블 (기본: `'페이지 탐색'`) |

### 표준 사용 패턴

```svelte
<script>
  import CmsPagination from '$lib/components/cms/CmsPagination.svelte'
</script>

<!-- 목록 상단 (toolbar 옆) -->
<CmsPagination
  page={currentPage}
  totalPages={totalPages}
  onpage={(p) => { currentPage = p }}
  variant="top"
  ariaLabel="목록 페이지 탐색"
/>

<!-- 목록 하단 -->
<CmsPagination
  page={currentPage}
  totalPages={totalPages}
  onpage={(p) => { currentPage = p }}
  variant="bottom"
/>
```

> ⛔ 페이지네이션 인라인 구현 금지 — `CmsPagination` 단독 표준

---

## 🔴 CmsKpiCard / CmsKpiGrid — CMS 대시보드 KPI 카드 표준 ★★★

> **"대시보드 KPI 카드 추가해" 언급 시 → 아래 컴포넌트를 즉시 적용. 인라인 `.kpi-card`/`.stat-card` 구현 절대 금지.**

| 항목 | 내용 |
|---|---|
| **공식 명칭** | `CmsKpiCard` / `CmsKpiGrid` |
| **파일** | `$lib/components/cms/CmsKpiCard.svelte` / `CmsKpiGrid.svelte` |
| **적용 화면** | 대시보드·통계 요약이 있는 모든 CMS 화면 (`/cms/promotion/*` 6개 화면 최초 적용) |
| **세부 규칙** | `cms-uiux.md §7-16` |

### Props (CmsKpiGrid)

| Prop | 타입 | 설명 |
|---|---|---|
| `cards` | `KpiCardProps[]` | 카드 배열 (label/value/unit/sub/delta/tone/size/progress) |
| `columns` | `3` | 그리드 열 수 — 전 화면 3열 통일 |

### 표준 사용 패턴

```svelte
<script>
  import CmsKpiGrid from '$lib/components/cms/CmsKpiGrid.svelte'
</script>

<CmsKpiGrid columns={3} cards={[
  { label: '총 발급 수', value: stats.total_issued.toLocaleString(), tone: 'primary' },
  { label: '전환율', value: stats.conversion_rate, unit: '%', tone: 'primary', progress: stats.conversion_rate },
]} />
```

> ⛔ 대시보드 KPI 카드 인라인 구현 금지 — `CmsKpiCard`/`CmsKpiGrid` 단독 표준
> ⛔ 차트·SVG 그래프 라이브러리 신규 도입 금지 — 액센트바+delta칩+CSS 비율바로 시각화 표현

---

## 🔴 CmsStatRing / CmsStatBars — 대시보드 히어로 시각화 표준 ★★★

> **"대시보드에 원형/바 그래프 반영해" 언급 시 → 아래 컴포넌트를 즉시 적용.**

| 항목 | 내용 |
|---|---|
| **공식 명칭** | `CmsStatRing` (원형 게이지) / `CmsStatBars` (가로 바그래프) |
| **파일** | `$lib/components/cms/CmsStatRing.svelte` / `CmsStatBars.svelte` |
| **적용 화면** | `/cms/promotion/*` 5개 대시보드 최초 적용 — 대시보드 최상단 히어로 섹션 |
| **세부 규칙** | `cms-uiux.md §7-17` |

### 표준 사용 패턴

```svelte
<div class="hero-stats">
  <div class="hero-ring">
    <CmsStatRing value={stats.conversion_rate} label="전환율" tone="primary" size={140} />
  </div>
  <div class="hero-bars">
    <CmsStatBars unit="건" items={[{ label: '총 발급', value: stats.total_issued, tone: 'primary' }]} />
  </div>
</div>
```

> ⛔ 차트 라이브러리 신규 도입 금지 — SVG stroke-dasharray(링) + CSS 폭 비율(바)만 사용
> ⛔ 바그래프 항목은 신규 쿼리 없이 기존 로드 데이터에서만 파생

---

## 🔴 ProductDPCard — 상품 DP 전역 공통 컴포넌트 ★★★

> **"ProductDPCard" 언급 시 → 무조건 아래 컴포넌트를 찾아 PC·Mobile 반응형에 반영할 것**

| 항목 | 내용 |
|---|---|
| **공식 명칭** | `ProductDPCard` |
| **파일** | `$lib/components/products/ProductDPCard.svelte` |
| **적용 화면** | 상품을 노출하는 모든 USER 화면 (`/products`, `/hype-pack`, `/help`, `/account` 등) |
| **소스 정본** | Figma node `2914-7618` + `front-uiux.md §14-4` |

### Props — DB 연동 매핑

| Prop | DB 소스 | 타입 |
|---|---|---|
| `name` | `products.name` | `string` (필수) |
| `imageUrl` | `products.image_urls[0]` | `string` (필수) |
| `category` | `products.category` | `ProductCategoryEnum` |
| `price24h` | `price_rules` WHERE `duration_type='24h'` | `number \| null` |
| `price12h` | `price_rules` WHERE `duration_type='12h'` | `number \| null` |
| `href` | `/products/{slug}` | `string` |
| `wished` | 찜 상태 | `boolean` |
| `onWishToggle` | 찜 콜백 | `(id) => void` (없으면 하트 미노출) |

### 반응형 크기 (컴포넌트 내장)

| | Mobile (기본) | PC (`≥768px`) |
|---|---|---|
| 카드 width | **174px** | **290px** |
| 이미지 | 174×174 · `border-radius: 18px` | 290×290 · `border-radius: 30px` |
| 가격 숫자 | 16px Black (`--text-m-body-16B`) · `--cs-text` | 18px Black (`--text-pc-title-18`) · `--cs-text` |
| 가격 레이블 | 14px Bold (`--text-m-script-14B`) · `--cs-text` | 14px Bold (`--text-pc-body-14`) · `--cs-text` |
| 상품명 | 14px Bold (`--text-m-script-14B`) · `--cs-text-mid` | 14px Bold (`--text-pc-body-14`) · `--cs-text-mid` |
| 카테고리 | `--text-m-script-12` + weight:700 · `--cs-text-light` | `--text-pc-script-12` + weight:700 · `--cs-text-light` |
| 텍스트 패딩 | `padding: var(--spacing-3) 0 0` · `gap: var(--spacing-3)` | `padding: var(--spacing-5) 0 0` · `gap: var(--spacing-5)` |
| 찜 버튼 | 22×22px · top:7px right:7px | 36×36px · top:12px right:12px |

> 세부 스펙 → `@.claude/rules-ref/front-uiux.md §14-4`

---

## 🔴 파일 업로드 표준 포맷 — 강제 자동 적용 ★★★

> **AI 에이전트 필수:** "이미지 업로드" 또는 "파일 등록" 언급 시 → 별도 지시 없이 아래 포맷·로직 즉시 적용

| 포맷 | MIME | 확장자 |
|---|---|---|
| PNG | `image/png` | `.png` |
| JPEG | `image/jpeg` | `.jpg` `.jpeg` |
| WebP | `image/webp` | `.webp` |
| HEIF | `image/heif` `image/heic` | `.heif` `.heic` |
| PDF | `application/pdf` | `.pdf` |

```html
<!-- input accept 표준값 (복사 즉시 사용) -->
accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
```

```
✅ 클라이언트 validateUploadFile() + 서버사이드 MIME 재검증 양쪽 모두 필수
오류 문구: "PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요."
세부 규칙 → @.claude/rules-ref/front-uiux.md §15
```

---

## 🔴 콤보 버튼 선택 그룹 — 수평 단일 선택 UI ★★★

> **AI 에이전트 필수:** "콤보 버튼", "옵션 선택", "수령 방법 선택" 등 수평 단일 선택 UI 언급 시 → 아래 스펙 즉시 적용

| 항목 | 값 |
|---|---|
| **레이아웃** | `display: flex; gap: 6px; overflow-x: auto` (가로 스크롤) |
| **버튼 반경** | `--radius-xl` (30px) |
| **비선택** | 배경 `#fff` · 보더 `#DCDCDC 1.5px` |
| **선택 활성** | 배경 `var(--cs-purple)` · 보더 `var(--cs-purple)` |
| **레이블** | 13px Bold · 비선택 `--cs-text` / 선택 `#fff` |
| **요금 보조** | 11px Medium · 비선택 `--cs-text-mid` / 선택 `rgba(255,255,255,0.8)` |
| **패딩** | `9px 16px` |

```
⛔ radio/select 금지 — 버튼 배열로만 구현
⛔ box-shadow 금지 (USER 화면 그림자 금지 원칙)
세부 규칙 → @.claude/rules-ref/front-uiux.md §16
```

---

## 🔴 모바일 반응형 화면 미세떨림 — 즉시 자동 수정 ★★★

> **"모바일 반응형 화면 미세떨림" 언급 시 → 원인 재추론 없이 즉시 아래 실행.**

```
증상: PC 브라우저 모바일 반응형(디바이스 툴바) 모드에서 스크롤 시 화면 전체가 미세하게 흔들림
원인: 페이지 최상위 컨테이너의 min-height: 100vh — 스크롤 시 브라우저 툴바 숨김/재출현으로
      100vh 값이 매번 재계산되는 잘 알려진 모바일 100vh 버그
수정: grep -rn "min-height:\s*100vh" src/routes src/lib/components 로 전역 재검색 →
      "페이지 최상위 루트" 셀렉터인 것만 100dvh로 교체(모달·카드 등 국소 100vh는 그대로 둠)
과거 회귀 이력(표만 믿지 말고 매번 전역 재검색할 것): account/profile(.page-root)·
  contract/complete·expired(.page)·cart(.cart-root) — 2026-08-26 최초 확정, 2026-09-02
  cart·account/profile 2곳 재회귀 발견·재수정
세부 절차·GATE C → @.claude/rules-ref/front-uiux.md §19
```

---

## 전체 정본 로드 조건

```
COLOR 토큰 전체 목록 필요                    → @.claude/rules-ref/cms-uiux.md 또는 front-uiux.md
컴포넌트 상세 패턴 (탭·모달·피커)           → @.claude/rules-ref/cms-uiux.md
모바일 공통 컴포넌트 명칭·규칙·인라인 목록  → @.claude/rules-ref/front-uiux.md §13
에디터·크레이지로그·SuggestPicker USER       → @.claude/rules-ref/front-uiux.md
공통 스페이싱·폰트 전체                     → @.claude/rules-ref/uiux.md
```
