-- 733: 채팅 대화카드 개별 삭제(관리자 발송 취소) — 소프트 삭제 + 원본 관리자 전용 보관 (2026-10-20, Stephen 확정)
-- 정책: ① 관리자·시스템·AI가 보낸 대화만 삭제 가능(고객 발신 불가) ② 삭제하면 행을 '대화가 삭제되었습니다.' 시스템 메시지로 교체하고
--       원본(내용·카드 데이터·발신 종류)은 고객이 읽을 수 없는 별도 테이블에 보관 ③ 결제·계약·쿠폰 카드 종류는 삭제 거절.
-- 고객 화면은 chat_messages를 RLS로 직접 읽으므로 "숨김 표시"가 아니라 행 자체를 교체해야 원본이 노출되지 않는다.
-- 이미 나간 문자·푸시·SMS는 회수되지 않는다(이 함수 범위 밖).

-- 1. 삭제 표식 컬럼
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2. 원본 보관 테이블 — 정책 0건(RLS 켜짐) + anon/authenticated 권한 제거 = service_role(서버)만 접근
CREATE TABLE IF NOT EXISTS public.chat_message_deletions (
  message_id              uuid PRIMARY KEY REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  session_id              uuid NOT NULL,
  original_sender_type    text NOT NULL,
  original_message_type   text NOT NULL,
  original_content        text,
  original_action_payload jsonb,
  original_admin_only     boolean NOT NULL DEFAULT false,
  deleted_by              uuid,
  deleted_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_message_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_message_deletions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chat_message_deletions TO service_role;
CREATE INDEX IF NOT EXISTS idx_chat_message_deletions_session ON public.chat_message_deletions (session_id, deleted_at DESC);

-- 3. 삭제 함수 — 서버 전용(SECURITY DEFINER). 막힌 카드 종류 목록은 src/lib/utils/chatMessageDelete.ts와 같아야 한다(테스트가 대조).
CREATE OR REPLACE FUNCTION public.cms_delete_chat_message(p_message_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg  public.chat_messages%ROWTYPE;
  v_type text;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESSAGE_NOT_FOUND';
  END IF;
  IF v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_DELETED';
  END IF;
  IF v_msg.sender_type = 'user' THEN
    RAISE EXCEPTION 'CUSTOMER_MESSAGE_NOT_DELETABLE';
  END IF;

  v_type := v_msg.action_payload->>'type';
  IF v_type IN ('contract_link', 'contract_signed', 'payment_request', 'PAYMENT_REQUEST_CARD',
                'coupon_issued', 'COUPON_GIFT_CARD', 'refund_failed') THEN
    RAISE EXCEPTION 'CARD_TYPE_NOT_DELETABLE:%', v_type;
  END IF;

  INSERT INTO public.chat_message_deletions (
    message_id, session_id, original_sender_type, original_message_type,
    original_content, original_action_payload, original_admin_only, deleted_by
  ) VALUES (
    v_msg.id, v_msg.session_id, v_msg.sender_type::text, v_msg.message_type::text,
    v_msg.content, v_msg.action_payload, COALESCE(v_msg.admin_only, false), p_admin_id
  );

  UPDATE public.chat_messages
     SET content        = '대화가 삭제되었습니다.',
         message_type   = 'system',
         action_payload = jsonb_build_object('type', 'message_deleted'),
         deleted_at     = now(),
         deleted_by     = p_admin_id
   WHERE id = p_message_id;

  RETURN jsonb_build_object('ok', true, 'message_id', p_message_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_delete_chat_message(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_delete_chat_message(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_delete_chat_message(uuid, uuid) TO service_role;

-- ROLLBACK: DROP FUNCTION IF EXISTS public.cms_delete_chat_message(uuid, uuid);
--           DROP TABLE IF EXISTS public.chat_message_deletions;
--           ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by;
