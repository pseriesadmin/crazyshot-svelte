-- Migration 663: 크레이지챗 AI 허용 주제 CHECK — 대소문자·앞뒤 공백 우회 차단 (sp3-qa 1차 검수 MINOR-1, 2026-10-07)
--
-- Migration 662의 CHECK는 정확 일치(소문자·공백 없음)만 거부해 'Damage'·' damage' 같은 값이 DB에 저장될 수 있었다
-- (코드는 읽을 때 걸러내지만 "코드·DB 이중 방어" 취지를 살리기 위해 DB도 같은 기준으로 맞춘다).
-- 662 파일은 수정하지 않고 제약만 교체한다. 판정 함수는 순수 함수(테이블 접근 없음)라 CHECK에서 안전하게 쓸 수 있다.
--
-- 롤백: ALTER TABLE public.crazychat_settings DROP CONSTRAINT crazychat_ai_categories_not_human_only;
--       (이후 662의 원래 제약을 쓰려면 662 파일의 CHECK 정의를 다시 ADD)  DROP FUNCTION public.crazychat_has_human_only_topic(text[]);

CREATE OR REPLACE FUNCTION public.crazychat_has_human_only_topic(p_topics text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(
    -- btrim은 공백만 지우므로 탭·줄바꿈까지 JS trim()과 같게 정규식으로 앞뒤 공백류 제거
    bool_or(lower(regexp_replace(t, '^\s+|\s+$', '', 'g')) = ANY (ARRAY['damage','cs','lost','refund','cancel','legal','payment_error','personal_info']::text[])),
    false
  )
  FROM unnest(p_topics) AS t
$$;

REVOKE ALL ON FUNCTION public.crazychat_has_human_only_topic(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crazychat_has_human_only_topic(text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crazychat_has_human_only_topic(text[]) TO service_role;

ALTER TABLE public.crazychat_settings
  DROP CONSTRAINT IF EXISTS crazychat_ai_categories_not_human_only;
ALTER TABLE public.crazychat_settings
  ADD CONSTRAINT crazychat_ai_categories_not_human_only
  CHECK (NOT public.crazychat_has_human_only_topic(ai_allowed_categories));
