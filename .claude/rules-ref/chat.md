# chat.md — 대화형 렌탈예약 어시스턴트 시스템 (PRD.1.7)
# Harness Flow v3.2 | crazyshot 채팅 도메인 정본
# 최종 업데이트: 2026-06-27 (세션 정책 확립 + 구현 완료)

---

## 1. 시스템 목표 & 설계 원칙

```
PRD.1.7 — 대화형 렌탈예약 어시스턴트 시스템 V1.0

핵심 방향: 카카오 의존 탈피 → 자사 DB 완전 내재화
- 채팅 UI·세션·이력 → Supabase 저장 (영구)
- Claude API Intent Classifier → 예약·결제·반납 의도 자동 분류
- 액션 카드 시스템 → 상품링크·결제버튼·반납등록 채팅 내 직결
- 관리자 CMS 채팅 패널 완전 통합 (별도 CS 툴 불필요)
- 카카오 알림톡 → 오프라인/부재 fallback 단방향 알림만

확장 목표:
  렌탈 예약관리 → 계약 → 결제 → 반납 → CS → AI 학습 연동
  → 통합 커머스 관리툴 내재화 (단일화 관리)
```

### 시스템 관리 원칙 (최우선)

```
❌ 오버엔지니어링 금지 — 필요한 것만, 현재 요구사항만 구현
❌ 기술부채 최소화 — 임시방편 우회 대신 근본 해결
❌ 외부 서비스 의존 확대 금지 (카카오는 단방향 fallback만)
✅ Supabase DB 완전 내재화 유지
✅ 안정적 기술구조: SvelteKit 5 + Supabase Realtime + Claude API
```

---

## 2. 채팅 세션 관리 정책 (확정 — 2026-06-27)

> 이 정책은 모든 코드 로직의 최우선 기준. 변경 시 Stephen 승인 필수.

### 정책 1 — 로그인 사용자: 영구 세션

```
- 로그인 사용자와 관리자 채팅 세션은 로그인 정보(auth.uid)로 상시 연결
- 진행중→종료 전환, 새로고침, 인터넷 기록 삭제 후 재로그인 → 동일 세션 복구
- 세션과 대화 정보는 영원히 DB에 누적 저장
- 신규 세션 생성 금지 (기존 세션 재활성화 우선)
```

### 정책 2 — 로그인 사용자: 채팅 재개

```
- 관리자 또는 사용자의 새 대화 등록 시 자동으로 채팅 재개 (진행중 이동)
- closed → 새 대화 = closed 세션 재활성화 (새 세션 ID 생성 금지)
- pending → 관리자 메시지 = open 전환 (대기→진행중)
- pending → 비-에스컬레이션 사용자 메시지 = open 전환
- 인앱 알림 애니메이션 + 향후 푸시알림 항상 작동 보장
```

### 정책 3 — 게스트: 기록 삭제 전까지 세션 유지

```
- 게스트 anon auth 토큰 → localStorage 저장
- 새로고침: 토큰 유지 → 기존 세션 재연결 → 알림 수신 정상
- 새 대화 등록 시 기존 세션 재개 + 알림 작동
- 인터넷 기록 삭제 전까지 동일 세션 보장
```

### 정책 4 — 게스트: 기록 삭제 후 데이터 보존

```
- localStorage 삭제 → anon 토큰 소멸 → 세션 소멸
- 기존 게스트 세션 DB 데이터: 영구 보존 (삭제 없음)
- 관리자 '종료' 탭에 기존 게스트 세션 이력 영구 보관
- 재방문 시: 새 anon auth → 새 세션 생성 (이전 이력 자동 연결 불가)
```

---

## 3. 세션 상태 머신

```
상태: open (진행중) | pending (대기) | closed (종료)

전환 규칙 (2026-07-27 설계 변경 반영 — rental-lifecycle.md "상담채팅 세션 상태" 참조):
  사용자 메시지 (어떤 intent든) → 무조건 open 전환
    · CS_ESCALATE가 분류돼도 즉시 pending으로 가지 않음
    · pending/closed 상태에서도 새 메시지 도착 자체로 open 복귀

  관리자 메시지 (텍스트·첨부) + closed  → open
  관리자 메시지 (텍스트·첨부) + pending → open
  관리자 메시지 + open                  → open (유지)

  3시간 비활성 (auto_pending_inactive_sessions RPC) → pending  ← pending 재진입 유일 경로
  관리자 닫기 버튼                                  → closed

신규 세션 생성 조건 (유일):
  - 로그인 사용자: 동일 context_type+context_id에 세션이 전혀 없을 때만
  - 게스트: 새 anon auth 발급 후 첫 채팅 시

⚠️ 구버전(2026-06-27 이전) 서술: "사용자 메시지 + CS_ESCALATE → pending"은
   2026-07-27 설계 변경으로 폐기됐다. 코드(/api/chat/message)에서 CS_ESCALATE를 이유로
   pending으로 강등하는 로직은 존재하지 않는다. 코드 수정 시 이 동작을 "버그"로 오인해
   되돌리지 않도록 주의.
```

---

## 4. DB 스키마 (PRD.1.7.3)

