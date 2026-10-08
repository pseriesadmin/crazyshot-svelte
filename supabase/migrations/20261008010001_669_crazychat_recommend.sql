-- Migration 669: 크레이지챗 추천형(상품 추천 대화카드) 스위치 + 관찰 기록 분류 확장 (2026-10-08, Stephen 승인)
--   · crazychat_settings에 recommend_enabled / recommend_observe 추가(기본 꺼짐) — 마스터가 꺼져 있으면 정지하는 규칙은 그대로
--   · crazychat_query_observations.intent 허용값에 'recommend' 추가(기존 값 전부 유지)
-- 코드 배포 전에 먼저 적용한다(코드는 이 컬럼이 없어도 추천형만 꺼짐으로 처리하도록 폴백이 있지만, 설정 화면 저장은 컬럼이 필요하다).
-- 롤백: ALTER TABLE public.crazychat_settings DROP COLUMN recommend_enabled, DROP COLUMN recommend_observe;
--       intent CHECK는 'recommend'를 뺀 목록으로 재생성.

ALTER TABLE public.crazychat_settings
  ADD COLUMN IF NOT EXISTS recommend_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommend_observe boolean NOT NULL DEFAULT false;

ALTER TABLE public.crazychat_query_observations DROP CONSTRAINT IF EXISTS crazychat_query_observations_intent_check;
ALTER TABLE public.crazychat_query_observations
  ADD CONSTRAINT crazychat_query_observations_intent_check
  CHECK (intent IN ('reservation_status', 'return_date', 'doc_status', 'payment_status', 'time_change', 'extend', 'call_agent', 'doc_guide', 'recommend'));
