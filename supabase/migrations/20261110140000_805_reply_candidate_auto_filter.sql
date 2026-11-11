-- Migration 805: 빠른답변 후보 자동 선별 — 제외 사유 기록 컬럼 + 후보 등록 함수 확장
--
-- 배경(2026-11-10): 관리자가 직접 쓴 답변이 인사·확인·이미지·개별 응대까지 전부 후보로 쌓여 목록이 오염됐다.
-- 서버(/api/chat/admin-reply)가 판정(replyCandidateFilter.ts)한 결과를 이 함수로 넘긴다.
--   · 통과 → 기존처럼 pending 으로 등록
--   · 제외 → status='rejected' + reject_reason 으로 남겨 CMS 에서 "무엇을 왜 걸렀는지" 건수로 확인 (삭제 아님)
-- 배포 순서: 이 마이그레이션을 코드보다 먼저 적용한다(옛 코드의 6개 인자 호출도 기본값으로 그대로 동작).

ALTER TABLE public.chat_reply_candidates
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

COMMENT ON COLUMN public.chat_reply_candidates.reject_reason IS
  '자동 선별로 제외된 사유 코드(attachment_only·system_phrase·greeting_ack·personal_info·individual_case·pair_mismatch·low_value). 수동 거부는 NULL.';

DROP FUNCTION IF EXISTS public.record_chat_reply_candidate(UUID, UUID, TEXT, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.record_chat_reply_candidate(
  p_session_id          UUID,
  p_customer_message_id UUID,
  p_customer_message    TEXT,
  p_admin_message_id    UUID,
  p_admin_reply         TEXT,
  p_admin_id            UUID,
  p_reject_reason       TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_customer_message IS NULL OR length(trim(p_customer_message)) < 2 THEN
    RETURN;
  END IF;
  IF p_admin_reply IS NULL OR length(trim(p_admin_reply)) < 2 THEN
    RETURN;
  END IF;
  IF p_reject_reason IS NOT NULL AND p_reject_reason NOT IN (
    'attachment_only', 'system_phrase', 'greeting_ack', 'personal_info',
    'individual_case', 'pair_mismatch', 'low_value'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.chat_reply_candidates (
    session_id, customer_message_id, customer_message,
    admin_message_id, admin_reply, admin_id,
    status, reject_reason, resolved_at
  ) VALUES (
    p_session_id, p_customer_message_id, trim(p_customer_message),
    p_admin_message_id, trim(p_admin_reply), p_admin_id,
    CASE WHEN p_reject_reason IS NULL THEN 'pending' ELSE 'rejected' END,
    p_reject_reason,
    CASE WHEN p_reject_reason IS NULL THEN NULL ELSE NOW() END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_chat_reply_candidate(UUID, UUID, TEXT, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_chat_reply_candidate(UUID, UUID, TEXT, UUID, TEXT, UUID, TEXT)
  TO service_role;