```sql
-- 핵심 테이블 4종 (chat 전용)

-- 세션 (1:N → chat_messages)
chat_sessions
  id          UUID PK
  user_id     FK → auth.users     -- 로그인 UUID or anon UUID
  admin_id    FK → auth.users (nullable)  -- 관리자 배정 시 설정
  status      ENUM: open | pending | closed
  context_type ENUM: general | product_inquiry | reservation | payment | return
  context_id  UUID (nullable)     -- 연결 상품/예약 ID
  created_at, updated_at

-- 메시지
chat_messages
  id           UUID PK
  session_id   FK → chat_sessions
  sender_type  ENUM: user | admin | ai
  content      TEXT (최대 1000자)
  message_type ENUM: text | image | action_card
  action_payload JSONB (nullable)  -- 액션 카드 데이터
  is_read      BOOLEAN DEFAULT false
  created_at

-- REPLICA IDENTITY FULL 설정 필수 (UPDATE Realtime 작동)

-- 의도 분류 로그
chat_intent_logs
  message_id   FK → chat_messages
  intent       ENUM: RESERVATION_INQUIRY | PAYMENT_REQUEST | RETURN_GUIDE |
                     PRODUCT_RECOMMEND | CS_ESCALATE | GENERAL
  confidence   FLOAT (0.0~1.0)
  raw_response JSONB

-- CS 기록
cs_records
  session_id   FK → chat_sessions
  admin_id     FK → auth.users
  summary      TEXT
  status       ENUM: new | in_progress | resolved
```

---

## 5. RLS 정책 (DB 레벨 보안)

```sql
-- chat_sessions
사용자 SELECT: user_id = auth.uid()
관리자 SELECT: is_cms_user() → 전체 (SECURITY DEFINER 함수)
관리자 UPDATE: is_cms_user()

-- chat_messages
SELECT (participant_select_messages):
  is_cms_user()
  OR EXISTS (chat_sessions WHERE user_id=auth.uid() OR admin_id=auth.uid())

INSERT (participant_insert_message):
  관리자: sender_type = 'admin'
  일반: sender_type IN ('user','ai') AND 본인 세션

UPDATE (participant_update_read):
  is_cms_user()
  OR EXISTS (chat_sessions WHERE user_id=auth.uid() OR admin_id=auth.uid())
  WITH CHECK: is_read = true  (읽음 표시만 허용)

-- is_cms_user() — SECURITY DEFINER
SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id=auth.uid() AND cms_role IS NOT NULL)
```

---

## 6. API 엔드포인트 명세 (PRD.1.7.6)

```
POST /api/chat/session
  역할: 세션 생성 or closed 재활성화 (pending/open은 ChatWindow가 직접 사용)
  로직: closed 세션 검색 → 있으면 UPDATE open → 없으면 INSERT
  인증: Supabase auth 필수 (anon 포함)

POST /api/chat/message
  역할: 사용자 메시지 전송 + Claude AI 의도 분류 + AI 응답 생성
  로직:
    1. 세션 소유자 확인 (context_type·context_id도 조회 — AC-2 enrichActionCard용)
    2. closed 세션 → 자동 open 전환 (race condition 대비)
    3. 사용자 메시지 INSERT
    4. 세션 상태 → 메시지 도착 자체로 무조건 open 전환 (intent와 무관)
       ※ 2026-07-27 설계 변경: CS_ESCALATE여도 pending으로 강등하지 않음
    5. 하이브리드 1단계: 빠른답변(canned_response) 키워드 매칭 시도
       → 매칭 성공: 자동답변 INSERT 후 즉시 반환 (Claude 호출 생략)
    6. Claude API (claude-haiku-4-5) Intent Classifier 호출
    7. confidence < 0.6 → CS_ESCALATE 강제
    8. action_card 있음 → enrichActionCard로 실데이터(상품명·예약번호 등) 채움 (AC-2)
    9. AI 응답 메시지 INSERT
   10. chat_intent_logs INSERT

POST /api/chat/admin-reply
  역할: 관리자 텍스트 메시지 전송
  로직:
    1. cms_role 확인 (service_role client)
    2. closed|pending → UPDATE status=open, admin_id 배정
    3. open → admin_id 미배정이면 배정
    4. 메시지 INSERT

POST /api/chat/admin-attachment
  역할: 관리자 첨부파일 전송 (이미지/문서)
  로직: admin-reply와 동일 세션 재활성화 정책 적용

GET  /api/chat/sessions
  역할: 관리자 세션 목록 조회
  로직: auto_pending_inactive_sessions() RPC 호출 후 목록 반환

POST /api/chat/sessions/{id}/close
  역할: 관리자 세션 종료 (진행중→종료)
  조건: cms_role 확인 / open|pending 상태만 closed 가능
```

---

## 7. 컴포넌트 구조

```
src/lib/components/chat/
  FloatingButton.svelte     ← 채팅 진입 FAB + 알림 애니메이션 + 백그라운드 구독
  ChatBottomSheet.svelte    ← 바텀시트 모달 컨테이너 (모바일) / 팝업 (PC)
  ChatWindow.svelte         ← 채팅 창 전체 조합 (세션 초기화 + Realtime)
  ChatHeader.svelte         ← 채팅 상단 바 (사용자명·핸들·닫기)
  ChatInput.svelte          ← 입력 폼 (텍스트·파일 첨부)
  MessageList.svelte        ← 메시지 목록 스크롤
  MessageBubble.svelte      ← 단일 메시지 버블 (더블체크·타임스탬프)
  ActionCard.svelte         ← 액션 카드 (결제·예약·반납 요청)
  AdminChatPanel.svelte     ← 관리자 전용 CMS 패널 (/cms/chat)
  ChatBottomSheet.svelte    ← 게스트/로그인 사용자 채팅 모달

src/lib/services/chatService.ts    ← 서비스 레이어 (API 래퍼 + Realtime)
src/lib/stores/chat.svelte.ts      ← Svelte 5 Runes 전역 스토어
src/lib/types/chat.ts              ← 타입 정의
```

---

## 8. FloatingButton 알림 구독 흐름

