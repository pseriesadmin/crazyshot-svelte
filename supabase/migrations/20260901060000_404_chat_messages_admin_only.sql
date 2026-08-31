-- Migration #404: chat_messages admin_only 컬럼 + RLS 수정
-- Stage 1 RSV-B-C1 후속: 환불 실패 시 관리자 전용 채팅 카드 구현
--
-- 목적:
--   1. admin_only BOOLEAN 컬럼 추가 — true이면 해당 메시지는 관리자만 조회 가능
--   2. participant_select_messages RLS를 재정의해 고객은 admin_only=true 메시지를 볼 수 없게 함
--   3. CMS 관리자(cms_role IS NOT NULL)는 여전히 모든 메시지 조회 가능
--
-- 사용 사례: 환불 RPC 3회 재시도 전부 실패 시 payment/+server.ts가
--   admin_only=true인 action_card(refund_failed 타입)를 삽입 →
--   관리자 채팅 패널에만 "환불실패확인" 버튼 카드가 보이고 고객 채팅에는 노출 안 됨.

-- 1. admin_only 컬럼 추가
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS admin_only BOOLEAN NOT NULL DEFAULT false;

-- 인덱스: admin_only=true 메시지 조회 최적화 (admin 패널에서 필터링 시 활용)
CREATE INDEX IF NOT EXISTS idx_chat_messages_admin_only
  ON chat_messages (session_id, admin_only)
  WHERE admin_only = true;

-- 2. participant_select_messages RLS 재정의
--    고객(user_id=auth.uid()) → admin_only=false인 메시지만 조회 가능
--    CMS 관리자(cms_role IS NOT NULL) → 모든 메시지 조회 가능(admin_only 포함)
DROP POLICY IF EXISTS "participant_select_messages" ON chat_messages;

CREATE POLICY "participant_select_messages" ON chat_messages
  FOR SELECT USING (
    -- CMS 관리자: admin_only 포함 모든 메시지 열람
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
    )
    OR
    -- 고객(세션 참여자): admin_only=false인 메시지만 열람
    (
      EXISTS (
        SELECT 1 FROM chat_sessions cs
        WHERE cs.id = session_id
          AND (cs.user_id = auth.uid() OR cs.admin_id = auth.uid())
      )
      AND NOT admin_only
    )
  );

-- 3. 기존 participant_insert_message는 변경 없음 (고객은 admin_only=false만 INSERT 가능)
--    service_role은 RLS를 bypass하므로 admin_only=true INSERT가 가능
