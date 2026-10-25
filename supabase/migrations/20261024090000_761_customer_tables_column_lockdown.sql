-- Migration #761: 고객이 직접 쓸 수 있던 표의 상태·공개·작성자명·발신자 구분 컬럼 잠금 (2026-10-24 권한 감사 1번, Stephen 지시)
--
-- 배경(운영·Stage 실측): 로그인한 모든 계정(익명 로그인 포함)이 아래 표에 직접 INSERT/UPDATE 할 수 있었고, 컬럼 제한이 없었다.
--   product_reviews : is_public·author_name 을 직접 지정 → 심사 우회·타인 이름 사칭    post_comments : author_name·is_public 사칭·공개 우회
--   user_posts      : status·is_public·view_count 직접 지정 → 게시 상태 우회·조회수 조작   cs_posts : status·deleted_at 변경, 본인 글 DELETE
--   foreign_users   : auth_level·verified_at 직접 입력(앱 미사용 표)
--   chat_messages   : sender_type='ai' 로 AI 메시지 위조(INSERT 정책이 user·ai 모두 허용), 본인 세션의 모든 메시지(관리자·AI 발송분 포함) content 등 모든 컬럼 UPDATE
--   chat_sessions   : 생성 시 admin_id·status·closed_at 등 임의 지정
-- 앱 쓰기 경로 확인: 위 5개 표(리뷰·댓글·크레이지로그·문의·외국인)는 앱 코드에 직접 INSERT/UPDATE/DELETE 가 없고 전부 SECURITY DEFINER RPC(create_product_review·create_post_comment·create_user_post·
--   update_user_post·delete_own_post·set_post_public·update_post_status·submit_cs_post)나 service_role 서버 코드로만 쓴다 → 로그인 사용자 직접 쓰기 권한을 통째로 회수해도 정상 기능에 영향 없다(RPC 는 소유자 권한으로 실행).
--   chat_messages 고객 메시지는 서버가 사용자 세션 클라이언트로 sender_type='user' 만 INSERT, AI·자동응답은 서비스 롤, 읽음 표시(is_read)만 브라우저가 UPDATE.
--   chat_sessions 생성은 서버가 사용자 세션으로 user_id·context_*·status='open' 만 INSERT.
-- 변경:
--   ① 5개 표: authenticated 의 INSERT·UPDATE·DELETE 권한 회수 (읽기와 RPC 경로는 그대로)
--   ② chat_messages: INSERT 정책을 "본인 세션에는 user 발신만(ai 위조 금지), 관리자 발신은 cms 계정만"으로 교체 / UPDATE 는 is_read 컬럼만 허용하고 정책 WITH CHECK 도 is_read=true 로 고정
--   ③ chat_sessions: INSERT 컬럼을 앱이 쓰는 5개로 제한하고 정책에 admin_id IS NULL·status='open'·closed_at IS NULL·manual_mode 아님 추가

REVOKE INSERT, UPDATE, DELETE ON public.product_reviews, public.post_comments, public.user_posts, public.cs_posts, public.foreign_users FROM authenticated;

-- ② chat_messages
DROP POLICY IF EXISTS participant_insert_message ON public.chat_messages;
CREATE POLICY participant_insert_message ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    (
      sender_type = 'user'::chat_sender_type_enum
      AND EXISTS (SELECT 1 FROM public.chat_sessions cs WHERE cs.id = chat_messages.session_id AND cs.user_id = auth.uid())
    )
    OR (
      sender_type = 'admin'::chat_sender_type_enum
      AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.cms_role IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS participant_update_read ON public.chat_messages;
CREATE POLICY participant_update_read ON public.chat_messages
  FOR UPDATE
  USING (
    is_cms_user() OR EXISTS (
      SELECT 1 FROM public.chat_sessions cs
      WHERE cs.id = chat_messages.session_id AND (cs.user_id = auth.uid() OR cs.admin_id = auth.uid())
    )
  )
  WITH CHECK (is_read = true);

REVOKE UPDATE ON public.chat_messages FROM authenticated;
GRANT UPDATE (is_read) ON public.chat_messages TO authenticated;

-- ③ chat_sessions
DROP POLICY IF EXISTS user_insert_own_session ON public.chat_sessions;
CREATE POLICY user_insert_own_session ON public.chat_sessions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND admin_id IS NULL
    AND status = 'open'
    AND closed_at IS NULL
    AND manual_mode IS NOT TRUE
  );

REVOKE INSERT ON public.chat_sessions FROM authenticated;
GRANT INSERT (user_id, context_type, context_id, context_reservation_id, status) ON public.chat_sessions TO authenticated;

-- ROLLBACK(필요 시):
--   GRANT INSERT, UPDATE, DELETE ON public.product_reviews, public.post_comments, public.user_posts, public.cs_posts, public.foreign_users TO authenticated;
--   GRANT UPDATE ON public.chat_messages TO authenticated;  GRANT INSERT ON public.chat_sessions TO authenticated;
--   정책은 이전 정의(sender_type IN ('user','ai') 허용)로 되돌리면 AI 위조 구멍이 다시 열린다 — 하지 말 것.