```typescript
// 마운트 시 세션 자동 복구 ($effect①)
// Svelte 5: .then() 내부 읽기는 추적 안 됨 → 마운트 시 1회만 실행
$effect(() => {
  supabase.auth.getSession().then(({ data: { session: authSession } }) => {
    if (!authSession) return          // 미인증 → 복구 불가
    if (chatStore.activeSessionId) return  // 이미 구독 중
    const ct = contextType  // .then 내부 → 추적 안 됨
    const ci = contextId
    loadUserSession(ct, ci).then(({ session }) => {
      // ⚠️ closed 포함 모든 상태 구독 (정책 1·2 핵심)
      if (session && !chatStore.activeSessionId) {
        setActiveSession(session.id)
      }
    })
  })
})

// 구독 유지 ($effect②)
$effect(() => {
  const sessionId = chatStore.activeSessionId
  if (!sessionId) return
  const unsub = subscribeToChatMessages(sessionId, (msg) => {
    pushMessage(msg)  // !isOpen && admin|ai → unreadCount++
  })
  return unsub  // cleanup 필수
})
```

---

## 9. Realtime 구독 패턴

```typescript
// chatService.ts
// 채널명 충돌 방지: 매 호출마다 단조증가 ID
// 동일 채널명 → Supabase JS가 existing subscribed 채널 반환 →
// .on() 호출 시 "cannot add callbacks after subscribe()" 에러
let _channelSeq = 0

export function subscribeToChatMessages(
  sessionId: string,
  onMessage: (message: ChatMessage) => void,
  onRead?: (messageId: string) => void
): () => void {
  const uid = ++_channelSeq
  const channel = supabase
    .channel(`chat:${sessionId}:${uid}`)  // 고유 ID 필수
    .on('postgres_changes', { event: 'INSERT', ... filter: `session_id=eq.${sessionId}` },
      (payload) => onMessage(payload.new as ChatMessage))
    .on('postgres_changes', { event: 'UPDATE', ... filter: `session_id=eq.${sessionId}` },
      (payload) => {
        // REPLICA IDENTITY FULL 필수 — payload.old 없으면 작동 안 함
        if (payload.new.is_read === true && payload.old?.is_read === false) {
          onRead?.(payload.new.id as string)
        }
      })
    .subscribe()
  return () => supabase.removeChannel(channel)  // cleanup 필수
}
```

### 9-1. 낙관적(optimistic) 사용자 메시지 ↔ Realtime 경쟁 — "중복 노출 후 사라짐" 결함 (2026-09-02 발견·수정)

```
증상: 사용자가 메시지를 보내면 말풍선이 잠깐 2개(임시+실제)로 겹쳐 보였다가 그중 하나만
사라지는 실서비스 결함 — 캔드매칭/AI 폴백·푸시발송 등 서버 후속 처리가 오래 걸릴수록
재현 확률이 높아짐(발생 조건 아래 참고).

원인: ChatWindow.svelte handleSend()가 pushMessage({id:`temp-${uuid}`, ...})로 낙관적
말풍선을 먼저 그리고, POST 응답이 돌아올 때까지 기다린 뒤에야 removeMessage(tempId) +
pushMessage(response.user_message)를 실행한다. 그런데 서버(/api/chat/message)는 사용자
메시지를 요청 초반에 즉시 INSERT하고 그 뒤에 캔드매칭/AI 폴백/푸시발송을 처리한 다음에야
HTTP 응답을 반환하므로, 그 지연 구간 동안 Supabase Realtime이 같은 INSERT를 먼저 통지해
pushMessage(실제 메시지)가 호출된다. 기존 pushMessage()의 중복방지는 `id` 단순 일치
비교뿐이라 temp-id와 실제 id를 같은 메시지로 인식하지 못해 배열에 둘 다 남았다가,
나중에 POST가 resolve되며 removeMessage(tempId)가 임시 쪽만 지워 "중복 후 하나만 사라짐"
처럼 보였다.

수정: pushMessage()(src/lib/stores/chat.svelte.ts)에 "낙관적 임시 메시지 치환" 로직 추가 —
sender_type='user'인 실제 메시지가 들어오면, 같은 session_id·sender_type='user'·동일
content를 가진 temp-* 메시지가 배열에 있는지 먼저 찾아 그 자리에서 교체(추가가 아님)한다.
handleSend()의 흐름(먼저 push → await → removeMessage → pushMessage)은 그대로 두되, 두
경쟁 순서 모두 최종적으로 말풍선 1개만 남도록 보장:
  - POST가 먼저 끝나는 일반적인 경우: removeMessage(tempId)가 임시를 지우고 pushMessage가
    실제 메시지를 추가 — 기존 흐름과 동일.
  - Realtime이 먼저 도착하는 경쟁 경우: pushMessage가 temp를 실제 메시지로 즉시 치환 →
    이후 removeMessage(tempId)는 이미 없는 id라 no-op, pushMessage(response.user_message)도
    id가 이미 존재해 dedup으로 no-op — 중간에 두 번째 말풍선이 나타나는 순간 자체가 없음.

⚠️ 이 치환은 content 문자열 완전 일치를 전제로 한다 — ChatInput.svelte가 onsend 호출 전
`content.trim()`을 거치고 서버도 `body.content.trim()`으로 저장하므로 정상 흐름에서는
항상 일치하지만, 향후 이 trim 처리 중 하나를 제거하면 이 치환이 조용히 안 먹히고(폴백으로
기존 remove+push 흐름만 동작) 결함이 재발할 수 있다 — trim 처리를 양쪽에서 유지할 것.
```

---

## 10. Intent Classifier (PRD.1.7.4)

