-- Migration #109: 다중 배송지 테이블 + RPC
-- 목적: 사용자별 배송지 최대 5개 관리, CMS 조회, 기존 address 컬럼 데이터 마이그레이션
-- 2026-07-22

-- 1. 테이블 생성
CREATE TABLE IF NOT EXISTS user_shipping_addresses (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  label          TEXT        NOT NULL DEFAULT '추가',
  recipient      TEXT,
  phone          TEXT,
  road_address   TEXT        NOT NULL,
  detail_address TEXT,
  postal_code    TEXT,
  is_default     BOOLEAN     NOT NULL DEFAULT false,
  sort_order     INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usa_user_id ON user_shipping_addresses(user_id);

-- 2. RLS
ALTER TABLE user_shipping_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_addresses_all" ON user_shipping_addresses
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. 기존 user_profiles.address 데이터 마이그레이션
INSERT INTO user_shipping_addresses (user_id, label, road_address, detail_address, is_default, sort_order)
SELECT
  id,
  '기본',
  address::jsonb->>'road_address',
  COALESCE(address::jsonb->>'detail_address', ''),
  true,
  0
FROM user_profiles
WHERE address IS NOT NULL
  AND (address::jsonb->>'road_address') IS NOT NULL
  AND (address::jsonb->>'road_address') != ''
  AND deleted_at IS NULL;

-- 4. CMS 조회 RPC (cms_role 인증 내부 확인)
CREATE OR REPLACE FUNCTION get_user_shipping_addresses(p_user_id UUID)
RETURNS TABLE (
  id             UUID,
  label          TEXT,
  recipient      TEXT,
  phone          TEXT,
  road_address   TEXT,
  detail_address TEXT,
  postal_code    TEXT,
  is_default     BOOLEAN,
  sort_order     INT,
  created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cms_role TEXT;
BEGIN
  SELECT cms_role INTO v_cms_role FROM user_profiles WHERE id = auth.uid() AND deleted_at IS NULL;
  IF v_cms_role IS NULL THEN
    RAISE EXCEPTION 'CMS 권한 없음';
  END IF;

  RETURN QUERY
  SELECT a.id, a.label, a.recipient, a.phone,
         a.road_address, a.detail_address, a.postal_code,
         a.is_default, a.sort_order, a.created_at
  FROM user_shipping_addresses a
  WHERE a.user_id = p_user_id
  ORDER BY a.is_default DESC, a.sort_order ASC, a.created_at ASC;
END;
$$;

-- 5. 배송지 추가 RPC
CREATE OR REPLACE FUNCTION add_shipping_address(
  p_label          TEXT,
  p_recipient      TEXT,
  p_phone          TEXT,
  p_road_address   TEXT,
  p_detail_address TEXT,
  p_postal_code    TEXT,
  p_set_default    BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count  INT;
  v_new_id UUID;
  v_is_def BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인 필요');
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_shipping_addresses WHERE user_id = auth.uid();
  IF v_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', '배송지는 최대 5개까지 등록 가능합니다.');
  END IF;

  v_is_def := (v_count = 0) OR p_set_default;

  IF v_is_def THEN
    UPDATE user_shipping_addresses SET is_default = false WHERE user_id = auth.uid();
  END IF;

  INSERT INTO user_shipping_addresses
    (user_id, label, recipient, phone, road_address, detail_address, postal_code, is_default, sort_order)
  VALUES
    (auth.uid(), COALESCE(NULLIF(TRIM(p_label), ''), '추가'), NULLIF(TRIM(p_recipient),''),
     NULLIF(TRIM(p_phone),''), TRIM(p_road_address), NULLIF(TRIM(p_detail_address),''),
     NULLIF(TRIM(p_postal_code),''), v_is_def, v_count)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
END;
$$;

-- 6. 배송지 삭제 RPC
CREATE OR REPLACE FUNCTION delete_shipping_address(p_address_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_default BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인 필요');
  END IF;

  SELECT is_default INTO v_was_default
  FROM user_shipping_addresses
  WHERE id = p_address_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '배송지를 찾을 수 없습니다.');
  END IF;

  DELETE FROM user_shipping_addresses WHERE id = p_address_id AND user_id = auth.uid();

  IF v_was_default THEN
    UPDATE user_shipping_addresses
    SET is_default = true
    WHERE user_id = auth.uid()
      AND id = (
        SELECT id FROM user_shipping_addresses
        WHERE user_id = auth.uid()
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1
      );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 7. 기본 배송지 설정 RPC
CREATE OR REPLACE FUNCTION set_default_shipping_address(p_address_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인 필요');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_shipping_addresses WHERE id = p_address_id AND user_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', '배송지를 찾을 수 없습니다.');
  END IF;

  UPDATE user_shipping_addresses SET is_default = false WHERE user_id = auth.uid();
  UPDATE user_shipping_addresses SET is_default = true  WHERE id = p_address_id AND user_id = auth.uid();

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON TABLE user_shipping_addresses IS
  '사용자 배송지 (최대 5개, is_default=true가 기본 배송지, label=기본/추가 배지용)';
