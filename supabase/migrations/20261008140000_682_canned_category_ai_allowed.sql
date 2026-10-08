-- 682: "크레이지챗 AI가 답해도 되는 분류"를 빠른답변 분류 설정(canned_response_categories)으로 통합
--  · ai_allowed 컬럼 추가(기본 false) + 민감(human_only) 분류는 허용 불가 CHECK
--  · 기존 crazychat_settings.ai_allowed_categories 값으로 시드(사람 전용 주제 제외). 그 컬럼은 폴백용으로 남긴다.
ALTER TABLE public.canned_response_categories
  ADD COLUMN IF NOT EXISTS ai_allowed BOOLEAN NOT NULL DEFAULT false;

UPDATE public.canned_response_categories c
   SET ai_allowed = true
  FROM public.crazychat_settings s
 WHERE c.value = ANY (s.ai_allowed_categories)
   AND c.human_only = false;

ALTER TABLE public.canned_response_categories
  DROP CONSTRAINT IF EXISTS canned_response_categories_ai_not_sensitive;
ALTER TABLE public.canned_response_categories
  ADD CONSTRAINT canned_response_categories_ai_not_sensitive CHECK (NOT (human_only AND ai_allowed));