```
모델: claude-haiku-4-5 (빠른 분류 전용)
ANTHROPIC_API_KEY: $env/static/private 전용 (H-05)

Intent 분류:
  RESERVATION_INQUIRY → 예약 가능 일정·상품 조회 카드
  PAYMENT_REQUEST     → 결제 링크 액션 카드 생성
  RETURN_GUIDE        → 반납 안내 카드
  PRODUCT_RECOMMEND   → 상품 추천 카드
  CS_ESCALATE         → 긴급 배지 표시 (관리자 주의 신호) — 세션 pending 강제는 하지 않음
  GENERAL             → 일반 텍스트 응답

confidence < 0.6 → CS_ESCALATE 강제

세션 상태 전환 정책 (2026-07-27 설계 변경 — rental-lifecycle.md §채팅세션상태 정본):
  사용자 메시지 도착 → intent 결과와 무관하게 무조건 open 전환
  CS_ESCALATE 분류   → 관리자 패널에 "긴급" 배지(is_urgent)만 표시 — pending 전환 없음
  pending 재진입     → auto_pending_inactive_sessions RPC(3시간 무응답)만 가능

⚠️ 구버전 서술 "CS_ESCALATE → session.status='pending'" 및
   "비-에스컬레이션+pending → session.status='open'"은
   2026-07-27 변경으로 폐기. 코드(/api/chat/message)에 해당 로직 없음.
```

---

## 11. 액션 카드 시스템 (PRD.1.7.5)

```
채팅 스트림 내 실행 가능한 카드 컴포넌트 6종:

PRODUCT_CARD           → 상품 썸네일+단가 | CTA: [바로 예약하기]
RESERVATION_STATUS_CARD→ 예약 상태 | confirmed→[결제하기] / active→[반납 요청]
PAYMENT_REQUEST_CARD   → 금액+만료 카운트다운 | [결제하기]
RETURN_REGISTRATION_CARD → 반납 등록 | [반납 요청]
SHIPMENT_TRACKING_CARD → 배송 현황 | 운송장 추적
COUPON_GIFT_CARD       → 쿠폰 발행 | [쿠폰 받기]

is_expired: false (초기) → 만료 시 true (버튼 비활성화)
```

---

## 12. 관리자 채팅 패널 (PRD.1.7.1.1)

```
라우트: /cms/chat
컴포넌트: src/lib/components/chat/AdminChatPanel.svelte

탭 구조:
  진행중 (open)  → 현재 대화 중, 닫기 버튼 있음
  대기   (pending) → 1시간 비활성 자동 이동 (auto_pending_inactive_sessions)
  종료   (closed)  → 관리자 닫기 또는 게스트 기록삭제 후 보존

기능:
  - 세션 목록 Realtime 구독 (subscribeToSessions)
  - 세션 선택 → 메시지 구독 + 관리자 메시지 전송
  - AI sender_type 메시지 필터링 (관리자 뷰에서 ai 카드 미표시)
  - 읽음 처리: markMessagesRead(sid, ['user'])
  - 닫기 버튼: POST /api/chat/sessions/{id}/close
  - sender_type = 'admin' 메시지만 전송 가능

대기탭 자동 이동:
  admin GET /api/chat/sessions 호출마다
  auto_pending_inactive_sessions() RPC 실행
  → open + updated_at < now() - 3hr → pending
```

---

## 13. 카카오 알림톡 Fallback 정책 (PRD.1.7.7)

```
카카오의 역할 (v1.55-r1 재정의):
  이전: 메인 CS 채널 (채팅+계약+결제)
  현재: 단방향 알림 전용 fallback

카카오 알림톡 사용 트리거 (단방향 PRD.1.1 17종):
  - 앱/웹 미오픈 시 중요 이벤트 (예약확정·결제완료·배송출고·반납안내 등)
  - 관리자 미응답 30분 → 재방문 유도 딥링크 포함

채팅·CS·계약·결제 → 전부 자사 시스템 처리
카카오에서 채팅 UI 제공 금지 (fallback으로만)
```

---

## 14. 구현 완료 현황 (2026-06-27 기준)

