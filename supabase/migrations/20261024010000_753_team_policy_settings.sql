-- Migration #753: '팀 정책' 콘텐츠 설정 신설 (공통 푸터 '소개 > 팀' 모달에 노출)
-- service_info_settings(#566·#567)와 같은 싱글톤 패턴. 내용은 콘텐츠 블록 배열(ContentBlock[], 문서 편집기 저장 형식).
--
-- · 읽기: get_team_policy_settings() — 비로그인 고객도 푸터에서 열람하므로 anon 허용(SECURITY DEFINER, 테이블 직접 접근 없음)
-- · 쓰기: upsert_team_policy_settings(p_blocks) — CMS 사용자만(is_cms_user()), 배열·크기 상한 검증
-- · ⚠️ UPDATE는 반드시 WHERE 절 포함(PostgREST 경로의 safeupdate 확장이 WHERE 없는 UPDATE를 거부 — #567 교훈)
-- · 새 테이블 GRANT 규칙(security-auth.md): 서버 전용 테이블이라 service_role만 명시 부여, RLS 켜고 정책 0건(직접 접근 차단)

CREATE TABLE IF NOT EXISTS public.team_policy_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_policy_settings_blocks_is_array CHECK (jsonb_typeof(content_blocks) = 'array')
);

ALTER TABLE public.team_policy_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_policy_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_policy_settings TO service_role;

INSERT INTO public.team_policy_settings (content_blocks)
SELECT '[]'::jsonb WHERE NOT EXISTS (SELECT 1 FROM public.team_policy_settings);

CREATE OR REPLACE FUNCTION public.get_team_policy_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocks JSONB;
BEGIN
  SELECT content_blocks INTO v_blocks FROM public.team_policy_settings ORDER BY updated_at DESC LIMIT 1;
  RETURN jsonb_build_object('content_blocks', COALESCE(v_blocks, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_policy_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_team_policy_settings() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_team_policy_settings(p_blocks JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
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

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.upsert_team_policy_settings(JSONB);
-- DROP FUNCTION IF EXISTS public.get_team_policy_settings();
-- DROP TABLE IF EXISTS public.team_policy_settings;
