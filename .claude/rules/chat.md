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

전환 규칙:
  사용자 메시지 + CS_ESCALATE     → pending
  사용자 메시지 + 비-에스컬레이션 + pending → open
  사용자 메시지 + 비-에스컬레이션 + open   → open (유지)
  사용자 메시지 + closed (race)            → open (자동 재활성화)

  관리자 메시지 (텍스트·첨부) + closed  → open
  관리자 메시지 (텍스트·첨부) + pending → open
  관리자 메시지 + open                  → open (유지)

  1시간 비활성 (auto_pending_inactive_sessions) → pending
  관리자 닫기 버튼                              → closed

신규 세션 생성 조건 (유일):
  - 로그인 사용자: 동일 context_type+context_id에 세션이 전혀 없을 때만
  - 게스트: 새 anon auth 발급 후 첫 채팅 시
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
    1. 세션 소유자 확인
    2. closed 세션 → 자동 open 전환 (race condition 대비)
    3. 사용자 메시지 INSERT
    4. Claude API (claude-haiku-4-5) Intent Classifier 호출
    5. confidence < 0.6 → CS_ESCALATE 강제
    6. CS_ESCALATE → status=pending / 비-에스컬레이션+pending → status=open
    7. AI 응답 메시지 INSERT
    8. chat_intent_logs INSERT

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
  CS_ESCALATE         → pending 전환 (관리자 개입 필요)
  GENERAL             → 일반 텍스트 응답

confidence < 0.6 → CS_ESCALATE 강제
CS_ESCALATE      → session.status = 'pending' (대기 탭)
비-에스컬레이션 + pending → session.status = 'open' (진행중 탭)
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
  → open + updated_at < now() - 1hr → pending
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

⏳ 미구현 (다음 사이클):
   - 웹 푸시 알림 (FCM) 연동
   - 카카오 알림톡 fallback 자동 발송
   - cs_records 관리자 CS 기록 저장
   - 액션 카드 만료 처리 로직
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

UI
[ ] sender_type = 'ai' 관리자 패널 미표시?
[ ] 더블체크 = is_read Realtime UPDATE 실시간 반영?
[ ] 미읽음 전파 애니메이션 = cs-red-badge 80% 투명도?
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

*chat.md | PRD.1.7 채팅 시스템 도메인 정본 | Harness Flow v3.2*
*참조: CLAUDE.md → 에이전트 호출 규칙 | core-rules.md → 스택 규칙*
*계획 파일: crazyshot-re_v1.56-plannode-tree.json (PRD.1.7 노드)*
