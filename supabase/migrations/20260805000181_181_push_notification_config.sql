-- Migration #181: push_notification_config 테이블 + notification_tokens 제약 보정
-- 배경: CMS 전역 FCM 푸시알림 연동 (S1) — .claude/harness/TASK.md "CMS 전역 FCM 푸시알림 연동" 참고
--       notification_tokens(#22)/notification_logs(#23)/allow_rental_alert·allow_benefit_alert(#133)는
--       기존 스캐폴딩을 그대로 재사용 — 재생성하지 않음

-- ──────────────────────────────────────────────
-- 0. notification_tokens 제약 보정: UNIQUE(user_id, token) → UNIQUE(token)
-- ──────────────────────────────────────────────
-- 원인: 동일 브라우저 재로그인(계정 전환) 시 같은 FCM 토큰이 이전 user_id 행에 남아있으면
--   두 사용자 모두에게 발송되는 오발송 위험. UNIQUE(token) 단일 제약으로 register_push_token
--   RPC가 ON CONFLICT(token) DO UPDATE로 소유자를 항상 최신 로그인 사용자로 갱신하도록 함.
--   테이블 실사용 이력 0건(그린필드 상태) — 데이터 손실 위험 없음.
ALTER TABLE notification_tokens DROP CONSTRAINT IF EXISTS notification_tokens_user_id_token_key;
ALTER TABLE notification_tokens ADD CONSTRAINT notification_tokens_token_key UNIQUE (token);

-- ──────────────────────────────────────────────
-- 1. push_notification_config 테이블
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_notification_config (
  id           BIGSERIAL PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('customer_lifecycle', 'customer_marketing')),
  notify_type  TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE push_notification_config IS
  'CMS 설정/푸시알림 탭에서 관리하는 이벤트별 발송 마스터 스위치 (고객 라이프사이클 + 마케팅)';

ALTER TABLE push_notification_config ENABLE ROW LEVEL SECURITY;

-- service_role만 접근 (CMS 서버 액션 경유) — anon/authenticated 직접 접근 차단 (defense-in-depth,
-- service_role 커넥션은 RLS를 우회하므로 실질적으로는 CMS 설정 페이지 서버 코드만 도달 가능)
CREATE POLICY "push_notification_config: service_role 전용" ON push_notification_config
  FOR ALL USING (false);

-- ──────────────────────────────────────────────
-- 2. seed — 기존 채팅 notify_type과 1:1 동일 목록 (rental-lifecycle.md 매핑표 기준)
-- ──────────────────────────────────────────────
INSERT INTO push_notification_config (category, notify_type, label) VALUES
  ('customer_lifecycle', 'reservation_hold',     '예약 신청 접수'),
  ('customer_lifecycle', 'reservation_approval', '예약 승인'),
  ('customer_lifecycle', 'shipment_notify',      '반출(배송) 알림'),
  ('customer_lifecycle', 'rental_confirm',       '대여 시작(수령확인)'),
  ('customer_lifecycle', 'return_registration',  '반납 접수 요청'),
  ('customer_lifecycle', 'return_remind',        '반납 예정 알림'),
  ('customer_lifecycle', 'rental_complete',      '대여 종료'),
  ('customer_marketing', 'event_coupon_issued',  '이벤트·쿠폰 발행')
ON CONFLICT (notify_type) DO NOTHING;

-- rollback:
-- DROP TABLE IF EXISTS push_notification_config;
-- ALTER TABLE notification_tokens DROP CONSTRAINT IF EXISTS notification_tokens_token_key;
-- ALTER TABLE notification_tokens ADD CONSTRAINT notification_tokens_user_id_token_key UNIQUE (user_id, token);
