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
