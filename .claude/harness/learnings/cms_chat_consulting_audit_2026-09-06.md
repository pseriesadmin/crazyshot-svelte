# CMS 상담/채팅(A3) 전역 정밀 재검증 — 2026-09-06

## 요약 (3줄)
- 긴급배지(is_urgent) 4중 전제조건 중 ①②③④ 전부 코드로 확인 완료 — 문서 서술과 정확히 일치.
- §17("관리자 전용" 알림을 chat_messages에 넣지 말 것) 위반 없음, Migration 425 해소 재확인.
- **CRITICAL급 신규발견**: `/cms/chat` 툴바에 "대기 전환" 버튼이 실제로 살아있어, 관리자가
  진행중(open) 세션을 수동으로 대기(pending)로 되돌릴 수 있다 — 3개 정본 문서(chat.md·
  rental-lifecycle.md·service-operations.md §7)가 명시적으로 "그런 액션은 없다"고 서술한
  것과 정면으로 모순되며, 긴급배지 전제조건 ①(open 탭 노출)을 관리자가 직접 무력화할 수 있다.

---

## 4중 전제조건 검증 결과

### ① §7 open 승격 (대기/종료 → 진행중 자동 복귀)
`src/routes/api/chat/message/+server.ts` 130-135행: 사용자 메시지 도착 시
`if (chatSession.status !== 'open' && admin) { UPDATE status='open' }` — intent 분류
결과와 무관하게 무조건 실행됨. 문서 서술과 일치.

`admin-reply/+server.ts` 57-72행, `admin-attachment/+server.ts` 55-65행: 관리자 발신도
`closed|pending → open` 승격 + `admin_id` 배정. 문서 서술과 일치.

**검증 결과: 정상.**

### ② §11 공유 RPC 경유 (find_or_create_general_chat_session)
`find_or_create_general_chat_session` 호출 지점 11곳 전수 확인
(cancelReservationWithRefund.ts·cms/reservation/+page.server.ts·contracts/[token]/sign·
checkout/late-fee pay-mock·cms/chat/identity-request/direct-send·
cms/reservations/[id]/payment·cms/contracts/[id]/send-chat 등) — 전부 "session_id를
모르고 user_id/reservation_id만 아는" 상황에서만 이 RPC를 쓰고 있음.

`cms/chat/coupon-gift/direct-send`·`cms/chat/identity-request/direct-send`는 이미
관리자가 그 세션을 보고 있는 상태에서 session_id를 직접 전달받으므로 `.eq('id',
sessionId).single()` 직접조회가 맞는 패턴(RPC 재탐색 불필요) — 코드 주석에도 이 근거가
명시돼 있고, §11이 경계하는 "세션을 잘못 찾거나 새로 만드는" 위험 클래스가 아님.

**검증 결과: §11 위반(신규 자체 세션조회 재구현) 없음.**

### ③ CS_ESCALATE 인텐트로그 (민감 캔드매칭 카테고리)
`api/chat/message/+server.ts` 32행 `SENSITIVE_CANNED_CATEGORIES = new Set(['damage',
'cs'])`. `src/lib/constants/cannedResponseCategories.ts`의 전체 카테고리 6종
(return/payment/reservation/damage/general/cs) 중 damage·cs만 민감 지정 — 문서 서술과
정확히 일치. 캔드매칭 성공 시(212-225행) 해당 카테고리면 자동응답과 별개로
`chat_intent_logs`에 `intent='CS_ESCALATE'` INSERT 확인.

**검증 결과: 정상.**

### ④ admin_id 기반 응답판정
`api/chat/sessions/+server.ts` 96-152행: `needsUrgentCheck`가
`last.sender_type !== 'admin' OR !adminIdBySession[id]`로 계산됨 — 마지막 메시지가
admin이어도 그 세션에 `admin_id`가 배정된 적 없으면(캔드매칭 자동응답만 있었던 경우)
여전히 긴급판정 대상에 포함. 문서 서술과 정확히 일치.

단, `coupon-gift/direct-send`·`identity-request/direct-send`는 closed/pending→open
승격 시 `admin_id`를 배정하지 않는다(admin-reply/admin-attachment와 달리). 이는 코드
주석(`sessions/+server.ts` 100-102행: "admin_id는 실제 관리자가 응답할 때(admin-reply/
admin-attachment)만 채워짐")과 설계상 일관된 의도적 선택으로 판단됨 — 쿠폰 발급·본인증명
요청은 "CS 응대"가 아니라 별개의 관리자 액션이라는 구분. 버그로 보지 않음(부가발견으로만 기록).

