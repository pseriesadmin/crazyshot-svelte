-- Migration #152: rental_shipping_settings 테이블 신규 생성 + upsert RPC
-- 배송 설정 (singleton): 왕복/배송/반송 요금 + 배송 안내문

CREATE TABLE IF NOT EXISTS rental_shipping_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enable_round_trip BOOLEAN NOT NULL DEFAULT false,
  round_trip_fee  INTEGER,
  enable_delivery BOOLEAN NOT NULL DEFAULT false,
  delivery_fee    INTEGER,
  enable_return   BOOLEAN NOT NULL DEFAULT false,
  return_fee      INTEGER,
  shipping_guide  VARCHAR(200) NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- singleton seed (1행 고정)
INSERT INTO rental_shipping_settings (enable_round_trip, enable_delivery, enable_return, shipping_guide)
VALUES (false, false, false, '');

ALTER TABLE rental_shipping_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipping_settings_admin" ON rental_shipping_settings
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());

CREATE POLICY "shipping_settings_public_select" ON rental_shipping_settings
  FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION upsert_rental_shipping_settings(
  p_enable_round_trip BOOLEAN,
  p_round_trip_fee    INTEGER,
  p_enable_delivery   BOOLEAN,
  p_delivery_fee      INTEGER,
  p_enable_return     BOOLEAN,
  p_return_fee        INTEGER,
  p_shipping_guide    VARCHAR(200)
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  UPDATE rental_shipping_settings SET
    enable_round_trip = p_enable_round_trip,
    round_trip_fee    = CASE WHEN p_enable_round_trip THEN p_round_trip_fee ELSE NULL END,
    enable_delivery   = p_enable_delivery,
    delivery_fee      = CASE WHEN p_enable_delivery   THEN p_delivery_fee   ELSE NULL END,
    enable_return     = p_enable_return,
    return_fee        = CASE WHEN p_enable_return      THEN p_return_fee     ELSE NULL END,
    shipping_guide    = p_shipping_guide,
    updated_at        = now()
  WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_rental_shipping_settings TO authenticated;
