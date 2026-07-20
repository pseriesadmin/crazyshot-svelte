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
| 최대폭 | 1600px (신규 기준) | 1280px min (PC 전용) |
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

## 공통 컴포넌트 빠른 참조 (CMS·USER 동일 사용)

| 컴포넌트 | 경로 | variant | 세부 규칙 |
|---|---|---|---|
| **SuggestPicker** | `$lib/components/common/SuggestPicker.svelte` | `category` / `brand` / `generic` | cms §12 · front §12 |
| 타입 | `$lib/types/suggest-picker.ts` | — | `SuggestPickerOption`, `SuggestPickerVariant` |

> ⛔ `<select>` 금지 — 드롭다운 목록 선택은 `SuggestPicker` 단독 표준
> ⛔ 구경로 `CmsSuggestPicker` / `cms-suggest-picker` 신규 작성 금지

---

## 전체 정본 로드 조건

```
COLOR 토큰 전체 목록 필요              → @.claude/rules-ref/cms-uiux.md 또는 front-uiux.md
컴포넌트 상세 패턴 (탭·모달·피커)     → @.claude/rules-ref/cms-uiux.md
에디터·크레이지로그·SuggestPicker USER → @.claude/rules-ref/front-uiux.md
공통 스페이싱·폰트 전체               → @.claude/rules-ref/uiux.md
```
