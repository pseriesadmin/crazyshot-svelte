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

---

## NOW
- [ ] T9: AdminChatPanel + admin 레이아웃 | CRITICAL (관리자 전용 레이아웃 구축 후 진행)

## NEXT
- [ ] S1-M3: Payment Integration (TDD)

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

## BLOCKED
- T9: 관리자 전용 레이아웃 미구축 (별도 일정 확정 후 진행)

## BACKLOG
- S1-M3: Payment Integration
- S1-M4: Subscriptions
- S1-M5: Shipments
- 카카오 알림톡 fallback (PRD.1.7.7)
