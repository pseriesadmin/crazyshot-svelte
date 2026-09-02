-- Migration 422: 빠른답변 후보(chat_reply_candidates) 테이블 + RPC 3종
--
-- 배경(2026-09-02): AI(Anthropic) 자유응답을 임시 차단하면서, 캔드매칭 실패로 CS_ESCALATE
-- 처리된 고객 메시지에 관리자가 직접 답한 모든 자유텍스트 답변이 학습에 전혀 쓰이지 않고
-- 그냥 사라지는 공백이 생겼다. 관리자의 실제 답변(session_id·직전 고객메시지)을 그대로
-- 후보로 적재해 /cms/chat QnA탭에서 검토 후 원클릭으로 실제 canned_responses 행으로
-- 승격할 수 있게 한다 — NLSearch nlsearch.md "운용 부담 없음" 원칙에 따라 신규 인프라 없이
-- 기존 캔드매칭 테이블·검토 UI 패턴만 재사용.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. 후보 테이블
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_reply_candidates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                  UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  customer_message_id         UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  customer_message             TEXT NOT NULL,
  admin_message_id             UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  admin_reply                  TEXT NOT NULL,
  admin_id                     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status                       TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  created_canned_response_id   UUID REFERENCES public.canned_responses(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at                  TIMESTAMPTZ
);

-- RLS: 활성화 + 정책 없음 → service_role 전용 (cms_login_logs·cms_admin_product_search_
-- confirmations와 동일 패턴). CMS 화면 조회는 +page.server.ts가 service_role로 읽는다.
ALTER TABLE public.chat_reply_candidates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_crc_status  ON public.chat_reply_candidates (status);
CREATE INDEX IF NOT EXISTS idx_crc_session ON public.chat_reply_candidates (session_id);
CREATE INDEX IF NOT EXISTS idx_crc_created ON public.chat_reply_candidates (created_at DESC);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. record_chat_reply_candidate — 관리자 수동답변 발신 시 fire-and-forget 기록
--    (호출부: /api/chat/admin-reply/+server.ts, service_role 클라이언트에서만 호출)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_chat_reply_candidate(
  p_session_id          UUID,
  p_customer_message_id UUID,
  p_customer_message    TEXT,
  p_admin_message_id    UUID,
  p_admin_reply         TEXT,
  p_admin_id            UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 무의미한 신호(너무 짧은 텍스트) 차단
  IF p_customer_message IS NULL OR length(trim(p_customer_message)) < 2 THEN
    RETURN;
  END IF;
  IF p_admin_reply IS NULL OR length(trim(p_admin_reply)) < 2 THEN
    RETURN;
  END IF;

  INSERT INTO public.chat_reply_candidates (
    session_id, customer_message_id, customer_message,
    admin_message_id, admin_reply, admin_id
  ) VALUES (
    p_session_id, p_customer_message_id, trim(p_customer_message),
    p_admin_message_id, trim(p_admin_reply), p_admin_id
  );
END;
$function$;

-- service_role 전용 — is_cms_user() 같은 자체 인증 검사가 없으므로(신뢰된 서버코드 호출 전제)
-- anon·authenticated에 열려있으면 스팸성 후보 주입이 가능해 명시적으로 REVOKE 필수
-- (이 프로젝트 public 스키마 ALTER DEFAULT PRIVILEGES 자동부여 이슈, migration 357과 동일 사유).
REVOKE ALL ON FUNCTION public.record_chat_reply_candidate(UUID, UUID, TEXT, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_chat_reply_candidate(UUID, UUID, TEXT, UUID, TEXT, UUID)
  TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. cms_approve_chat_reply_candidate — 후보 → 실제 canned_responses 행 승격
--    (호출부: /cms/chat/qna, locals.supabase 세션 클라이언트 — is_cms_user()가 auth.uid()에
--    의존하므로 cms_promote_synonym_candidate와 동일 패턴)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_approve_chat_reply_candidate(
  p_id             UUID,
  p_title          TEXT,
  p_content        TEXT,
  p_category       TEXT,
  p_help_category  TEXT,
  p_shortcut       TEXT DEFAULT NULL,
  p_match_keywords TEXT[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  IF p_title IS NULL OR trim(p_title) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '제목을 입력해주세요.');
  END IF;
  IF p_content IS NULL OR trim(p_content) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '내용을 입력해주세요.');
  END IF;
  IF p_help_category IS NULL OR p_help_category NOT IN ('basic', 'members', 'etc') THEN
    RETURN jsonb_build_object('ok', false, 'error', '올바르지 않은 도움말 분류입니다.');
  END IF;
  IF p_category IS NOT NULL
     AND p_category NOT IN ('return', 'payment', 'reservation', 'damage', 'general', 'cs') THEN
    RETURN jsonb_build_object('ok', false, 'error', '올바르지 않은 카테고리입니다.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_reply_candidates WHERE id = p_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 처리된 후보이거나 존재하지 않습니다.');
  END IF;

  INSERT INTO public.canned_responses (
    title, content, category, help_category, shortcut, match_keywords, created_by
  ) VALUES (
    trim(p_title), trim(p_content), p_category, p_help_category,
    NULLIF(trim(COALESCE(p_shortcut, '')), ''), COALESCE(p_match_keywords, '{}'), auth.uid()
  )
  RETURNING id INTO v_new_id;

  UPDATE public.chat_reply_candidates
  SET status = 'approved',
      created_canned_response_id = v_new_id,
      resolved_at = NOW()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'canned_response_id', v_new_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 사용 중인 단축키입니다.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. cms_reject_chat_reply_candidate — 후보 거부
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_reject_chat_reply_candidate(p_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  UPDATE public.chat_reply_candidates
  SET status = 'rejected', resolved_at = NOW()
  WHERE id = p_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 주석
-- ──────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.chat_reply_candidates IS
  '캔드매칭 실패(CS_ESCALATE) 후 관리자가 실제로 자유텍스트 답변한 (고객메시지, 관리자답변)
  쌍을 빠른답변 후보로 적재. /cms/chat QnA탭에서 검토 후 approve 시 canned_responses로 승격.';
