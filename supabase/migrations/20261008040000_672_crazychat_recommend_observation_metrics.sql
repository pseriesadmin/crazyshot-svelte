-- Migration #672: 크레이지챗 추천형 재보정용 관찰 메트릭 컬럼 (2026-10-08)
-- 목적: 추천 점수 하한(RECOMMEND_MIN_SCORE=4, Stage 데이터로 보정된 값)을 Production 실제 질문으로 다시 맞추려면
--   질문별 검색 점수와 후보 상품을 모아야 한다. 관찰 기록(crazychat_query_observations)에 숫자·상품 id만 추가한다.
--   ⛔ 고객 질문 원문·검색어 원문은 저장하지 않는다(질문은 chat_messages.id로만 연결 — 관리자가 이미 보는 대화).
--   · top_score        : 최고 검색 점수
--   · card_scores      : 상위 3개 후보 점수(카드 발송 여부와 무관 — 하한 미달로 탈락한 후보 포함)
--   · product_ids      : 상위 3개 후보 상품 id (FK 없음 — 상품이 삭제돼도 기록 유지)
--   · min_score_used   : 그 시점에 적용된 점수 하한
--   · expanded         : 확정 동의어 변형 검색어가 사용됐는지
-- 전부 널 허용 컬럼 추가뿐이라 기존 행·기존 코드에 영향 없음. 테이블은 이미 RLS 켜짐·정책 없음·서버 전용(Migration 664)이며
-- 컬럼 추가는 테이블 권한을 바꾸지 않는다. 코드가 이 마이그레이션보다 먼저 배포돼도 recordObservation이
-- 메트릭 컬럼 없음 오류(42703/PGRST204)를 감지해 메트릭 없이 재시도하므로 관찰 기록은 사라지지 않는다.
ALTER TABLE public.crazychat_query_observations
  ADD COLUMN IF NOT EXISTS top_score      numeric,
  ADD COLUMN IF NOT EXISTS card_scores    numeric[],
  ADD COLUMN IF NOT EXISTS product_ids    uuid[],
  ADD COLUMN IF NOT EXISTS min_score_used numeric,
  ADD COLUMN IF NOT EXISTS expanded       boolean;

COMMENT ON COLUMN public.crazychat_query_observations.top_score IS
  '추천형: 최고 검색 점수(재보정용). 추천형 외 분류는 NULL.';
COMMENT ON COLUMN public.crazychat_query_observations.card_scores IS
  '추천형: 상위 3개 후보 점수(발송 여부와 무관).';
COMMENT ON COLUMN public.crazychat_query_observations.product_ids IS
  '추천형: 상위 3개 후보 상품 id(발송 여부와 무관, FK 없음).';
COMMENT ON COLUMN public.crazychat_query_observations.min_score_used IS
  '추천형: 기록 시점에 적용된 점수 하한.';
COMMENT ON COLUMN public.crazychat_query_observations.expanded IS
  '추천형: 확정 동의어 변형 검색어를 사용했는지.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE public.crazychat_query_observations
--   DROP COLUMN IF EXISTS top_score,
--   DROP COLUMN IF EXISTS card_scores,
--   DROP COLUMN IF EXISTS product_ids,
--   DROP COLUMN IF EXISTS min_score_used,
--   DROP COLUMN IF EXISTS expanded;
-- ============================================================
