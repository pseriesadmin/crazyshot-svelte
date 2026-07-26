-- Migration #155: 상품별 배송 옵션 선택 컬럼 추가
-- products 테이블에 배송 옵션 3종 컬럼 추가 (기본값 true — 기존 상품 전체 활성화)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shipping_round_trip boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shipping_delivery   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shipping_return     boolean NOT NULL DEFAULT true;

-- RPC: 상품별 배송 옵션 업데이트
CREATE OR REPLACE FUNCTION public.update_product_shipping_options(
  p_product_id    uuid,
  p_round_trip    boolean,
  p_delivery      boolean,
  p_return        boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.products
  SET
    shipping_round_trip = p_round_trip,
    shipping_delivery   = p_delivery,
    shipping_return     = p_return,
    updated_at          = now()
  WHERE id = p_product_id
    AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_shipping_options(uuid, boolean, boolean, boolean)
  TO authenticated;
