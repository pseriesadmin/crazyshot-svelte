-- Migration #622: sms_notification_logs — 라이프사이클 SMS 중복 방지 로그
-- 같은 날(KST) 동일 (reservation_id, notify_type) 조합은 1회만 발송하도록 dedup index.
-- contract_link 타입 및 force 플래그는 이 dedup을 우회할 수 있음 (앱코드 제어).
-- 서비스 롤 전용 — 브라우저 직접 접근 불가 (RLS ON, 정책 없음).

CREATE TABLE IF NOT EXISTS sms_notification_logs (
  id              BIGSERIAL PRIMARY KEY,
  reservation_id  BIGINT       NOT NULL,
  user_id         UUID         NOT NULL,
  notify_type     TEXT         NOT NULL,
  phone_masked    TEXT,          -- 마지막 4자리만 저장 (***-****-5678 형태)
  status          TEXT         NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- KST 기준 같은 날에 동일 (reservation_id, notify_type) 중복 방지
-- status='sent' 행에만 적용 (failed 행은 재시도 허용), contract_link는 재발송 허용이라 제외
CREATE UNIQUE INDEX IF NOT EXISTS sms_notification_logs_dedup_idx
  ON sms_notification_logs (reservation_id, notify_type, (DATE(created_at AT TIME ZONE 'Asia/Seoul')))
  WHERE status = 'sent' AND notify_type <> 'contract_link';  -- 계약서 재발송은 같은 날 여러 번 허용

-- RLS 활성화 — 정책 없으므로 service_role만 접근 가능
ALTER TABLE sms_notification_logs ENABLE ROW LEVEL SECURITY;

-- 클라이언트 롤 권한 명시 회수(service-operations.md §23) 후 서비스 롤 전용 접근 부여
REVOKE ALL ON sms_notification_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE sms_notification_logs_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON sms_notification_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE sms_notification_logs_id_seq TO service_role;

-- ROLLBACK: DROP TABLE sms_notification_logs;
