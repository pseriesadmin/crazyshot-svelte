-- ★ MIGRATION: 140_rental_cms_additions.sql
-- Schema version: v5.53
-- Description: CMS 예약 관리 화면용 신규 테이블 + RPC 추가 (기존 스키마 무수정)
-- Actual DB schema adaptation:
--   rental_reservations.id = BIGINT (not UUID)
--   orders.id = BIGINT, linked via order_items
--   user_profiles.address = TEXT (not JSONB)
--   contracts table: NEW (never applied to DB)
-- Author: Stephen Cconzy
-- Date: 2026-07-22

-- ─────────────────────────────────────────────────────
-- 1. contracts — 전자계약 테이블 (신규, 실제 스키마 기준)
--    migration 21_contracts.sql은 미적용 상태 → 여기서 생성
--    rental_reservations.id가 BIGINT이므로 reservation_id BIGINT 사용
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id    BIGINT      NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  contract_type     TEXT        NOT NULL DEFAULT 'rental'
                                CHECK (contract_type IN ('rental', 'subscription')),
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'cancelled', 'expired')),
  document_url      TEXT,
  signed_at         TIMESTAMPTZ,
  terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contracts_reservation_id ON contracts(reservation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_user_id        ON contracts(user_id)        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_status         ON contracts(status)         WHERE deleted_at IS NULL;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts: 본인 조회" ON contracts
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "contracts: 관리자 전체" ON contracts
  FOR ALL USING (is_cms_admin());

CREATE TRIGGER set_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─────────────────────────────────────────────────────
-- 2. contract_signings — 고객 명시적 서명 추적 (신규)
--    contracts 테이블에 FK, UUID token으로 서명 링크 발송
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_signings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  token       VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  sent_at     TIMESTAMPTZ,
  viewed_at   TIMESTAMPTZ,
  signed_at   TIMESTAMPTZ,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_signings_contract_id ON contract_signings(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_signings_token       ON contract_signings(token);
CREATE INDEX IF NOT EXISTS idx_contract_signings_user_id     ON contract_signings(user_id);

ALTER TABLE contract_signings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contract_signings: 관리자 전체" ON contract_signings
  FOR ALL USING (is_cms_admin());

CREATE POLICY "contract_signings: 본인 조회" ON contract_signings
  FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────
-- 3. get_rental_list — CMS 예약 목록 RPC (신규)
--    실제 스키마 기준:
--      rental_reservations: id BIGINT, start_date/end_date, product_id UUID
--      orders: id BIGINT, final_amount, status TEXT
--      order_items: reservation_id BIGINT → order_id BIGINT
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_rental_list(
  p_status    TEXT    DEFAULT NULL,
  p_search    TEXT    DEFAULT NULL,
  p_date_from DATE    DEFAULT NULL,
  p_date_to   DATE    DEFAULT NULL,
  p_page      INTEGER DEFAULT 1,
  p_per_page  INTEGER DEFAULT 30
)
RETURNS TABLE (
  reservation_id      BIGINT,
  status              TEXT,
  rental_start        DATE,
  rental_end          DATE,
  -- 고객
  user_id             UUID,
  customer_name       TEXT,
  customer_email      TEXT,
  customer_phone      TEXT,
  membership_grade    TEXT,
  credit_score        SMALLINT,
  -- 상품
  product_id          UUID,
  product_name        TEXT,
  product_code        TEXT,
  product_category    TEXT,
  product_image_url   TEXT,
  -- 주문
  order_id            BIGINT,
  order_amount        NUMERIC,
  payment_status      TEXT,
  -- 계약
  contract_id         UUID,
  contract_status     TEXT,
  contract_pdf_url    TEXT,
  auto_signed_at      TIMESTAMPTZ,
  customer_signed_at  TIMESTAMPTZ,
  signing_sent_at     TIMESTAMPTZ,
  signing_token       TEXT,
  -- 메타
  created_at          TIMESTAMPTZ,
  total_count         BIGINT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_cms_admin() THEN
    RAISE EXCEPTION 'permission denied: CMS admin required';
  END IF;

  RETURN QUERY
  SELECT
    rr.id                                       AS reservation_id,
    rr.status                                   AS status,
    rr.start_date                               AS rental_start,
    rr.end_date                                 AS rental_end,
    up.id                                       AS user_id,
    up.full_name                                AS customer_name,
    up.email                                    AS customer_email,
    up.phone                                    AS customer_phone,
    up.membership_grade                         AS membership_grade,
    up.credit_score                             AS credit_score,
    rr.product_id                               AS product_id,
    p.name                                      AS product_name,
    p.product_code                              AS product_code,
    p.category                                  AS product_category,
    (p.image_urls->>0)                          AS product_image_url,
    o.id                                        AS order_id,
    o.final_amount                              AS order_amount,
    o.status                                    AS payment_status,
    c.id                                        AS contract_id,
    c.status                                    AS contract_status,
    c.document_url                              AS contract_pdf_url,
    c.signed_at                                 AS auto_signed_at,
    cs.signed_at                                AS customer_signed_at,
    cs.sent_at                                  AS signing_sent_at,
    cs.token                                    AS signing_token,
    rr.created_at                               AS created_at,
    COUNT(*) OVER ()                            AS total_count
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id
  JOIN user_profiles up ON up.id = rr.user_id
  LEFT JOIN order_items oi ON oi.reservation_id = rr.id
  LEFT JOIN orders o ON o.id = oi.order_id
  LEFT JOIN contracts c ON c.reservation_id = rr.id
  LEFT JOIN contract_signings cs ON cs.contract_id = c.id
  WHERE (p_status IS NULL OR rr.status = p_status)
    AND (
      p_search IS NULL
      OR up.full_name   ILIKE '%' || p_search || '%'
      OR up.email       ILIKE '%' || p_search || '%'
      OR p.name         ILIKE '%' || p_search || '%'
      OR p.product_code ILIKE '%' || p_search || '%'
    )
    AND (p_date_from IS NULL OR rr.start_date >= p_date_from)
    AND (p_date_to   IS NULL OR rr.end_date   <= p_date_to)
  ORDER BY rr.created_at DESC
  LIMIT p_per_page OFFSET (p_page - 1) * p_per_page;
END;
$$;

REVOKE ALL ON FUNCTION get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_list(TEXT, TEXT, DATE, DATE, INTEGER, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 4. sync_checkout_to_profile — 체크아웃 폼 → 프로필 동기화
--    user_profiles.address = TEXT (JSONB 아님, 실제 스키마 기준)
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_checkout_to_profile(
  p_user_id UUID,
  p_name    TEXT DEFAULT NULL,
  p_phone   TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL
)
RETURNS VOID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND NOT is_cms_admin() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  UPDATE user_profiles
  SET
    full_name  = COALESCE(NULLIF(p_name,    ''), full_name),
    phone      = COALESCE(NULLIF(p_phone,   ''), phone),
    address    = COALESCE(NULLIF(p_address, ''), address),
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION sync_checkout_to_profile(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_checkout_to_profile(UUID, TEXT, TEXT, TEXT) TO authenticated;