**검증 결과: 정상.**

---

## §17 검증 결과 ("관리자 전용" 알림을 chat_messages에 넣지 말 것)

Migration 425(`20260902070000_425_submit_cs_post_remove_leaking_chat_card.sql`) 확인 —
`submit_cs_post`가 Migration 157 원본(순수 INSERT, chat_messages 무관)으로 완전히
복원됐음을 SQL 직접 대조로 확인. 대체 경로(`/api/cms/chat/pending-inquiries` +
`AdminChatPanel.svelte`의 "빠른문의 답변등록" 리마인더 카드, 981-996행)가 `chat_messages`를
전혀 거치지 않고 `get_all_cs_posts` RPC로 CMS 전용 UI 데이터만 조회함을 확인.
`handleSelectInquiry` → `/cms/customers/inquiry?post={id}` 딥링크 정상.

이 audit 범위(`cms/chat/`, `cms/chat/qna/`) 내에서 chat_messages/chat_sessions에
"관리자만 봐야 하는" 카드를 삽입하는 신규/기존 코드 없음.

**검증 결과: §17 재발 없음.**

---

## 신규발견

### [CRITICAL] "대기 전환" 버튼 — 문서화된 정책과 정면 모순, 긴급배지 전제조건 ① 무력화 가능
- **파일:위치**: `src/lib/components/chat/AdminChatPanel.svelte` 1141-1147행(버튼),
  694-705행(`handleSessionStatusChange`), `src/routes/api/chat/sessions/[id]/pending/+server.ts`(엔드포인트 전체)
- **재현조건**: `/cms/chat`에서 status='open'인 세션을 선택 → 툴바의 "대기 전환" 버튼 클릭
  → `POST /api/chat/sessions/{id}/pending` 호출 → `set_chat_session_status` RPC로
  즉시 `status='pending'`으로 전환됨. 이 엔드포인트는 `cms_role`이 있기만 하면 실행 가능
  (manager 이상 게이트 없음 — partner도 가능).
- **문서와의 모순**: 아래 3개 정본 문서가 전부 명시적으로 "그런 수동 액션은 없다"고 서술:
  - `chat.md` §3: "3시간 비활성(auto_pending_inactive_sessions RPC) → pending ← pending
    재진입 유일 경로" / "⚠️ 구버전 서술 '사용자 메시지 + CS_ESCALATE → pending'은 …폐기됐다"
  - `rental-lifecycle.md` "상담채팅 세션 상태": "대기(pending) 상태는 이제 오직
    auto_pending_inactive_sessions RPC(1시간 무응답 자동전환)로만 재진입한다"
  - `service-operations.md` §7: "대기 재진입은 오직 1시간 무응답 자동전환(cron)으로만
    일어난다 — cms에서 수동으로 대기 상태로 되돌리는 액션은 없다."
  - (참고: chat.md는 3시간, rental-lifecycle.md/service-operations.md는 1시간으로 서로
    다르게 서술 — 이것도 별도의 문서 간 불일치이나 이번 CRITICAL 발견에 비해 부차적이라
    "부가발견"으로 아래에 별도 기록)
