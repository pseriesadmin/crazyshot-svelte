-- Migration #764: 고객 발신 상담 메시지의 위조 가능 컬럼 잠금 (2026-10-24, sp3 #761 검수 MINOR — 고객 user 발신 message_type·action_payload·admin_only 위조)
-- 배경: #761 로 sender_type='ai' 위조는 막았지만, 고객이 sender_type='user' 로 action_payload(액션 카드)·message_type='action_card'·admin_only·deleted_* 를 직접 넣을 수 있었다.
--       위조된 액션 카드가 관리자 화면에서 정상 카드처럼 렌더링될 수 있다.
-- 앱 경로: 고객 메시지는 서버가 사용자 세션으로 message_type='text'(일반) 또는 'image'(첨부) 만 넣고 action_payload 는 넣지 않는다(api/chat/message·api/chat/attachment). 카드·알림은 전부 서비스 롤/DEFINER 함수가 넣는다.
-- 변경: 고객 발신 분기에 message_type IN ('text','image') AND action_payload IS NULL AND admin_only 아님 AND deleted_* 없음을 추가(관리자 발신 분기는 그대로).
DROP POLICY IF EXISTS participant_insert_message ON public.chat_messages;
CREATE POLICY participant_insert_message ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    (
      sender_type = 'user'::chat_sender_type_enum
      AND message_type::text IN ('text', 'image')
      AND action_payload IS NULL
      AND admin_only IS NOT TRUE
      AND deleted_at IS NULL
      AND deleted_by IS NULL
      AND EXISTS (SELECT 1 FROM public.chat_sessions cs WHERE cs.id = chat_messages.session_id AND cs.user_id = auth.uid())
    )
    OR (
      sender_type = 'admin'::chat_sender_type_enum
      AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL)
    )
  );
-- ROLLBACK: #761 의 participant_insert_message 정의(위 추가 조건 없음)로 되돌린다 — 되돌리면 위조 액션 카드 구멍이 다시 열린다.
