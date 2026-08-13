-- Migration #237: 주간 자동응답(빠른답변) 최다 사용 TOP 10 집계 RPC
--
-- 목적: CMS 대시보드 "상담목록카드 현황" 탭 — 최근 7일간 자동매칭돼 발송된 빠른답변
-- (chat_messages.action_payload->>'type' IN ('auto_canned_reply','canned_cta'), 하이브리드
-- 1단계 자동응답 — src/routes/api/chat/message/+server.ts) 중 가장 많이 쓰인 canned_responses
-- 10건을 반환.
--
-- 참고: canned_responses.usage_count는 생성 이후 누적 총합이라 "주간" 랭킹에 못 씀 —
-- chat_messages.created_at 기준 최근 7일 윈도우로 직접 집계.
--
-- 다른 is_cms_user() 게이트 RPC와 동일 패턴(is_cms_user 정의: 195_is_cms_user_backfill.sql).
-- 반드시 세션이 실린 클라이언트(locals.supabase)로 호출할 것 — service-role admin 클라이언트로
-- 호출하면 auth.uid()가 NULL이라 무조건 ACCESS_DENIED (2026-08-13, Migration #221에서 실사용 중
-- 발견한 것과 동일 함정 — 여기서는 처음부터 올바른 패턴으로 작성).

CREATE OR REPLACE FUNCTION public.get_top_canned_responses_weekly()
RETURNS TABLE (
  canned_response_id UUID,
  title               TEXT,
  category            TEXT,
  reply_count         BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    cr.id                AS canned_response_id,
    cr.title::TEXT        AS title,
    cr.category::TEXT     AS category,
    COUNT(cm.id)          AS reply_count
  FROM chat_messages cm
  JOIN canned_responses cr
    ON cr.id = (cm.action_payload->>'canned_response_id')::UUID
  WHERE cm.action_payload->>'type' IN ('auto_canned_reply', 'canned_cta')
    AND cm.created_at >= now() - INTERVAL '7 days'
  GROUP BY cr.id, cr.title, cr.category
  ORDER BY reply_count DESC
  LIMIT 10;
END;
$$;

COMMENT ON FUNCTION public.get_top_canned_responses_weekly() IS
  'CMS 대시보드 "상담목록카드 현황" 탭 — 최근 7일간 자동매칭 발송된 빠른답변 최다사용 TOP10.
   canned_responses.usage_count(누적 총합)와 달리 항상 최근 7일 롤링 윈도우 기준.';