- **원인 추정**: 코드 주석(`// GSD-1: P1-3 상태 직접변경 버튼 — reopen`,
  `// GSD-2: P1-3 상태 직접변경 버튼 — pending`)으로 보아, 2026-07-27 정책 변경(사용자
  CS_ESCALATE로도 더 이상 자동 pending 강등하지 않음, "관리자가 수동으로 상태를 직접
  바꿀 수 있게 하자"는 별개 편의기능) 이전 또는 그와 무관하게 추가된 "수동 상태 직접변경"
  기능이, 이후 세 문서에 걸쳐 "수동 pending 전환은 없다"는 정책이 명문화될 때 함께
  제거되지 않고 그대로 남아있었던 것으로 보임. `reopen`(pending/closed→open) 방향은
  정책과 모순되지 않으나, `pending`(open→pending) 방향만 문제.
- **영향범위**: 결제/예약 데이터 정합성이나 RLS 우회는 아니지만, 긴급배지(is_urgent)
  신뢰성의 4중 전제조건 중 ①(open 탭 노출)을 관리자가 직접, 즉시, 되돌릴 수 있는 방법을
  제공한다 — CS_ESCALATE로 판정된 긴급 대화를 관리자(또는 실수·오조작)가 "대기" 탭으로
  옮겨 기본 뷰(진행중 탭)에서 사라지게 할 수 있다. §13이 경계하는 바로 그 실패모드를
  문서가 "없다"고 단언한 액션이 실제로는 라이브 UI로 제공하고 있다는 점에서 등급을
  CRITICAL로 판단(문서-코드 불일치 자체의 심각도 + 운영상 긴급문의 은폐 가능성).
- **권장 조치(참고용, 이번 audit는 read-only)**: (a) 버튼·핸들러·`/pending` 엔드포인트
  제거하고 문서와 일치시키거나, (b) 현재 정책을 실제로 재검토해 "관리자 수동 대기전환"을
  공식 허용하기로 한다면 3개 문서를 전부 갱신 — 둘 중 하나로 코드와 문서를 일치시켜야 함.
  Stephen 확인 필요(요구범위 외 수정 절대 금지 원칙에 따라 이번 세션에서 직접 수정하지 않음).

---

## 부가발견 (참고, 낮은 우선순위)

1. **[ROUTINE] pending 자동전환 대기시간 문서 간 불일치**: `chat.md` §3/§10은 "3시간
   비활성"이라 서술하나 `rental-lifecycle.md`·`service-operations.md` §7은 "1시간
   무응답"이라 서술. `auto_pending_inactive_sessions` RPC 정의를 DB에서 직접 조회해
   실제 임계값을 확인하고 스테일한 쪽을 정정할 필요(이번 audit 범위·시간상 RPC 본문
   직접조회는 미실시 — DB 접근 없이 코드/문서 대조만 수행했음을 밝혀둠).

2. **[ROUTINE] security-auth.md 역할별 CMS 접근 매트릭스에 `/cms/chat`·`/cms/chat/qna`
   미등재**: `cmsPermissions.ts`의 `ROUTE_MIN_ROLE`에 두 경로 모두 없어 사실상
   "세션(cms_role)만 있으면 접근 가능"(partner 포함) 상태다. `/cms/products`·
   `/cms/reservation` 등 이미 매트릭스에 등재된 "파트너 세션만" 카테고리와 동일 패턴으로
   보이나, 매트릭스 표 자체에는 이 두 행이 없어 문서 커버리지 공백. `/cms/chat/qna`는
   화면 진입은 세션만 있으면 가능하지만 실제 변경 액션(캔드응답 CRUD·동의어 후보 승인/거부
   등)은 전부 `hasSettingsAccess`(manager 이상)로 게이트돼 있어 QR-CASE-2류의 "버튼은
   보이는데 클릭하면 403" 문제는 없음(코드 244행 `canManageAR`/`canManageCandidates`로
   버튼 자체도 조건부 렌더링 확인).

3. **[정보] `/api/chat/sessions/[id]/reopen`, `manual-mode`, `join`, `close` 등 나머지
   세션 상태 API**: 전부 cms_role 확인 후 `set_chat_session_status`/`set_chat_session_
   manual_mode` RPC 경유(H-01 준수) 또는 단순 admin_id 배정 — 정책 모순 없음.

---

## 자체 오인점검
- `misidentifications.md` 최근 5건 확인 — enum 대소문자·과거 마이그레이션 근거 인용·
  UNIQUE 제약 원인 성급 판단 등 패턴 확인. 이번 audit에서는 DB 직접조회 없이 코드/문서
  대조만으로 결론 낸 항목(부가발견 1번 "3시간 vs 1시간")은 확정 판정을 보류하고 "정본 확인
  필요"로만 표기 — 과거처럼 근거 없이 단정하지 않음.
- "대기 전환" 버튼 발견은 (a) 버튼 렌더 코드 확인 → (b) 핸들러가 실제 엔드포인트를 호출하는지
  확인 → (c) 그 엔드포인트가 다른 곳에서도 호출되는지(죽은 코드가 아닌지) grep으로
  3중 검증 후 "라이브 기능"으로 확정 — 죽은 코드를 실사용 버그로 오인하는 실수를 피함.
