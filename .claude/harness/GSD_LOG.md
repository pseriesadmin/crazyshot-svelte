# GSD_LOG.md — 크레이지샷 실행 이력
# 형식: [YYYY-MM-DD HH:MM] 타입 | 태스크명 | 파일 | 소요 | 결과

[2026-05-29 14:30] SETUP | S0-2 Database Schema | migrations 001-005 | 15m | ✅ SUCCESS
  - 001_initial_schema: 10 테이블 생성 (DDL)
  - 002_rls_policies: 24 RLS 정책 (모든 테이블)
  - 003_rpc_functions: 9 RPC 함수 (atomic ops, payment, subscription)
  - 004_rpc_search_path_fix: Security advisor 경고 수정
  - 005_seed_subscription_plans: 3 subscription plans 시드
  - Supabase TypeScript types 생성 → src/lib/types/database.ts

[2026-05-29 15:00] SETUP | S0-3 Supabase Client | src/lib/services, src/lib/stores | 20m | ✅ SUCCESS
  - Supabase client singleton (src/lib/services/supabase.ts) with RPC wrappers
  - Auth state store (src/lib/stores/auth.ts) with performSignUp/In/Out
  - Auth state auto-initialization in +layout.svelte
  - ESLint v10 migration (.eslintrc.cjs → eslint.config.js)
  - All H-01~H-06 harness rules compliance verified
  - npm run harness:check ✅ (ESLint + TypeScript passing)

[2026-05-29 15:30] GSD | S1-M1 Products Module | src/routes/products/ | 15m | ✅ SUCCESS
  - Product listing page (src/routes/products/+page.svelte) with search/category filter
  - Product detail page (src/routes/products/[id]/+page.svelte) with reservation form
  - Database migration 006: 8 products, 9 assets seeded (cameras, lenses, audio, lighting, tripod)
  - Asset availability counter & condition badges
  - RPC-based reservation (H-01 compliant: no direct INSERT)
  - Responsive grid layout with pricing display
  - All H-01~H-06 harness rules verified ✅

[2026-05-29 16:00] TDD | S1-M2 Reservation Flow | src/__tests__/, src/lib/services/ | 25m | ✅ RED/GREEN PHASE
  - Reservation helper functions (src/lib/services/reservationHelper.ts)
  - 27 passing unit tests (RED/GREEN phase complete)
  - Date validation: Format, range, overlap detection
  - Rental period classification (daily 1-7d, weekly 8-30d, monthly 31+d)
  - State machine: Valid transitions, terminal states
  - Input validation: Product ID, dates, comprehensive error messages
  - Price calculation: Daily/weekly/monthly with flexible discounts
  - Integration test framework (src/__tests__/services/reservation.test.ts)
  - All H-01~H-06 harness rules verified ✅

[2026-05-29 17:30] REFACTOR | S1-M2 Reservation Flow Integration | src/routes/products/[id]/+page.svelte | 45m | ⏳ IN PROGRESS
  - Integrated reservation helper functions into product detail page
  - Added real-time price breakdown display with rental period classification
  - Implemented validation using validateReservationInput() helper
  - Price display shows: rental days, subtotal, discount (if applicable), final amount
  - Button state management: disabled until valid dates selected
  - Enhanced date input with min/max constraints
  - Fixed linting errors (unused imports in product detail page)
  - Created vitest setup for test user authentication (src/vitest.setup.ts)
  - 🔴 BLOCKED: Supabase Realtime WebSocket issue in SSR environment
  - Node.js 20 requires ws package as transport, but not provided during Vite SSR
  - Unable to test UI changes due to 500 Internal Server Error on dev server
  - Attempted fixes: hooks.server.ts polyfill, conditional initialization - all failed
  - Recommend: Implement lazy client initialization or provide ws transport at startup

