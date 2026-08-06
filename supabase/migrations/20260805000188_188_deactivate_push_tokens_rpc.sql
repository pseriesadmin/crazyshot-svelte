-- Migration #188: deactivate_push_tokens RPC
-- 배경: src/lib/server/push.ts가 만료 토큰(messaging/registration-token-not-registered)을
--   비활성화할 때 notification_tokens에 직접 UPDATE하고 있었음 — H-01(직접 DML 금지, RPC 경유만
--   허용) 위반이라 RPC로 교체.
-- ⚠️ 번호 이력: 최초 작성 시 #185로 stage 적용됨 → 동일 세션 시점에 별도 작업(QnA/빠른답변)이
--   같은 #185~187을 이미 점유한 것을 sp3-qa-agent 검수에서 발견 → #188로 재번호(2026-08-05).
--   재번호 전 stage에 남아있던 #185 버전 기록/파일은 함께 정리 대상 — GATE E 재검수 시 확인.

CREATE OR REPLACE FUNCTION public.deactivate_push_tokens(p_tokens TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notification_tokens
  SET is_active = false,
      updated_at = NOW()
  WHERE token = ANY(p_tokens);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_push_tokens(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_push_tokens(TEXT[]) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS public.deactivate_push_tokens(TEXT[]);
