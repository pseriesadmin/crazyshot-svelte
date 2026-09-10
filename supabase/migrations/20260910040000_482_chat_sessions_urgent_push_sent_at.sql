-- Migration #482: chat_sessions.urgent_push_sent_at — 긴급상담 관리자 푸시 "최초 1회만
-- 발송" dedupe 컬럼 (sp3-qa-agent GATE E 검수로 발견된 공백 보완, 2026-09-10)
--
-- 배경: Migration #481이 추가한 admin_id IS NULL 게이트는 "관리자가 그 세션에 한 번이라도
-- 응답하면 이후 영구 스킵"만 보장할 뿐, "관리자 미응답 상태에서 최초 1회만 발송"이라는
-- 원 계획서 요구사항(스팸 방지 필수)을 충족하지 못했다 — 현재 ANTHROPIC_ENABLED=false로
-- 캔드매칭에 안 걸리는 거의 모든 메시지가 CS_ESCALATE로 분류되는 상황과 결합하면, 관리자가
-- 응답하기 전까지 고객이 메시지를 보낼 때마다 매번 전체 관리자에게 푸시가 재발송되는
-- 알림 폭주(alert fatigue) 결함이 코드 추적으로 확인됨.
--
-- 이 컬럼은 sendUrgentChatAdminPush(src/lib/server/push.ts)가 발송 직전 NULL 여부를
-- 확인하고, 발송 성공 직후 채워 이후 재호출을 차단한다. admin_id가 채워지면(관리자 응답)
-- 그 자체로 영구 스킵되므로 이 컬럼을 별도로 초기화(리셋)할 필요는 없다.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS urgent_push_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN chat_sessions.urgent_push_sent_at IS
  '긴급상담(CS_ESCALATE) 관리자 푸시를 이 세션에서 최초로 발송한 시각. NULL이면 아직
   미발송(발송 대상) — 관리자가 한 번이라도 응답(admin_id 채워짐)하기 전까지 재발송을
   막는 dedupe 용도. Migration #481의 admin_id IS NULL 게이트와 함께 사용됨.';

-- rollback:
-- ALTER TABLE chat_sessions DROP COLUMN IF EXISTS urgent_push_sent_at;
