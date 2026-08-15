-- Migration #223: CMS '구독' 메뉴 — 구독 티어/혜택/청구 스키마
--
-- 배경: /cms/subscriptions(정기구독 상품/티어 관리) 신설을 위해 기존에 마이그레이션 미추적
--       상태로 스테이지 DB에 존재하던 subscription_plans/user_subscriptions(둘 다 0 rows, 미사용
--       스텁, RLS는 켜져 있으나 정책이 하나도 없어 사실상 전면 차단 상태) 스텁 테이블을 확장.
--       Excel 체크리스트가 전제한 membership_tiers 등 신규 병렬 테이블은 만들지 않음(Stephen 확정
--       — 플랜 users-stevenmac-downloads-crazyshot-bac-effervescent-sun.md §1 참고).
--
-- 범위: ① subscription_plans/user_subscriptions 컬럼 추가
--       ② tier_benefits(혜택타입별 설정) / free_rental_items(무료렌탈 대상 장비) /
--          subscription_payment_logs(정기청구 이력) 신규 테이블 + RLS
--
-- 의도적으로 만들지 않는 것: subscription_benefit_usage(월별 혜택 소진 추적) — 체크아웃/대여신청
--   흐름에 실제로 혜택을 "소진"시키는 통합 자체가 이번 작업 범위 밖이라 아무도 쓰지 않을 테이블을
--   미리 만들지 않음(YAGNI, products.md 스타일 원칙과 동일).
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

-- ── 1. 기존 테이블 확장 ──────────────────────────────────────────────

-- membership_grade_enum(마이그레이션 02) 타입은 실제 스테이지 DB에 존재하지 않는 고아 정의로
-- 확인됨(다른 스키마 드리프트 사례들과 동일 패턴) — 실제 user_profiles.membership_grade는
-- TEXT + CHECK IN ('NONE','EASY','POP','CRAZY')(마이그레이션 98) 이므로 그 실제 도메인에 맞춤
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS membership_grade TEXT
    CHECK (membership_grade IN ('NONE', 'EASY', 'POP', 'CRAZY')),  -- 등급과 연동
  ADD COLUMN IF NOT EXISTS monthly_price INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tagline TEXT,      -- /members 카드 '서브타이틀'
  ADD COLUMN IF NOT EXISTS image_url TEXT,    -- /members 카드 '상품 사진'
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- 기존 description 컬럼 = /members 카드 '서브스크립션'(설명 문구)로 사용
-- 기존 features(JSONB) 컬럼 = '상품 스펙'(라벨:값 리스트) 저장소로 용도 재정의(신규 컬럼 추가 안 함)

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS billing_key TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle_day SMALLINT CHECK (billing_cycle_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS next_billing_date DATE,
  ADD COLUMN IF NOT EXISTS fail_count SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

-- ── 2. 신규 테이블 ──────────────────────────────────────────────────

-- 혜택 타입별 설정 — plan당 benefit_type 하나씩(중복 불가), Excel 체크리스트 파라미터를 JSONB로
CREATE TABLE tier_benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id BIGINT NOT NULL REFERENCES subscription_plans(id),
  benefit_type TEXT NOT NULL CHECK (benefit_type IN
    ('DISCOUNT_COUPON', 'FREE_SHIPPING', 'FREE_RENTAL', 'INSURANCE_WAIVE', 'LOYALTY_POINTS')),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  benefit_params JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, benefit_type)
);

COMMENT ON TABLE tier_benefits IS
  '구독 티어(subscription_plans)별 혜택 설정 — DISCOUNT_COUPON/FREE_SHIPPING/FREE_RENTAL/'
  'INSURANCE_WAIVE/LOYALTY_POINTS 5종, benefit_params 파라미터 정의는 CMS 구독 플랜 참고';

-- FREE_RENTAL 혜택의 대상 장비 — 부모 상품만(products.md §1 부모/자식 원칙과 동일)
CREATE TABLE free_rental_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_benefit_id UUID NOT NULL REFERENCES tier_benefits(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tier_benefit_id, product_id)
);

-- 정기결제 청구 이력 — payment_transactions와 동일 컨벤션, reservation_id 대신 user_subscription_id
CREATE TABLE subscription_payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_subscription_id BIGINT NOT NULL REFERENCES user_subscriptions(id),
  plan_id BIGINT NOT NULL REFERENCES subscription_plans(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  toss_response JSONB,
  billed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_free_rental_items_tier_benefit ON free_rental_items(tier_benefit_id);
CREATE INDEX idx_subscription_payment_logs_user_subscription ON subscription_payment_logs(user_subscription_id);
CREATE INDEX idx_tier_benefits_plan ON tier_benefits(plan_id);

-- ── 3. RLS ──────────────────────────────────────────────────────────

ALTER TABLE tier_benefits ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_rental_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payment_logs ENABLE ROW LEVEL SECURITY;

-- tier_benefits / free_rental_items: 공개 조회 허용(/members 노출용, products 공개정책과 동일 원칙),
-- 쓰기는 is_cms_user() 전용(CMS 직원 권한 — is_admin()이 아님, products.md §2-8 정정 사례와 동일 원칙)
CREATE POLICY "tier_benefits_public_read" ON tier_benefits
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "tier_benefits_admin_write" ON tier_benefits
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());

CREATE POLICY "free_rental_items_public_read" ON free_rental_items
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "free_rental_items_admin_write" ON free_rental_items
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());

-- subscription_payment_logs: 본인 + 관리자(deposit_holds/payment_transactions와 동일 패턴)
CREATE POLICY "subscription_payment_logs: 본인 조회" ON subscription_payment_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_subscriptions us
      WHERE us.id = subscription_payment_logs.user_subscription_id
        AND us.user_id = auth.uid()
    )
  );
CREATE POLICY "subscription_payment_logs: 관리자 전체" ON subscription_payment_logs
  FOR ALL USING (is_admin());

-- subscription_plans / user_subscriptions: 기존 RLS는 켜져 있으나 정책이 전무해 전면 차단
-- 상태였음(0 rows 스텁) — 이번에 실사용을 시작하므로 정책 신설
CREATE POLICY "subscription_plans_public_read" ON subscription_plans
  FOR SELECT TO anon, authenticated USING (status = 'active' AND deleted_at IS NULL);
CREATE POLICY "subscription_plans_admin_write" ON subscription_plans
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());

CREATE POLICY "user_subscriptions: 본인 조회" ON user_subscriptions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_subscriptions: 관리자 전체" ON user_subscriptions
  FOR ALL USING (is_admin());
