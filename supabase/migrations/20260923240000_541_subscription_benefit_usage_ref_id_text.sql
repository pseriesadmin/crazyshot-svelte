-- Migration 541: subscription_benefit_usage.ref_id UUID → TEXT 정정
--   (구독 "혜택관리" 4종 실적용 마스터플랜 — Phase 2(#536) 설계 오류 즉시 수정)
--
-- 배경: Migration 536이 ref_id를 UUID로 선언했으나, 이 컬럼은 혜택 종류마다 참조 대상이
-- 다르다 — DISCOUNT_COUPON은 coupons.id(UUID)를 참조하지만, FREE_SHIPPING(Phase 5)·
-- FREE_RENTAL(Phase 6)은 예약/주문 ID(BIGINT)를 참조해야 한다. UUID 컬럼에는 BIGINT 값을
-- 넣을 방법이 없어 이대로면 Phase 5/6이 아예 동작할 수 없었다.
--
-- 동일 클래스의 선례: point_transactions.ref_id도 원래 UUID였으나 예약/주문 등 BIGINT PK를
-- 담기 위해 Migration #407에서 TEXT로 전환된 바 있다(award_rental_complete_points 도입 시
-- 발견) — 이번에도 동일한 이유로 동일한 해법을 적용한다.
--
-- 안전성: 이 컬럼은 Phase 3(issue_subscription_benefit_coupon, 아직 production 미배포)에서만
-- 쓰기가 예정돼 있고, 실제로 이 마이그레이션 적용 시점까지 stage·production 양쪽 모두
-- 0 rows(신설 테이블, 어떤 코드도 아직 실제로 insert한 적 없음) — 데이터 손실 위험 없이
-- 안전하게 타입 변경 가능. Phase 2(#536) 자체는 이미 stage·production 양쪽에 배포됐으므로
-- (Phase 3 이후와 달리 "개발 보류" 대상이 아니었음) 이 정정도 즉시 양쪽에 반영한다.

ALTER TABLE public.subscription_benefit_usage
  ALTER COLUMN ref_id TYPE TEXT USING ref_id::text;

COMMENT ON COLUMN public.subscription_benefit_usage.ref_id IS
  '연결된 참조값 — DISCOUNT_COUPON은 coupons.id(UUID 문자열), FREE_SHIPPING/FREE_RENTAL은
   예약/주문 ID(BIGINT 문자열). 혜택마다 참조 대상 테이블이 달라 FK 제약 없이 TEXT로 저장.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE public.subscription_benefit_usage ALTER COLUMN ref_id TYPE UUID USING NULL;
-- ============================================================
