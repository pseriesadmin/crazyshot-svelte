-- Migration #425: submit_cs_post — 고객 세션에 새던 "관리자 전용" 알림카드 INSERT 제거
--
-- 배경(2026-09-02): Migration 328이 신규 빠른문의 등록 시 관리자에게 알리려고
-- find_or_create_general_chat_session(auth.uid(), NULL)로 세션을 찾아 INQUIRY_NEW_CARD
-- 액션카드를 넣었는데, auth.uid()는 "문의를 작성한 고객 본인"이므로 이 헬퍼가 반환하는
-- 세션은 그 고객의 일반 상담 세션 그 자체다. 이 채팅 스키마는 고객 1명당 세션 1개만
-- 존재하고 "관리자 전용 채널"이라는 개념이 없어(chat_sessions/chat_messages 어디에도
-- audience 구분 컬럼 없음), 관리자에게만 보이길 의도한 이 카드가 고객 본인의 채팅창에도
-- 그대로 노출되는 구조적 결함이었다. 고객이 "빠른문의 답변등록" 버튼을 누르면 cms_role이
-- 없어 CMS 로그인/접근거부 화면으로 튕겨나가는 실사용 버그로 이어짐.
--
-- Stephen 확정: 이 리마인더는 CMS 상담 세션 목록(AdminChatPanel) 사이드바에 별도 카드로
-- 추가하는 방식(관리자 전용 UI, chat_messages와 무관)으로 재구현한다(앱 코드
-- src/routes/api/cms/chat/pending-inquiries/+server.ts 신설 — 이 마이그레이션과 세트).
-- 따라서 이 RPC의 chat_messages INSERT 블록은 더 이상 필요 없어 제거 — Migration 157
-- (20260724000157) 원본 정의로 복원한다(파라미터 시그니처 변경 없음).

CREATE OR REPLACE FUNCTION public.submit_cs_post(
  p_title    TEXT,
  p_content  TEXT,
  p_category TEXT DEFAULT 'general'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO cs_posts (user_id, title, content, category)
  VALUES (auth.uid(), p_title, p_content, p_category)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cs_post TO authenticated;

-- ============================================================
-- ROLLBACK: Migration 328(20260821050000)의 정의로 CREATE OR REPLACE하면 되나,
-- 그건 이번에 제거한 고객세션 오노출 버그가 있는 버전이므로 재적용 비권장.
-- ============================================================
