# .claude/harness/TASK.md
생성일: 2026-06-26 (PRD.1.7 세션 동기화)
아젠다: PRD.1.7 대화형 렌탈예약 어시스턴트 시스템 V1.0

[CONTEXT BRIDGE]
plan_source: steady-dreaming-sprout.md | PRD.1.7 노드트리
핵심제약:
  - Supabase + Claude API 완전 내재화 (카카오 채팅 대체)
  - 4개 DB 테이블: chat_sessions / chat_messages / chat_intent_logs / cs_records
  - Claude AI: claude-haiku-4-5, max_tokens 512, 6종 Intent 분류
  - ANTHROPIC_API_KEY → $env/static/private 전용 (H-05)
  - 직접 INSERT/UPDATE/DELETE 금지 → RPC 경유 (H-01)
TDD도메인: 없음 (GSD 도메인 — UI + API 구현)
절대금지:
  - git 자율 실행
  - ANTHROPIC_API_KEY를 $env/static/public에 노출
  - 기존 마이그레이션 파일 수정
  - Svelte 4 문법 (on:event → onevent)
frozen_files (Claude Code 전용 — Cursor 수정 금지):
  - src/lib/services/supabase.ts  ← baseline: fed4fdb (createBrowserClient 패턴)
  - src/hooks.server.ts
  - src/lib/env/supabasePublic.ts
  - src/lib/stores/auth.ts
  - src/routes/api/**/*
  - supabase/migrations/**
  - $env import가 있는 모든 파일
auth_baseline: fed4fdb — createBrowserClient 패턴 (절대 싱글톤 createClient로 대체 금지)

---

## NOW — M1 products UUID 마이그레이션 + 옵션상품 DB 연동 (2026-07-05)

[CONTEXT BRIDGE — products UUID migration]
plan_source: 세션 내 설계 (Option B 근본 해결)
핵심제약:
  - stage(ezyvffjvuwmtuhpxdjrw) 검증 완료 → production(vnbpmvxruyciuuaermyh) 적용 대기
  - 기존 마이그레이션 파일 수정 금지 (신규 61/62 파일로 해결)
  - 20260703000049_49_product_option_links.sql → 구파일, 대체 완료 (사용 금지)
절대금지:
  - 기존 마이그레이션 파일 수정
  - production DB에 미검증 마이그레이션 직접 적용

- [ ] T-61a: Migration 61 stage 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - products.id bigint→UUID (8행 보존)
  - products 누락 컬럼 추가 (slug/brand/is_active/image_urls/specifications/stock_quantity/deleted_at)
  - price_rules 테이블 생성 + RLS + 트리거
  - assets/order_items/rental_reservations product_id bigint→UUID
  - RPC 함수 업데이트: atomic_reserve_asset, batch_atomic_reserve (bigint→UUID)
  - ✅ stage 검증: products.id=uuid, price_rules=exists, product_option_links=exists, 8행 보존

- [ ] T-62a: Migration 62 stage 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - product_option_links 테이블 + RLS + 트리거
  - upsert_product_option_links / get_product_option_links RPC

- [x] T-61b: Migration 61 production 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - products.id bigint→UUID (8행 보존, assets 9행 매핑 포함)
  - price_rules 테이블 + RLS + 트리거
  - assets/order_items/rental_reservations product_id bigint→UUID
  - RPC 업데이트: atomic_reserve_asset, batch_atomic_reserve
- [x] T-62b: Migration 62 production 적용 | CRITICAL | ✅ 완료 (2026-07-05)
  - product_option_links 테이블 + RLS + 트리거
  - upsert_product_option_links / get_product_option_links RPC
- [x] T-63: Migration 63 stage+production 적용 | CRITICAL | ✅ 완료 (2026-07-06)
  - product_option_links.min_select_required BOOLEAN 컬럼 추가
  - upsert_product_option_links RPC 업데이트 (min_select_required 포함)
  - get_product_option_links RPC 업데이트 (min_select_required 반환)
  - ProductOptionLinkRow 타입 업데이트 (database.ts)
  - edit/+page.svelte linkToSelected: link.min_select_required 실제값 사용
- [x] T-UI: CMS 옵션상품 UI 검증 | BOUNDARY | ✅ 완료 (2026-07-06)
  - /cms/products/new 렌더링 정상
  - 검색 모달: Canon 검색 → Canon EOS R5 결과 + 상세정보 더보기 링크 확인
  - 추가 후 선택 카드: 썸네일+상품명+가격+재고 정상
  - 일괄적용 + 개별 체크박스 3종 (필수선택/최소1개선택필수/배송대여불가) 정상

## NOW — CMS 프로모션 Phase 3 (2026-07-04)

[CONTEXT BRIDGE — Phase 3]
plan_source: cms-transient-cupcake.md | Phase 3 섹션
핵심제약:
  - 마이그레이션 번호: #56(marketing_rules) / #57(analytics_rpc) — #55까지 사용됨
  - stage(ezyvffjvuwmtuhpxdjrw) 먼저 검증 → production(vnbpmvxruyciuuaermyh) 적용
  - --text-pc-* 토큰만 (--text-m-* 금지) / --cms-radius-lg/md/sm 3단계
  - 차트·SVG 아이콘·외부 시각화 라이브러리 절대 금지
  - 구현 순서: T1(DB) → T2(GNB) → T3(룰엔진) → T4(Analytics)
절대금지:
  - 기존 마이그레이션 파일 수정 (신규 ADD만)
  - production DB에 미검증 마이그레이션 직접 적용
  - --text-m-* 모바일 폰트 토큰 CMS 본문 사용
  - SVG 아이콘 / 차트 라이브러리 / 외부 시각화

- [x] T1: DB 마이그레이션 Phase 3 | CRITICAL | SQL 파일 3개 생성 완료 — Stephen이 stage/production 적용 필요
  - ✅ supabase/migrations/20260704000056_56_marketing_rules.sql (생성 완료)
    - marketing_rules 테이블 (trigger_type CHECK / action_type CHECK / RLS 4정책)
    - marketing_rule_logs 테이블 (idx 3개 / RLS 2정책)
  - ✅ supabase/migrations/20260704000057_57_analytics_rpc_functions.sql (생성 완료)
    - get_promotion_analytics() → JSONB {total_revenue, conversion_rate, ctr, active_campaigns, top_coupons[], segment_performance[]}
    - rental_reservations / user_behavior_events COALESCE 방어 처리
  - ✅ supabase/migrations/20260704000058_58_rule_engine_executor.sql (생성 완료)
    - execute_marketing_rules() — 5개 trigger_type 대상 조회 + action 발동 + 에러 격리
    - pg_cron 등록: '0 * * * *' execute_marketing_rules_hourly
  - ✅ stage(ezyvffjvuwmtuhpxdjrw) 적용 완료 — #56/#57/#58 함수 + pg_cron 스케줄
  - ✅ production(vnbpmvxruyciuuaermyh) 적용 완료 — #56/#57/#58 함수 + pg_cron 스케줄

- [x] T2: GNB 서브메뉴 확장 | BOUNDARY | 완료 — 룰엔진/분석 탭 추가됨

- [x] T3: Rule Engine CMS 페이지 | BOUNDARY | 완료 — 3탭, npm run check 오류 0건
  - src/routes/cms/promotion/rules/+page.server.ts
  - src/routes/cms/promotion/rules/+page.svelte

- [x] T4: Analytics Dashboard CMS 페이지 | BOUNDARY | 완료기준: /cms/promotion/analytics 진입 시 4탭 렌더, get_promotion_analytics RPC 데이터 표시 | 예상: 60분
  - src/routes/cms/promotion/analytics/+page.server.ts
    - load: get_promotion_analytics() RPC + user_behavior_events 배너 CTR 집계
  - src/routes/cms/promotion/analytics/+page.svelte
    - 탭1: 전체 KPI (매출/전환율/CTR/재구매율/LTV/CAC) — 텍스트+숫자 카드만
    - 탭2: 쿠폰 성과 (top_coupons: 쿠폰별 ROAS / 사용수 / 할인액)
    - 탭3: 배너 성과 (슬롯별 노출수 / CTR — user_behavior_events 집계)
    - 탭4: 세그먼트 성과 (segment_performance: 세그먼트별 구매전환율)
    - 차트·SVG 아이콘 금지, 텍스트 기반 KPI 카드 패턴만

- [x] T5: Rule Engine 자동 발동 (pg_cron) | CRITICAL | SQL 파일 #58에 포함 완료 — Stephen이 stage/production 적용 필요

## NEXT
- [x] S1-M3 T5: 결제 UI | GSD | 결제 결과 페이지 구현 완료
  - src/routes/payment/success/+page.server.ts — Toss confirm API + confirm_payment_and_update_reservation RPC
  - src/routes/payment/success/+page.svelte — Figma 2361:6425 1:1 구현 (비대칭 radius 카드)
  - src/routes/payment/fail/+page.server.ts — cancel_payment_and_release_hold RPC + 파라미터 파싱
  - src/routes/payment/fail/+page.svelte — Figma 2361:6407 1:1 구현
  - svelte-check: 결제 관련 에러 0건 (기존 pre-existing 2건 유지)

## S1-M3 NOW
- [x] S1-M3 T1: DB 마이그레이션 (#59) | CRITICAL | payment_transactions / deposit_holds / raw_webhook_logs 테이블 + RLS + idempotency UNIQUE 제약 — stage + production 적용 완료
- [x] S1-M3 T2: TDD RED — 테스트 케이스 작성 | TDD | src/__tests__/services/payment.test.ts 생성 — Happy(정상결제·멱등성·보증금) / Edge(calc_at30초·중복order_id·amount=0) / Error(결제실패→cancel_rpc·처리순서·보안문서화)
- [x] S1-M3 T3: TDD GREEN — 구현 | TDD | src/routes/api/payment/confirm/+server.ts + src/routes/api/webhooks/toss/+server.ts 생성 — svelte-check 결제 에러 0건
- [x] S1-M3 T4: TDD REFACTOR | TDD | any 타입 없음 확인 / console.log 없음 / 타입 헬퍼 명확화(rpcCall·tableInsert·tableSelect) / svelte-check 결제 에러 0건 유지

## DONE
- S0: 환경 설정 + DB 스키마 + RPC 함수 9개
- S1-M1: Products 모듈 (리스트 + 상세)
- S1-M2: Reservation Flow (TDD RED/GREEN/REFACTOR)
- S1-M2.5: Cart Dev Route (장바구니 UI 개발) — 10개 컴포넌트/파일
- PRD.1.7 T1: DB Migration (chat_sessions / chat_messages / chat_intent_logs / cs_records + RLS + Realtime)
- PRD.1.7 T2: 타입 정의 (src/lib/types/chat.ts)
- PRD.1.7 T3: 서비스 레이어 (src/lib/services/chatService.ts)
- PRD.1.7 T4: 스토어 (src/lib/stores/chat.svelte.ts — class 패턴)
- PRD.1.7 T5: API 라우트 5개 (session/message[AI분류]/sessions/action-card/close)
- PRD.1.7 T6: UI 컴포넌트 5개 (ChatHeader / MessageBubble / ActionCard / MessageList / ChatInput)
- PRD.1.7 T7: 컨테이너 3개 (ChatWindow / ChatBottomSheet / FloatingChatButton)
- PRD.1.7 T8: +layout.svelte fab-bar 삽입
- PRD.1.7 T8b: fab-bar 충돌 해결 — checkout/products[id] 직접 삽입 (장바구니→검색→채팅)
- PRD.1.7 T10: 고객 채팅 라우트 `/chat` 구축 (풀스크린 ChatWindow + 딥링크 파라미터)
- PRD.1.7 T11: DB 마이그레이션 적용 (4테이블 RLS), API/Realtime 코드 검증 완료 (AI키·Realtime활성화는 Stephen 액션)
- CMS 프로모션 Phase 1 완료 (T1 GNB/T2 DB #45~#51/T3 홍보/T4 쿠폰/T5 포인트/T6 홈배너)
- CMS 프로모션 Phase 2 완료 (DB #52~#55/behaviorTracker/세그먼트 페이지/API)

## BLOCKED
- T9: AdminChatPanel + admin 레이아웃 미구축 (별도 일정 확정 후 진행)

## BACKLOG
- S1-M4: Subscriptions
- S1-M5: Shipments
- 카카오 알림톡 fallback (PRD.1.7.7)