[2026-06-28] FIX | Cursor AI 손상 복구 + CMS 초대링크 완성 | 20+ 파일 | ✅ SUCCESS (커밋 fed4fdb, 7f3dd76)
  - [복구] supabase.ts: createBrowserClient 복원 (browser 분기 패턴)
  - [복구] API 라우트 5개: PUBLIC_SUPABASE_URL 원복 (chat/session·message·admin-reply·admin-attachment·sessions)
  - [복구] auth.ts onAuthStateChange cleanup 복원
  - [마이그레이션] Migration 49: handle_new_user anon 500 수정 → Stage DB 적용 완료 / Production 미적용
    · 파일: supabase/migrations/20260628010049_49_fix_handle_new_user_anon.sql
    · 주의: Stage 적용 버전 20260627151934 ≠ 파일 타임스탬프 20260628010049 (MCP 먼저 적용)
  - [CMS] 초대링크 흐름 완성: accounts(초대링크 정보 화면) + login(비밀번호 설정 폼 + setPassword 액션)
  - [UI] CMS 영역 채팅 FAB 제거 (/cms/* 경로 조건 추가)
  - [UI] FAB z-index 200 상향 → checkout 하단바 가림 해소
  - [UI] 계정목록 컬럼 퍼센트 기반 균등 배분 (col-email auto → 22%)
  - [학습] .claude/harness/learnings/migration_schema_2026-06-28.md 생성
  - [학습] .claude/harness/SUPABASE_DB.md 현행화 (마이그레이션 현황 + 이슈 이력 추가)

[2026-06-27] INCIDENT | Cursor AI 손상 — supabase.ts createBrowserClient 교체 | src/lib/services/supabase.ts | ❌ ROLLBACK
  - 커밋 89e427b: Cursor가 createBrowserClient → createClient 싱글톤으로 변경
  - 증상: 채팅 세션 401 Unauthorized (쿠키 세션 공유 단절)
  - 원인: frozen boundary 미설정, Cursor가 설계 맥락 없이 "통일" 판단
  - 조치: fed4fdb 원복 (createBrowserClient 복원 + API 라우트 PUBLIC_SUPABASE_URL 원복)
  - 학습: learnings/misidentifications.md HOOK-7 기록

[2026-06-28] FIX | 혼성 AI 협업 정합 — SSOT 통합 + Frozen Boundary 설정 | .claude/harness/, .cursor/ | ✅ SUCCESS
  - AI_COLLAB_PROTOCOL.md 신규 (A~F 원칙 + frozen 목록 + 커밋 체크리스트)
  - HANDOFF.md 신규 (5필드 초기화)
  - CURSOR_START.md 경로 교체 (.cursor/harness/* → .claude/harness/*)
  - crazyshot-system.mdc SSOT 통합 ("독립 운영" 제거)
  - PORTABILITY.md crazyshot 예외 절 추가
  - domain-frozen-boundary.mdc 신규 (Cursor frozen 파일 접근 차단)
  - ROLLBACK_LOG.md 3건 소급 기록
  - misidentifications.md 1건 기록
  - TASK.md CONTEXT BRIDGE frozen 목록 + baseline 추가

[2026-07-14] AUDIT | CMS 전역 DB 고아·로직 이상 정밀 진단 | Production DB (vnbpmvxruyciuuaermyh) | ✅ 완료
  - 7개 영역 전수 검사 (상품/예약/주문/프로모션/코드/채팅/계정)
  - 고아 데이터: product_code_sequences TRI·LIG 2건 삭제 (production)
  - 기능 이상 3종 확인 (콘텐츠 미완성, 구조 이상 아님):
    · 상품 8건 slug = NULL (상품 상세 URL 불가)
    · 상품 8건 price_rules 없음 (예약·결제 불가)
    · 자산 9건 asset_code = NULL (QR 코드 연동 불가)
  - 아키텍처 주의: products.category(소문자) ↔ product_category_codes.code(대문자) 별개 운영
  - 스키마 주의: payment_transactions.order_id TEXT — Toss order key 저장 설계, 실데이터 0건
  - 정상 영역: 예약/주문/프로모션/채팅(anon 23건 정상)/계정 고아 0건

  Migration 109~116 (CMS 성능 + 통합 검색) Stage→Production 적용 완료:
  - 109: rental_reservations.product_id 인덱스
  - 110: user_profiles trgm 인덱스 + created_at 정렬
  - 111: rental_reservations 복합 인덱스 (created_at / status_dates / user_created)
  - 112: chat_messages·products 복합 인덱스
  - 113: products search_vector (FTS) + trgm 인덱스 + 백필
  - 114: search_logs·product_search_stats 테이블 생성
  - 115: search_products RPC (3단계 검색 + AI 학습 루프)
  - 116: mv_active_products_by_category·mv_top_search_terms MV + pg_cron 3개
  수정 파일:
  - src/lib/services/searchService.ts (신규): image_url 필드명 수정 (thumbnail_url→image_url)
  - src/routes/api/search/products/+server.ts (신규): 통합 검색 API 엔드포인트
  BACKLOG:
  - supabase gen types 재생성 (searchService.ts (supabase.rpc as any) 해소)
  - migrations 113~116 ROLLBACK 주석 추가
  - Stephen git commit/push + Vercel 배포

[2026-07-14] BOUNDARY | Crazylog 작성 화면 퍼블리싱 | src/routes/crazylog/ | ✅ GATE E PASS
  - [slug]/+page.svelte: Mobile UserInfoCard(m-user-card) + ContentOptions(m-content-options) 추가
    · State 초기값 수정: memberPublic/cafeScrap/aiSave = true (Figma defaultChecked)
    · CSS 토큰: --cs-purple→red-badge 그라디언트 / --cs-purple-op10 / --cs-purple-light / --radius-lg / --radius-full
    · 터치 타겟: m-check-row min-height 44px / plus 아이콘 a 태그 44px
    · TODO 주석 제거 → BACKLOG(BL-CRAZYLOG-SUBMIT) 이관
  - +page.svelte: 헤더 카드 plus SVG → <a href="/crazylog/new" aria-label="로그 작성"> 래핑 (3개 섹션)

[2026-06-26] GSD | PRD.1.7 T5~T8 | src/routes/api/chat/, src/lib/components/chat/, src/routes/+layout.svelte | ✅ SUCCESS
  - T5: API 라우트 5개 (session / message[Claude AI 의도분류] / sessions / action-card / close)
    · ANTHROPIC_API_KEY → $env/static/private (H-05 준수)
    · const db = locals.supabase as any (chat 테이블 미생성 타입 우회)
    · claude-haiku-4-5, confidence < 0.6 → CS_ESCALATE 강제
  - T6: UI 컴포넌트 5개 (ChatHeader / MessageBubble / ActionCard / MessageList / ChatInput)
    · Svelte 5 Runes ($props, $state, $derived, $effect)
    · CSS 변수 전용 (--cs-purple, --cs-lilac, --cs-points 등)
  - T7: 컨테이너 3개 (ChatWindow / ChatBottomSheet / FloatingChatButton)
    · FloatingChatButton: fab-btn 패턴 (dev/cart 동일), 커스텀 SVG 아이콘
    · ChatBottomSheet: mobile bottom-up / PC bottom-right 반응형
  - T8: +layout.svelte fab-bar 삽입
    · SSR 오류 수정: chat.ts → chat.svelte.ts (class 패턴 $state 필드)
    · $authState.user 조건부 렌더링 (비로그인 시 숨김)
    · FloatingChatButton SVG Stephen 확정 디자인 적용
