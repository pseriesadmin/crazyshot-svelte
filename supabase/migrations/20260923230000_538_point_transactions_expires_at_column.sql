-- Migration 538: point_transactions.expires_at 컬럼 신설
--   (구독 "혜택관리" 4종 실적용 마스터플랜 Phase 4/6 — ancient-pondering-salamander.md 참고)
--
-- 배경: 구독 혜택 "적립포인트(LOYALTY_POINTS)"는 적립뿐 아니라 유효기간 만료도 요구사항에
-- 포함된다(Stephen 확정). point_transactions.type enum에는 이미 'expire' 값이 정의돼 있으나
-- (Migration #46) 이를 실제로 발생시키는 로직이 프로젝트 전체에 0곳이었다 — 만료시점을
-- 저장할 컬럼 자체가 없었기 때문. 이 마이그레이션은 그 컬럼만 추가한다(로직은 539/540).
--
-- 왜 개별 point_transactions 행에 만료일을 저장하는가(잔액 컬럼 방식이 아닌 이유):
-- 이 프로젝트의 포인트는 "한 덩어리 잔액"이 아니라 적립 건별로 서로 다른 유효기간을 가질 수
-- 있다(구독 혜택 적립만 만료개념이 있고, 대여완료 적립 등 기존 적립은 영구 유효). 만료 처리는
-- 선입선출(FIFO)로 "아직 실제로 소비되지 않은 적립분"만 만료시켜야 하므로, 각 적립 거래 자체에
-- 만료 예정 시각을 남겨두고 만료 크론(Migration 540 expire_due_points)이 전체 이력을 재생
-- (replay)해 판정한다 — user_profiles에 별도 "만료대상 잔액" 컬럼을 두지 않는다(그 방식은
-- use_points 등 기존 결제 크리티컬 RPC를 함께 수정해야 해서 이번 설계에서 의도적으로 배제).
--
-- ⛔ 이번 세션은 stage 검증까지만 — production 마이그레이션 적용은 메인 세션이 배포 지시 시
-- 별도로 처리한다(Stephen 지시, 2026-09-23).

ALTER TABLE public.point_transactions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.point_transactions.expires_at IS
  '적립(type=earn) 건의 유효기간 만료 시각 — 만료개념이 있는 적립(구독 혜택 등)만 값이 있고,
   기존/기타 적립은 NULL(영구 유효). expire_due_points()가 이 값을 기준으로 FIFO 만료 처리.';

-- 만료 크론(Migration 540)의 후보 조회(type='earn' AND expires_at IS NOT NULL AND expires_at <
-- now())를 돕는 부분 인덱스 — 만료개념 없는 절대다수의 기존 적립행은 인덱스 대상에서 제외됨.
CREATE INDEX IF NOT EXISTS idx_point_transactions_expiring
  ON public.point_transactions (expires_at)
  WHERE type = 'earn' AND expires_at IS NOT NULL;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP INDEX IF EXISTS public.idx_point_transactions_expiring;
-- ALTER TABLE public.point_transactions DROP COLUMN IF EXISTS expires_at;
-- ============================================================
