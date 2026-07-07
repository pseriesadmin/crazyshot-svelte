-- Migration #74: 자산 신규 생성 RPC
-- 목적: 자산이 없는 상품에서 스캔 저장 시 자산을 자동 생성
-- assets.id = bigint (auto-increment), serial_number NOT NULL → '' 기본값

DROP FUNCTION IF EXISTS public.create_asset_for_product(uuid);

CREATE FUNCTION public.create_asset_for_product(
  p_product_id uuid,
  p_serial_number text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_asset_id bigint;
BEGIN
  -- serial_number: 전달값 우선, 없으면 UUID 자동 생성 (UNIQUE 제약 충족)
  INSERT INTO assets (product_id, serial_number, status)
  VALUES (p_product_id, COALESCE(NULLIF(p_serial_number, ''), gen_random_uuid()::text), 'available')
  RETURNING id INTO v_asset_id;
  RETURN v_asset_id;
END;
$$;
