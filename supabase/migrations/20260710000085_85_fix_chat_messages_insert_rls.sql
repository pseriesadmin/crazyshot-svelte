-- migration #85: chat_messages INSERT RLS 수정
-- 버그: migration #34의 participant_insert_message 정책이 cms_role 보유 계정의
--        sender_type='user'/'ai' INSERT를 전면 차단함.
-- 영향: 관리자 계정이 사용자 채팅창(ChatWindow)에서 메시지 전송 시 500 에러 발생.
--
-- 수정: 관리자가 자신의 세션(user_id = auth.uid())에서는 'user'/'ai' INSERT 허용.
--       타 사용자 세션에는 여전히 'admin' 타입만 허용 (스푸핑 방지 유지).

DROP POLICY IF EXISTS "participant_insert_message" ON chat_messages;

CREATE POLICY "participant_insert_message" ON chat_messages
  FOR INSERT WITH CHECK (
    -- 케이스 1: 자신이 user_id인 세션 → sender_type user/ai 허용 (일반 사용자 + 관리자 본인 채팅)
    (
      sender_type IN ('user', 'ai')
      AND EXISTS (
        SELECT 1 FROM chat_sessions cs
        WHERE cs.id = session_id
          AND cs.user_id = auth.uid()
      )
    )
    OR
    -- 케이스 2: 관리자 → 고객 세션에 admin 타입만 허용 (CMS 상담 응답)
    (
      sender_type = 'admin'
      AND EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL
      )
    )
  );

-- 롤백:
-- DROP POLICY IF EXISTS "participant_insert_message" ON chat_messages;
-- CREATE POLICY "participant_insert_message" ON chat_messages
--   FOR INSERT WITH CHECK (
--     CASE
--       WHEN EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL)
--         THEN sender_type = 'admin'
--       ELSE sender_type IN ('user', 'ai') AND EXISTS (
--         SELECT 1 FROM chat_sessions cs WHERE cs.id = session_id AND cs.user_id = auth.uid()
--       )
--     END
--   );