```
✅ DB 스키마: chat_sessions·chat_messages·chat_intent_logs·cs_records
✅ Supabase RLS: SELECT·INSERT·UPDATE 정책 (is_cms_user DEFINER 포함)
✅ REPLICA IDENTITY FULL: chat_messages·chat_sessions
✅ auto_pending_inactive_sessions() RPC 함수

✅ API 라우트:
   POST /api/chat/session    (생성·closed 재활성화)
   POST /api/chat/message    (메시지+AI 분류, pending/closed 상태 전환)
   POST /api/chat/admin-reply (관리자 메시지, closed|pending→open)
   POST /api/chat/admin-attachment (첨부, closed|pending→open)
   GET  /api/chat/sessions   (목록, auto-pending 포함)
   POST /api/chat/sessions/{id}/close

✅ 컴포넌트:
   FloatingButton (세션 복구·백그라운드 구독·전파 애니메이션)
   ChatBottomSheet (aria 접근성 수정 완료)
   ChatWindow (세션 초기화·Realtime·파일업로드)
   ChatHeader·ChatInput·MessageList·MessageBubble
   ActionCard·AdminChatPanel

✅ 채팅 세션 정책 4개 전체 코드 반영 완료

✅ 웹 푸시 알림 (FCM) — 관리자 답장 경로 (2026-08-09 추가)
   admin-reply·admin-attachment → sendPushToUser(고객, 'admin_chat_reply') 연결 완료
   (src/lib/server/push.ts 발신 허브 재사용, push_notification_config 신규 항목 등록)
   ⚠️ 예약 라이프사이클(승인·반출·반납 등) 푸시는 이보다 먼저 별도로 연결·QA 완료된 상태였음
      (rental-lifecycle.md AUTO_NOTIFY 매핑 참고) — 이번 건은 그 인프라를 채팅 답장에도 확장한 것

⚠️ 웹 푸시 커버리지 공백 (2026-08-19 전역감사로 확인, service-operations.md §15 참고):
   - 채팅카드(chat_messages INSERT)와 브라우저 푸시(FCM)는 완전히 별개 경로 — 새
     notify_type을 send_rental_chat_notification RPC에 추가해도 push.ts의
     CUSTOMER_LIFECYCLE_PUSH_COPY에 별도로 추가하지 않으면 푸시는 조용히 no-op된다.
     reservation_cancelled·damage_claimed·hold_expired 3종이 이 문제로 누락됐다가
     2026-08-19 문구 추가로 수정(hold_expired는 순수 SQL/pg_cron 트리거라 앱코드 push
     함수를 호출할 경로 자체가 없어 여전히 구조적 미발송 — 별도 아키텍처 필요).
   - ✅ AI 자유응답·캔드매칭(canned) 자동응답·쿠폰선물·연체료 안내·고객 서명완료 카드
     5종 — 애초에 push 호출 자체가 코드에 없었으나 2026-08-19 같은 날 후속으로 전부
     sendPushToUser 연결 완료(admin-reply와 동일한 발신허브 재사용, 신규 함수 없음).

✅ iOS Safari 웹푸시 — 구조적 한계 진단 → 같은 날 완전 해소 (2026-08-19):
   iOS 16.4+ Safari는 "홈 화면에 추가"된 독립형(standalone) 웹앱에서만 Web Push를 허용한다
   — 일반 브라우저 탭에서는 알림 권한 요청 자체가 동작하지 않는 플랫폼 제약(코드로 우회
   불가). 진단 시점엔 manifest.json·app.html의 iOS 관련 메타태그·아이콘 자산이 전부 없어
   "홈 화면에 추가" 유도조차 안 되는 상태였다.
   1단계: `static/manifest.json` 신설 + `app.html`에 매니페스트 링크·apple-touch-icon·
   `apple-mobile-web-app-capable` 메타태그 추가 + Stephen 제공 로고 SVG를 `@resvg/resvg-js`로
   래스터화해 16/32/180/192/512·maskable-512 아이콘 세트 생성(`static/app-icons/` — `icons`가
   아닌 이름 사용 이유는 macOS 기본 `.gitignore`의 `Icon?` 패턴과 대소문자 무시 충돌 회피,
   service-operations.md §15 참고).
   2단계: iOS는 안드로이드의 네이티브 설치 유도(`beforeinstallprompt`)가 없어 사용자가
   공유 메뉴에서 "홈 화면 추가"를 스스로 찾아야 하는 문제 — `IosAddToHomeScreenBanner.svelte`
   신설(`src/lib/utils/iosPwa.ts` UA/standalone 판별). iOS 기기 + 아직 홈 화면 설치 전일 때만
   진입 2초 후 노출, 닫으면 `localStorage`에 영구 기록해 재노출 안 함. `/cms/*` 제외.

⏳ 미구현 (다음 사이클):
   - 카카오 알림톡 fallback 자동 발송
   - cs_records 관리자 CS 기록 저장
   - 액션 카드 만료 처리 로직
   - 관리자 미응답 알림(FCM) — TASK.md CS-A3 참고, Stephen 승인 대기 중 별건
```

### 14-1. 포그라운드 안내 토스트 문구 3종 단일화 (2026-09-02 확정)

```
PushNotificationInit.svelte의 onMessage(FCM 포그라운드 수신) 콜백이 과거엔 서버가 그 발송
건에 지정한 title/body를 그대로 이어붙여 보여줬다 — notifyType마다 문구가 제각각이었음.

✅ 확정: src/lib/utils/pushToastMessage.ts의 buildUnifiedPushToastMessage(notifyType)가
payload.data.notifyType 하나만 보고 아래 3종 정형 문구 중 하나로 통일해 반환한다(title/body
텍스트는 토스트에 더 이상 쓰이지 않음 — OS 백그라운드 푸시 알림에는 계속 사용됨, 포그라운드
토스트만 대상):

  ① 신규 대화(매핑 없는 기본값)     : "새로운 대화를 확인하세요."
  ② 질문에 대한 답변(canned_auto_reply·ai_auto_reply·admin_chat_reply)
                                     : "새로운 답변을 확인하세요."
  ③ 중요 실행 알림(정보)            : "새로운 {정보명} 정보를 확인하세요."
     — 정보명 매핑(IMPORTANT_NOTIFY_LABELS): reservation_hold→예약신청,
       reservation_approval→예약승인, shipment_notify→반출, rental_confirm→대여,
       return_registration/return_remind→반납, rental_complete→대여완료,
       reservation_cancelled→예약취소, damage_claimed→파손신고, hold_expired→예약만료,
       contract_signed_customer/contract_signed→전자계약, coupon_gift→쿠폰,
       late_fee_paid→연체료, locker_guide→보관함, dhero_place_guide→수령위치,
       tracking_notify→운송장, chat_unanswered→미답변, identity_request→본인증명,
       contract_sent→전자계약, new_reservation→예약, payment_completed→결제, new_session→상담

⚠️ 2026-09-02(같은 날 후속, sp3-qa-agent 검수로 발견) — 최초 배포 시 이미 서비스 중이던
locker_guide/dhero_place_guide/tracking_notify(예약 라이프사이클)·chat_unanswered/
identity_request/contract_sent(개별 sendPushToUser 호출) 6종이 이 매핑에서 누락돼 있었다
— push.ts의 CUSTOMER_LIFECYCLE_PUSH_COPY 등 기존에 이미 발송 중이던 타입은 신규 매핑을
만들 때 전수 대조해야 한다(신규 타입만 챙기고 기존 타입을 빠뜨리기 쉬움). 위 표는 수정
완료 반영.

새 notify_type을 추가할 때 이 매핑에 등록하지 않으면 자동으로 ①(기본값)으로 폴백돼
화면이 깨지지는 않지만, 의도한 분류(②/③)로 보이게 하려면 반드시
pushToastMessage.ts에 함께 등록할 것 — CUSTOMER_LIFECYCLE_PUSH_COPY(push.ts)에만
등록하고 이 파일에 빠뜨리면 포그라운드 토스트만 "새로운 대화를 확인하세요"로 뭉뚱그려
보이는 결함이 재발한다.
```

---

## 15. GATE C 확인 항목 (채팅 시스템)

```
세션 관리
[ ] 로그인 사용자 새로고침 후 FloatingButton 백그라운드 구독 복구?
[ ] closed 세션에 관리자 메시지 → open 전환 + 사용자 알림?
[ ] pending 세션에 관리자 메시지 → open 전환?
[ ] 게스트 새로고침 → localStorage anon 유지 → 세션 복구?
[ ] 신규 세션 생성 없이 기존 세션 재활성화?

보안
[ ] ANTHROPIC_API_KEY $env/static/private 전용?
[ ] 관리자 라우트 cms_role 확인?
[ ] RLS 정책 — 사용자 A가 사용자 B 메시지 못 보는가?
[ ] admin_id 없는 세션 SELECT: user_id = auth.uid()로만 접근?

Realtime
[ ] subscribeToChatMessages 채널명 고유 ID 포함? (_channelSeq)
[ ] $effect cleanup에서 supabase.removeChannel() 호출?
[ ] REPLICA IDENTITY FULL 설정 확인?
[ ] 사용자 메시지 전송 경로를 수정했다면 — 낙관적 임시 메시지(`temp-*`)와 Realtime이 먼저
    배달하는 실제 메시지가 화면에 동시에(중복) 보이지 않는가? pushMessage()의 temp 치환
    로직(§9-1)이 여전히 동작하는지 확인(특히 ChatInput의 content.trim() 제거 시 이 치환이
    조용히 깨질 수 있음)?

UI
[ ] sender_type = 'ai' 관리자 패널 미표시?
[ ] 더블체크 = is_read Realtime UPDATE 실시간 반영?
[ ] 미읽음 전파 애니메이션 = cs-red-badge 80% 투명도?

자동응답·긴급판정 (2026-08-19 추가 — service-operations.md §13③④ 원본)
[ ] 신규 캔드응답 카테고리가 CS_ESCALATE급 민감 주제(파손·분실·컴플레인 등)라면
    src/routes/api/chat/message/+server.ts의 SENSITIVE_CANNED_CATEGORIES에 포함시켜
    chat_intent_logs에 CS_ESCALATE 로그가 남는가? (누락 시 그 카테고리 자동응답은
    긴급배지가 절대 뜨지 않음 — 캔드매칭은 AI 의도분류 자체를 건너뛰기 때문)
[ ] /api/chat/sessions의 긴급판정(needsUrgentCheck)이 마지막 메시지 sender_type='admin'
    만으로 "이미 응답됨"으로 오판하지 않는가? (admin_id가 NULL인 세션은 캔드매칭
    자동응답만 있었을 가능성 — 여전히 판정 대상에 포함돼야 함)
[ ] 새 예약 라이프사이클 알림 타입 추가 시 — 채팅카드(RPC)뿐 아니라 push.ts의
    CUSTOMER_LIFECYCLE_PUSH_COPY(브라우저 푸시)에도 함께 추가했는가? (service-operations.md
    §15 — 둘은 완전히 별개 경로, 자동 동기화 없음)
[ ] 새 notify_type 추가 시 — pushToastMessage.ts(§14-1)의 ANSWER_NOTIFY_TYPES 또는
    IMPORTANT_NOTIFY_LABELS에도 분류를 등록했는가? (누락 시 포그라운드 토스트가 ①기본값으로
    뭉뚱그려 보임 — 에러는 아니지만 의도한 분류가 아님)
```

---

## 16. 향후 확장 지침 (기술부채 방지)

```
웹 푸시 알림 연동 시:
  - 기존 session.id를 FCM payload에 그대로 사용
  - user_id(auth.uid) → FCM 토큰 매핑 테이블 추가
  - 앱 미오픈 상태 감지: Service Worker
  - 세션 ID 고정 구조 덕분에 deep-link 바로 연결 가능

AI 학습 연동 시:
  - chat_intent_logs 축적 데이터 활용
  - confidence 임계값(0.6) 조정으로 자동화 범위 확대
  - 사용자별 intent 패턴 → 개인화 추천

커머스 라이프사이클 통합 시:
  - context_type = 'reservation' | 'payment' | 'return' 활용
  - 예약/결제/반납 이벤트 → 해당 세션에 자동 메시지 push
  - cs_records → 고객 CRM 단일화
```

---

## 17. Phase 2~3 CRITICAL 기능 — 운영 정본 (2026-08-13 추가)

### 17-1. 세션 상태 직접변경 API (reopen / pending)

```
엔드포인트:
  POST /api/chat/sessions/[id]/reopen   — pending·closed → open 전환
  POST /api/chat/sessions/[id]/pending  — open → pending 전환
  POST /api/chat/sessions/[id]/close    — open → closed 전환 (H-01 예외 — 직접 UPDATE 유지)

H-01 준수 (M2 QA Fix, 2026-08-13):
  reopen/pending 엔드포인트는 직접 UPDATE 금지 →
  set_chat_session_status(p_session_id uuid, p_status text) RPC 경유 필수
  Migration 238 (20260813000238_238_set_chat_session_status_rpc.sql)

RPC 동작:
  - idempotent: 동일 상태면 changed:false 반환, 에러 없음
  - 세션 미존재 시 RAISE EXCEPTION (→ API 404 반환)
  - SECURITY DEFINER + service_role 전용 (anon/authenticated 차단)
  - 반환: { session_id, old_status, new_status, changed }

AdminChatPanel UI 연결:
  handleReopenSession(sid) → POST /reopen → 로컬 sessions 상태 즉시 갱신
  handlePendingSession(sid) → POST /pending → 로컬 sessions 상태 즉시 갱신
  handleCloseSession(sid) → POST /close → 닫힌 세션 선택 해제

GATE C 확인 항목:
  [ ] reopen/pending 엔드포인트가 RPC 경유 (직접 .update() 금지)?
  [ ] close 엔드포인트는 범위 밖 (현행 직접 UPDATE 유지)?
  [ ] set_chat_session_status RPC — SECURITY DEFINER + service_role 전용?
  [ ] Migration 238이 stage → production 순서로 적용됐는가?
```

### 17-2. 고객 상세정보 패널 (CustomerDetailPanel)

```
컴포넌트: src/lib/components/chat/CustomerDetailPanel.svelte
          (CMS 버전과 별개 — chat 전용 파일)

RPC: get_chat_customer_detail(p_user_id uuid)
     → { profile: { name, phone, identity_type, identity_verified_at, ... },
         subscription: { plan_name } | null,
         reservations: ReservationItem[] }

identity_type 분기 (M3 QA Fix, 2026-08-13):
  ❌ 금지: {#if detail.profile.is_student}  ← 레거시 boolean 필드, RPC가 반환 안 함
  ✅ 올바른 패턴: {#if detail.profile.identity_type === 'student'}

is_foreign 분기도 동일 원칙 적용:
  {#if detail.profile.identity_type === 'foreigner'} (또는 RPC 반환 실제 값 확인 후 적용)

CustomerDetail 인터페이스 (chat 버전):
  profile.identity_type: string | null  ← RPC 반환값 기준 (is_student·is_foreign boolean 무시)

AdminChatPanel 연결:
  $effect(() => { fetch(`/api/chat/customers/${uid}/detail`) })
  customerDetail = d?.detail ?? null
  <CustomerDetailPanel bind:detail={customerDetail} ... />

GATE C 확인 항목:
  [ ] 학생인증 분기가 identity_type === 'student' 기준?
  [ ] is_student boolean 직접 참조 없음?
  [ ] get_chat_customer_detail RPC 반환값에 identity_type 존재 확인?
```

### 17-3. 세션별 자동응답 모드 (manual_mode)

```
컬럼: chat_sessions.manual_mode BOOLEAN DEFAULT FALSE
Migration: 230 (20260812000230_230_chat_sessions_manual_mode.sql)
RPC: set_chat_session_manual_mode(p_session_id uuid, p_manual_mode boolean)

동작:
  manual_mode = false (기본) → AI 자동응답 활성 (기존 동작 유지)
  manual_mode = true → AI 자동응답 비활성 → 관리자가 직접 모든 답변 작성

API: PATCH /api/chat/sessions/[id]/manual-mode { manual_mode: boolean }
AdminChatPanel:
  handleToggleManualMode() → 낙관적 업데이트 → 실패 시 롤백
  sessionManualMode 상태 = selectedSession?.manual_mode ?? false

message/+server.ts 자동응답 분기:
  if (session.manual_mode) → AI·캔드리스폰스 자동실행 전부 스킵
                            → 고객 메시지만 저장 후 응답

GATE C 확인 항목:
  [ ] manual_mode=true 시 AI 자동응답 스킵?
  [ ] manual_mode=true 시 캔드리스폰스 자동매칭 스킵?
  [ ] 세션 변경 시 sessionManualMode 재동기화?
```

### 17-4. 메시지 북마크 시스템

```
테이블: chat_message_bookmarks
Migration: 231 (20260812000231_231_chat_message_bookmarks.sql)

RPC 목록:
  toggle_message_bookmark(p_message_id, p_session_id, p_admin_id, p_note)
    → idempotent 북마크 추가/해제 토글
  get_session_bookmarks(p_admin_id, p_session_id)
    → 세션 내 모든 북마크 조회
    → 반환: { bookmark_id, message_id, session_id, note, created_at, message_content, message_type }

API 엔드포인트:
  POST   /api/chat/messages/[id]/bookmark  { session_id, note? }  → toggle_message_bookmark RPC
  DELETE /api/chat/messages/[id]/bookmark                         → 명시적 삭제 (L2 QA Fix)
  GET    /api/chat/sessions/[id]/bookmarks                        → get_session_bookmarks RPC

M1 QA Fix (2026-08-13): 북마크 초기화 상태 버그 수정
  문제: MessageBubble let bookmarked = $state(false) → 항상 false로 초기화
  수정: AdminChatPanel.loadMessages 시 bookmarks를 병렬 로드 → is_bookmarked 병합
        → MessageBubble: let bookmarked = $state(message.is_bookmarked ?? false)

AdminChatPanel 로드 흐름:
  Promise.all([loadMessages(sid), fetch(`/api/chat/sessions/${sid}/bookmarks`)])
  → Set<message_id> 구성 → messages.map(m => ({ ...m, is_bookmarked: ids.has(m.id) }))

handleBookmark(messageId):
  POST /api/chat/messages/${messageId}/bookmark { session_id: selectedSessionId }
  → messages 로컬 상태 is_bookmarked 토글 동기화

북마크 뷰: BookmarkListView.svelte → GET /api/chat/sessions/[id]/bookmarks

ChatMessage 타입:
  is_bookmarked?: boolean  ← src/lib/types/chat.ts (M1 QA Fix에서 추가)

GATE C 확인 항목:
  [ ] ChatMessage 타입에 is_bookmarked?: boolean 존재?
  [ ] loadMessages 시 bookmarks 병렬 로드 + is_bookmarked 병합?
  [ ] MessageBubble bookmarked 초기값이 message.is_bookmarked ?? false?
  [ ] POST /bookmark body에 session_id 포함?
  [ ] DELETE /bookmark가 toggle이 아닌 명시적 삭제?
```

### 17-5. 상품 링크 카드 (product_link) — @ 멘션 발송

```
발동: 관리자가 ChatInput에 '@상품명' 입력 → 검색 드롭다운 → 선택 시 product_link ActionCard 발송

검색 API: GET /api/cms/products/search-suggestions?q=&limit=6&activeOnly=true
  L1 QA Fix (2026-08-13): image_urls, slug, price_24h 추가 반환
    ilike 쿼리 select에 image_urls, slug 추가
    응답에 image_url (= image_urls[0]), price_24h 포함
    MiniSearch 폴백 결과는 image_url·price_24h null (인덱스에 미포함)
  ⚠️ L1 QA 재검수(2026-08-13)에서 회귀 발견·수정: image_urls[0]은 Cloudinary public_id가 아니라
    Supabase Storage 전체 URL(/api/cms/upload가 getPublicUrl()로 저장 — chatActionEnrich.ts:113-115에
    이미 문서화된 기존 불일치). ActionCard.svelte가 이를 무조건 Cloudinary URL에 이어붙이던 최초
    수정은 깨진 이미지를 만들었음 — ProductHero.svelte와 동일한 startsWith('http') 방어 분기로 수정.

ChatInput.svelte ProductItem 타입:
  image_url?: string | null   ← Cloudinary public_id 또는 Supabase Storage 전체 URL(둘 다 가능)
  slug?: string | null
  price_24h?: number | null

selectProductItem → onproductmention({ id, name, image_url, slug, price_24h })

AdminChatPanel handleProductMention → action_payload:
  type: 'product_link'
  product_id:    product.id
  product_name:  product.name
  product_image: product.image_url   ← Cloudinary public_id 또는 Storage 전체 URL(존재 시)
  product_slug:  product.slug        ← 상세 링크 URL (존재 시)
  product_price: product.price_24h   ← 24h 가격 (존재 시)

ActionCard.svelte product_link 렌더링:
  imageUrl = product_image
    ? product_image.startsWith('http')
      ? product_image
      : `https://res.cloudinary.com/crazyshot/image/upload/w_128,h_128,c_fill,f_auto,q_auto/${payload.product_image}.jpg`
    : null
  상세보기 → product_slug or product_id 기반 링크

GATE C 확인 항목:
  [ ] search-suggestions API가 image_urls, slug, price_24h 반환?
  [ ] ChatInput ProductItem에 image_url, slug, price_24h 타입 정의?
  [ ] onproductmention callback이 새 필드 전달?
  [ ] handleProductMention payload에 product_image, product_slug, product_price 포함?
```

### 17-6. CTA 버튼 자동응답 (canned_cta)

```
canned_responses.cta_label 필드가 있는 자동응답 → ActionCard type: 'canned_cta' 발행
Migration: 232 (20260812000232_232_canned_responses_cta.sql)

ActionPayload:
  type: 'canned_cta'
  button_label: cta_label   ← canned_responses 설정값
  action_url:   cta_url     ← canned_responses 설정 URL

렌더링: ActionCard.svelte → canned_cta type → CTA 버튼 표시
        (button_label·action_url 기반 — ctaDefaults fallback과 동일 구조)

관리자 CannedResponsePanel:
  cta_label·cta_url 입력 → 저장 → 해당 빠른답변 자동매칭 시 CTA 버튼 포함 발송

GATE C 확인 항목:
  [ ] canned_responses 테이블에 cta_label, cta_url 컬럼 존재 (Migration 232)?
  [ ] cta_label이 있는 응답 → action_payload.type = 'canned_cta' 발행?
  [ ] ActionCard에서 canned_cta 렌더링 (CTA 버튼 표시)?
```

---

*chat.md | PRD.1.7 채팅 시스템 도메인 정본 | Harness Flow v3.2*
*참조: CLAUDE.md → 에이전트 호출 규칙 | core-rules.md → 스택 규칙*
*계획 파일: crazyshot-re_v1.56-plannode-tree.json (PRD.1.7 노드)*
*2026-08-13 Phase 2~3 CRITICAL 6기능 도메인 정본 추가 (§17, M1-M3/L1-L3 QA Fix)*
*2026-08-19 회원/비회원 소통 로직 전역감사(4개 병렬 에이전트) 반영 — §14에 웹 푸시 커버리지
공백 3건(신규 라이프사이클 3종 문구 누락→수정, AI/캔드매칭/쿠폰/연체료/서명완료 카드
푸시 미연결→미착수) 기록 + §15 GATE C에 "자동응답·긴급판정" 섹션 신설(캔드매칭 히트 시
CS_ESCALATE 인텐트로그·admin_id 기반 응답판정·푸시 이중동기화 체크항목 3건, 상세는
service-operations.md §13③④·§15가 정본).*
*2026-08-19(같은 날 후속) §14 — 미연결 5종(AI자유응답·캔드매칭·쿠폰선물·연체료안내·서명완료
카드) push 연결 완료로 갱신 + iOS Safari 웹푸시 구조적 미작동 진단 신규 추가(manifest.json·
아이콘 자산 부재로 "홈 화면 추가" 자체가 안 돼 iOS는 푸시 원천 불가, Android Chrome은 정상 —
해소는 신규 브랜드 자산 필요한 별건, Stephen 승인 대기).*
*2026-08-19(같은 날 3차 후속) §14 — Stephen 제공 로고 SVG 기반 아이콘 세트 제작(resvg-js) +
manifest.json·app.html 메타태그 적용으로 iOS "홈 화면에 추가" 최소 요건 충족(1단계 해소) —
안내 UI 배너(2단계)는 여전히 별건 승인 대기로 갱신.*
*2026-08-19(같은 날 4차 후속) §14 — IosAddToHomeScreenBanner.svelte 신설로 2단계까지 해소
완료 반영(iOS Safari 웹푸시 대응 완전 종료).*
*2026-09-02 §9-1 신설 — 낙관적 사용자 메시지와 Realtime 경쟁으로 인한 "중복 노출 후 사라짐"
결함 발견·수정(pushMessage() temp 치환 로직) 반영 + §14-1 신설 — 포그라운드 안내 토스트
문구 3종 단일화(pushToastMessage.ts) 반영 + GATE C 체크리스트 2건 추가.*
