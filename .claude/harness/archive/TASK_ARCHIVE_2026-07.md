# TASK.md 아카이브 — 2026-07
# 명시적으로 'DONE'/'QA 검수 완료'로 라벨링됐던 항목만 보관 — 헤더 텍스트로 완료 여부를 추측 판정하지 않음

## DONE — Front 설정 UI 컴포넌트 정교 재개발 + /products ProductDPCard 교체 (2026-07-21) ✅ 완료

plan_source: products-jaunty-lollipop.md (v3)
핵심제약:
  - 레퍼런스: ProductCategoryModal / ProductHeroModal / ProductGridModal 3종 기준
  - AdminModalShell·AdminEditButton 픽셀 수준 정합
  - 요청 범위 외 수정 없음

신규/수정 파일:
  - src/lib/components/common/admin/AdminModalShell.svelte ← CSS 전면 재작성 (레퍼런스 정합)
  - src/lib/components/common/admin/AdminEditButton.svelte ← CSS 재작성 (레퍼런스 정합)
  - src/routes/products/+page.svelte ← 구 flat/card 카드 → ProductDPCard 교체 + 잔존 CSS 제거

- [x] UI-SHELL: AdminModalShell.svelte 레퍼런스 정합 재작성 | ROUTINE | ✅ 완료 (2026-07-21)
  - 헤더: background: var(--cs-dark) (다크 네이비) 적용
  - 타이틀: color: var(--cs-white) + font: var(--text-pc-title-16)
  - 닫기 버튼: rgba(255,255,255,0.7) / 18px / padding 4px 8px / min-height 32px / hover → var(--cs-white)
  - 헤더 border-bottom 제거 (레퍼런스 없음)
  - 패널: border-radius var(--radius-2xl) 0 0 var(--radius-2xl) 추가
  - 패널: box-shadow -4px 0 24px rgba(16,11,50,0.15) (0.12→0.15)
  - 바디: gap 20px 추가

- [x] UI-BTN: AdminEditButton.svelte 레퍼런스 정합 재작성 | ROUTINE | ✅ 완료 (2026-07-21)
  - border-radius: var(--radius-sm) (8px) — xl(30px)에서 수정
  - min-height: 32px — 44px에서 수정
  - padding: 6px 12px
  - font-weight: 700 (600→700)
  - hover: background rgba(16,11,50,0.92) (opacity 방식에서 교체)
  - empty-state: border-radius var(--radius-xl) 유지 (이 variant만 xl)

- [x] UI-GRID: /products 상품 그리드 → ProductDPCard 표준 컴포넌트 교체 | BOUNDARY | ✅ 완료 (2026-07-21)
  - 구 d-prod-flat (idx<4) + d-prod-card (idx≥4) 인라인 렌더 → ProductDPCard 단일 컴포넌트 통일
  - price24h=base_price_daily / price12h=Math.round(base_price_daily*0.7) / category / href 연동
  - 잔존 CSS 제거: .d-prod-flat / .d-flat-img-box / .d-flat-img / .d-flat-info / .d-flat-price / .d-flat-name / .d-prod-card / .d-prod-bg / .d-prod-img-box / .d-prod-info / .d-prod-price / .d-prod-name (11선택자)
  - .d-prod-grid: justify-content flex-start / column-gap 24px (ProductDPCard 290px 고정폭 정렬)
  - svelte-check: 신규 에러 0건

---


## DONE — T9 AdminChatPanel (2026-07-09 완료) ✅

- [x] T9-1: /cms/chat 라우트 — +page.server.ts + +page.svelte 기완성 확인
- [x] T9-2: AdminChatPanel.svelte — 3탭(open/pending/closed) + Realtime + 메시지 전송 + 닫기 기완성
- [x] T9-3: CMS GNB 채팅 서브메뉴 — layout.svelte 라인 78에 이미 연결됨 ('/cms/chat')
- [x] TYPE ERRORS: svelte-check 8→0 수정 완료 (similarNameSuggest, codes +page.server.ts, products/new +page.svelte)

---


