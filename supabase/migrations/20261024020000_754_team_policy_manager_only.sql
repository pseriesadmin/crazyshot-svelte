-- Migration #754: '팀 정책' 저장 RPC를 매니저 이상 전용으로 (sp3 검수 MINOR, Stephen 확정 "A. 막기" 2026-10-24)
-- 배경: #753의 upsert_team_policy_settings 는 is_cms_user()(cms_role 보유자 누구나)만 확인해, 화면 저장 액션(manager 이상)과 달리
--       partner(협력사) 계정이 브라우저 세션으로 RPC를 직접 호출하면 공개 푸터 내용을 덮어쓸 수 있었다.
-- 변경: 권한 검사를 is_cms_manager_or_above()(Migration #647, manager·superadmin)로 교체. 시그니처·그 밖의 동작은 #753과 동일.
-- 범위 밖(별건): 같은 구조의 upsert_service_info_settings(#566·#567)는 이번에 바꾸지 않았다.

CREATE OR REPLACE FUNCTION public.upsert_team_policy_settings(p_blocks JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_manager_or_above() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;
  IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_BLOCKS';
  END IF;
  IF jsonb_array_length(p_blocks) > 200 OR octet_length(p_blocks::text) > 1000000 THEN
    RAISE EXCEPTION 'BLOCKS_TOO_LARGE';
  END IF;

  SELECT id INTO v_id FROM public.team_policy_settings ORDER BY updated_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.team_policy_settings SET content_blocks = p_blocks, updated_at = NOW() WHERE id = v_id;
  ELSE
    INSERT INTO public.team_policy_settings (content_blocks) VALUES (p_blocks);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_team_policy_settings(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_team_policy_settings(JSONB) TO authenticated, service_role;

-- ROLLBACK (#753 정의로 되돌리기 — partner 가 다시 저장할 수 있게 되므로 신중히):
-- CREATE OR REPLACE FUNCTION public.upsert_team_policy_settings(p_blocks JSONB)
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- AS $rb$
-- DECLARE v_id UUID;
-- BEGIN
--   IF NOT public.is_cms_user() THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
--   IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RAISE EXCEPTION 'INVALID_BLOCKS'; END IF;
--   IF jsonb_array_length(p_blocks) > 200 OR octet_length(p_blocks::text) > 1000000 THEN RAISE EXCEPTION 'BLOCKS_TOO_LARGE'; END IF;
--   SELECT id INTO v_id FROM public.team_policy_settings ORDER BY updated_at DESC LIMIT 1;
--   IF v_id IS NOT NULL THEN
--     UPDATE public.team_policy_settings SET content_blocks = p_blocks, updated_at = NOW() WHERE id = v_id;
--   ELSE
--     INSERT INTO public.team_policy_settings (content_blocks) VALUES (p_blocks);
--   END IF;
-- END;
-- $rb$;
-- REVOKE ALL ON FUNCTION public.upsert_team_policy_settings(JSONB) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.upsert_team_policy_settings(JSONB) TO authenticated, service_role;
