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

---

## 모바일 전용 공통 컴포넌트 (USER 화면 — ≤767px)

> 🔴 **AI 에이전트 필수:** Stephen이 아래 명칭 언급 시 → 이 표로 먼저 매핑 확인 후 작업

| Stephen 명칭 | 실제 컴포넌트 | 파일 위치 | 비고 |
|---|---|---|---|
| **`sub-gnb_navi`** | 모바일 탑바 pill (←·타이틀·☰) | 페이지 인라인 또는 `common/SubGnb.svelte` | ☰ 클릭 → 반드시 MobileMoreMenu |
| **`sub-gnb_navi_b`** | **PC 전용** 서브 GNB B타입 (Back Pill + 카테고리 아이콘 행) | 페이지 인라인 `.sub-gnb-b` | **PC ≥641px 전용 · 모바일 미지원** |
| **`더보기 메뉴`** | `MobileMoreMenu` | `common/MobileMoreMenu.svelte` | ☰ 통해서만 열림 |
| **`FloatingBar`** | FAB 바 (장바구니·검색·채팅) | `common/FloatingBar.svelte` | 우하단 fixed |
| **`GNB`** | 전역 상단 네비 | `common/GNB.svelte` | PC·모바일 공용 |
| **`바텀탭`** | 모바일 바텀 탭바 | `common/BottomTabBar.svelte` | 스크롤 다운 가림·업 보임 의무 |

> 세부 규칙 → `@.claude/rules-ref/front-uiux.md §13`

> **🔴 `sub-gnb_navi_b 적용해` 입력 시 → `front-uiux.md §13-2` 스펙 즉시 적용. Back Pill + 카테고리 아이콘 행 구조, PC(≥641px) 전용, 모바일 display:none 강제.**

> ⚠️ **GNB · SubGnb 구현·수정 시 스크롤 인터랙션 의무 적용**
> 스크롤 다운 → 가림 / 스크롤 업 → 보임 — 표준 패턴: `ui-mobile.md §GNB 스크롤 인터랙션`

---

## 공통 컴포넌트 빠른 참조 (CMS·USER 동일 사용)

| 컴포넌트 | 경로 | variant | 세부 규칙 |
|---|---|---|---|
| **SuggestPicker** | `$lib/components/common/SuggestPicker.svelte` | `category` / `brand` / `generic` | cms §12 · front §12 |
| 타입 | `$lib/types/suggest-picker.ts` | — | `SuggestPickerOption`, `SuggestPickerVariant` |

> ⛔ `<select>` 금지 — 드롭다운 목록 선택은 `SuggestPicker` 단독 표준
> ⛔ 구경로 `CmsSuggestPicker` / `cms-suggest-picker` 신규 작성 금지

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

## 전체 정본 로드 조건

```
COLOR 토큰 전체 목록 필요                    → @.claude/rules-ref/cms-uiux.md 또는 front-uiux.md
컴포넌트 상세 패턴 (탭·모달·피커)           → @.claude/rules-ref/cms-uiux.md
모바일 공통 컴포넌트 명칭·규칙·인라인 목록  → @.claude/rules-ref/front-uiux.md §13
에디터·크레이지로그·SuggestPicker USER       → @.claude/rules-ref/front-uiux.md
공통 스페이싱·폰트 전체                     → @.claude/rules-ref/uiux.md
```
