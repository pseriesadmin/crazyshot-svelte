-- ★ MIGRATION: 374_delivery_fee_discount_tiers_table.sql
-- Description: /cms/set/rental "배송료 우대설정" — 대여금액+조건 만족 시 배송비(왕복+배송+
--   반납 합계)를 할인해주는 조합 규칙 테이블(최대 3개, RPC 레벨 제한은 375에서 부여)
-- Dependencies: 34_is_cms_user, trigger_set_updated_at()
-- Author: Stephen Cconzy
-- Date: 2026-08-29
--
-- ⚠️ 기존 126_rental_settings_tables.sql의 자매 테이블들은 관리자 전체 접근 정책에
--   is_admin()(고객 등급 개념 — CMS 직원 권한과 무관)을 잘못 사용한 알려진 버그 패턴이다
--   (products.md §2-8, security-auth.md에 문서화됨). 이 신규 테이블은 처음부터 올바른
--   is_cms_user()(CMS 직원 여부)를 사용한다 — 기존 버그를 반복하지 않음.

CREATE TABLE IF NOT EXISTS delivery_fee_discount_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_rental_amount INTEGER NOT NULL CHECK (min_rental_amount >= 0),
  condition_type    TEXT NOT NULL CHECK (condition_type IN ('long_term_rental', 'sale_only_purchase')),
  discount_rate     NUMERIC(3,2) NOT NULL CHECK (discount_rate IN (0, 0.5, 1)),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_delivery_fee_discount_tiers_active
  ON delivery_fee_discount_tiers(min_rental_amount)
  WHERE deleted_at IS NULL;

ALTER TABLE delivery_fee_discount_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_fee_discount_tiers: 공개 조회"
  ON delivery_fee_discount_tiers FOR SELECT
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "delivery_fee_discount_tiers: CMS 전체"
  ON delivery_fee_discount_tiers FOR ALL
  USING (is_cms_user());

CREATE TRIGGER set_delivery_fee_discount_tiers_updated_at
  BEFORE UPDATE ON delivery_fee_discount_tiers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ROLLBACK (수동 실행):
-- DROP TABLE IF EXISTS delivery_fee_discount_tiers;
