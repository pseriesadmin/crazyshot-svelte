# 학습 기록: GNB·FloatingBar·Hero 공통 컴포넌트 UI/UX 확정
# 작성일: 2026-06-28 | Harness Flow v3.2

---

## 1. GNB 오버레이 포지셔닝 (CRITICAL 확정)

### 배경
피그마 시안에서 GNB nav pill이 히어로 배너 위에 오버레이되는 디자인.
기존 `position: sticky` 구현은 GNB가 레이아웃 공간을 점유 → 별도 상단 영역 발생 → 의도 위반.

### 확정 원칙
- **PC & 모바일 GNB 모두 `position: fixed` 사용** (sticky/static 금지)
- GNB 래퍼: `pointer-events: none` → 실제 nav 요소: `pointer-events: all`
- 모바일 GNB 래퍼: `background: transparent` (배경색 금지)
- `margin-top` 보정값 제거: fixed GNB는 레이아웃 흐름 미점유 → 보정 불필요

### 수정된 파일
- `src/lib/components/common/GNB.svelte`

### 재발 방지
GNB 수정 시 sticky·배경색 복원 금지. 피그마 시안 기준 "GNB가 콘텐츠 위에 오버레이"가 표준.

---

## 2. Hero 섹션 높이 비율 기준 (확정)

### 확정 수치
```
모바일 (.m-hero): 720px
PC (.d-hero):     936px  (= 720 × 1.3)
```

### 재발 방지
PC hero height 변경 시 "모바일 × 1.3" 공식 준수. 이전에 `margin-top: -100px` 보정이 있었으나
GNB fixed 전환으로 제거됨 — 재추가 금지.

---

## 3. FloatingBar 모바일 Peek & Expand 인터랙션 (확정)

### 아이콘 크기 기준
| 아이콘 | 모바일(< 640px) | PC(≥ 640px) |
|--------|----------------|-------------|
| 장바구니 | 55px | 40px |
| 검색 | 55px | 40px |
| 채팅 FAB | **70px** (변경 금지) | 40px |

채팅 FAB(70px)는 강조 의도로 크기 고정. FloatingButton.svelte 내부 fab-btn svg에서 관리.
FloatingBar.svelte에서 직접 제어하거나 임의 변경 금지.

### Peek 상태 CSS
```css
/* 모바일 전용 (< 640px) */
.fab-bar.peek {
  transform: translateX(calc(50% + 24px));  /* 우측 절반 노출 */
}
.fab-bar {
  transition: transform 0.42s cubic-bezier(0.34, 1.28, 0.64, 1);  /* 스프링 바운스 */
}
```

### 버블 애니메이션
```css
@keyframes fab-expand-bubble {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.12); }
  70%  { transform: scale(0.96); }
  100% { transform: scale(1); }
}
/* 지속시간: 0.32s ease-out */
```

### CSS transform + position:fixed 충돌 버그 (중요)

**현상**: peek 상태(transform 활성) 중 채팅 바텀시트 열기 시 모달이 뷰포트 기준이 아닌
transform 부모 기준으로 배치 → 화면 하단 아래로 왜곡.

**원인**: CSS transform은 새로운 stacking context를 생성. transform이 적용된 조상 내부의
`position: fixed` 자식은 뷰포트가 아닌 transform 요소 기준으로 배치됨.

**해결**: peek 상태에서 FloatingButton wrapper에 `pointer-events: none` 적용.
확장(transform 해제) 후에만 바텀시트 열기 허용.

```svelte
<!-- 채팅 FAB: peek 시 차단 -->
<div style={peekMode ? 'pointer-events:none' : ''}>
  <FloatingButton ... />
</div>

<!-- 장바구니·검색: peek 시 차단 (두 번 탭: 확장 → 기능 실행) -->
<button style={peekMode ? 'pointer-events:none' : ''} ...>
```

### Peek 상태 진입 조건
1. 페이지 최초 로드 (`peekMode = $state(true)`)
2. 라우트 변경 (`$effect(() => { page.url.pathname; peekMode = true })`)
3. 스크롤 발생 (`window.addEventListener('scroll', () => peekMode = true)`)

---

## 4. 관련 표준 문서 업데이트 내역
- `.claude/rules/uiux.md` 섹션 9·10·11 추가 (GNB·Hero·FloatingBar 원칙)
- 퍼블리싱 체크리스트에 GNB·Hero·FloatingBar 항목 추가

---

*학습 기록 | 2026-06-28 | GNB·Hero·FloatingBar 공통 컴포넌트*
