-- Migration 536: subscription_benefit_usage — 구독 혜택 월간 사용횟수 공용 추적 테이블
--   (구독 "혜택관리" 4종 실적용 마스터플랜 Phase 2/6 — ancient-pondering-salamander.md 참고)
--
-- 배경: DISCOUNT_COUPON(월 발행횟수)·FREE_SHIPPING(월 제한횟수)·FREE_RENTAL(월 제한횟수)
-- 3개 혜택 모두 "이번 달에 몇 번 썼는지" 카운트가 필요하다. Migration 223(구독 혜택 스키마
-- 최초 도입) 당시 "혜택 소진 추적용 테이블은 의도적으로 만들지 않았다(YAGNI, 체크아웃 통합은
-- 범위 밖)"고 명시돼 있었는데(223 주석 12-14행), 이번이 바로 그 유보된 범위를 채우는
-- 작업이다. 3개 혜택에 각각 별도 테이블을 두지 않고 benefit_type 컬럼으로 구분하는 공용
-- 테이블 하나로 통일한다.
--
-- ⛔ 이 테이블은 아직 어떤 앱 코드에서도 참조되지 않는다(Phase 3/5/6에서 소비 예정) —
-- 신규 테이블 추가만이라 기존 로직에 영향 없이 안전하게 선배포 가능.
--
-- 카운트 조회 패턴(소비 시점 Phase에서 그대로 사용):
--   SELECT COUNT(*) FROM subscription_benefit_usage
--   WHERE user_subscription_id = ? AND benefit_type = ?
--     AND used_month = date_trunc('month', now())::date

CREATE TABLE IF NOT EXISTS public.subscription_benefit_usage (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_subscription_id BIGINT NOT NULL REFERENCES public.user_subscriptions(id),
  benefit_type         TEXT NOT NULL CHECK (benefit_type IN ('DISCOUNT_COUPON', 'FREE_SHIPPING', 'FREE_RENTAL')),
  ref_id               UUID,   -- 연결된 user_coupon_id(쿠폰) 또는 order_id/reservation_id를
                                -- 문자열화해 참조(대상 테이블이 혜택 종류마다 달라 다형 FK를
                                -- 걸 수 없음 — 대신 benefit_type과 조합해 애플리케이션 레벨에서
                                -- 해석). BIGINT PK 대상(order_id/reservation_id)도 있어 FK
                                -- 제약은 걸지 않고 순수 참조용 값으로만 저장.
  used_month           DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_benefit_usage_lookup
  ON public.subscription_benefit_usage (user_subscription_id, benefit_type, used_month);

ALTER TABLE public.subscription_benefit_usage ENABLE ROW LEVEL SECURITY;

-- service_role 전용(직접 조회 API 없음) — 정책을 하나도 만들지 않아 RLS가 anon/authenticated
-- 어떤 접근도 기본 거부한다. service_role은 RLS를 우회하므로 서버 RPC(SECURITY DEFINER)만
-- 이 테이블을 읽고 쓸 수 있다. 필요 시 후속 세션에서 "본인 조회" CMS/마이페이지 표시용
-- SELECT 정책을 추가할 수 있다.

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP TABLE IF EXISTS public.subscription_benefit_usage;
-- ============================================================
