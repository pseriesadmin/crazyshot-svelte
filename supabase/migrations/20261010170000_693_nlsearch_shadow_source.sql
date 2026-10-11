-- 693_nlsearch_shadow_source.sql
-- C-2(2026-10-10): 그림자 관찰 기록에 출처 구분 추가 — 검색 API(search_api)와 크레이지챗 추천 검색(crazychat_recommend)이 같은 표를 쓴다.
-- 기존 행은 모두 search_api. 롤백: ALTER TABLE public.nlsearch_shadow_observations DROP COLUMN source;
ALTER TABLE public.nlsearch_shadow_observations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'search_api'
  CHECK (source IN ('search_api', 'crazychat_recommend'));
