-- 689_nlsearch_settings.sql
-- A-3(2026-10-10): 검색 튜닝 파라미터(boost·fuzzy·prefix·의미 점수 자리) 외부화.
--  · nlsearch_settings: 싱글턴(id=1) 현재 값. 값이 없거나 읽기 실패 시 앱은 코드 기본값(= 기존 동작)을 쓴다.
--  · nlsearch_settings_history: 추가 전용 변경 이력(applied/proposed/restored). 튜닝 스크립트의 제안(proposed)도 여기에 쌓는다.
--  · cms_save_nlsearch_settings: 저장 + 이력 기록을 한 트랜잭션으로(service_role 전용). 범위 검증은 앱(validateNlsearchParams)이 한다.
-- 권한: RLS ON·정책 0건·anon/authenticated 권한 없음(service_role 전용).
-- 롤백: DROP FUNCTION public.cms_save_nlsearch_settings(jsonb, uuid, text, text);
--       DROP TABLE public.nlsearch_settings_history; DROP TABLE public.nlsearch_settings;

CREATE TABLE IF NOT EXISTS public.nlsearch_settings (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  params      jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  version     integer     NOT NULL DEFAULT 0,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nlsearch_settings_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version     integer     NOT NULL,
  params      jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  status      text        NOT NULL CHECK (status IN ('applied', 'proposed', 'restored')),
  reason      text,
  metrics     jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nlsearch_settings_history_created_idx
  ON public.nlsearch_settings_history (created_at DESC);

ALTER TABLE public.nlsearch_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nlsearch_settings_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nlsearch_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.nlsearch_settings_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.nlsearch_settings TO service_role;
GRANT SELECT, INSERT ON public.nlsearch_settings_history TO service_role;

-- 이력은 추가 전용: UPDATE·DELETE·TRUNCATE 차단
CREATE OR REPLACE FUNCTION private.nlsearch_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'nlsearch_settings_history is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_nlsearch_history_no_update ON public.nlsearch_settings_history;
CREATE TRIGGER trg_nlsearch_history_no_update
  BEFORE UPDATE OR DELETE ON public.nlsearch_settings_history
  FOR EACH ROW EXECUTE FUNCTION private.nlsearch_history_append_only();

DROP TRIGGER IF EXISTS trg_nlsearch_history_no_truncate ON public.nlsearch_settings_history;
CREATE TRIGGER trg_nlsearch_history_no_truncate
  BEFORE TRUNCATE ON public.nlsearch_settings_history
  FOR EACH STATEMENT EXECUTE FUNCTION private.nlsearch_history_append_only();

-- 저장: status='applied'|'restored'는 현재 값을 바꾸고 버전을 올린다. 'proposed'는 이력에만 기록(현재 값 불변).
CREATE OR REPLACE FUNCTION public.cms_save_nlsearch_settings(
  p_params  jsonb,
  p_user_id uuid,
  p_status  text DEFAULT 'applied',
  p_reason  text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version integer;
BEGIN
  IF p_status NOT IN ('applied', 'proposed', 'restored') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;
  IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' THEN
    RAISE EXCEPTION 'params must be a json object';
  END IF;

  INSERT INTO public.nlsearch_settings (id, params, version)
  VALUES (1, '{}'::jsonb, 0)
  ON CONFLICT (id) DO NOTHING;

  IF p_status = 'proposed' THEN
    SELECT version INTO v_version FROM public.nlsearch_settings WHERE id = 1 FOR SHARE;
  ELSE
    UPDATE public.nlsearch_settings
       SET params = p_params, version = version + 1, updated_by = p_user_id, updated_at = now()
     WHERE id = 1
     RETURNING version INTO v_version;
  END IF;

  INSERT INTO public.nlsearch_settings_history (version, params, status, reason, created_by)
  VALUES (v_version, p_params, p_status, p_reason, p_user_id);

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.cms_save_nlsearch_settings(jsonb, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cms_save_nlsearch_settings(jsonb, uuid, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_save_nlsearch_settings(jsonb, uuid, text, text) TO service_role;
