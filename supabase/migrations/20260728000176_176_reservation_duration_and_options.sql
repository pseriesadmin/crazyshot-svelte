-- Migration 176: 체크아웃 렌탈정보 정확도 개선 + 옵션상품 저장 신규 기능
-- 배경: 상품 상세 페이지에서 선택한 대여기간(12h/24h)·수령/반납방식이 체크아웃에 반영되지
--   않고, 옵션상품+수량은 저장할 곳이 아예 없어 체크아웃 카드에 노출이 불가능했음
--   (Stephen 확인 후 전체 수정 진행 — 2026-07-28)
--
-- A. set_reservation_duration RPC 신규
--    rental_reservations.duration_type(Migration 154에서 컬럼만 추가되고 실제로 쓰인 적 없음)
--    저장 경로 신설 — set_reservation_shipment_method(Migration 147/171)와 동일 패턴
--
-- B. reservation_options 테이블 신규 — 예약 시 선택한 옵션상품 + 수량 저장
--    직접 INSERT/UPDATE/DELETE 금지(H-01) → set_reservation_options RPC 경유만 허용

-- ─────────────────────────────────────────────────────────────
-- A. set_reservation_duration
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_reservation_duration(
  p_reservation_id BIGINT,
  p_duration_type  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE rental_reservations
  SET duration_type = p_duration_type
  WHERE id = p_reservation_id
    AND user_id = auth.uid()
    AND status = 'hold';
END;
$$;

REVOKE ALL ON FUNCTION public.set_reservation_duration(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_reservation_duration(BIGINT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- B. reservation_options 테이블 + set_reservation_options RPC
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reservation_options (
  id                BIGSERIAL PRIMARY KEY,
  reservation_id    BIGINT NOT NULL REFERENCES rental_reservations(id) ON DELETE CASCADE,
  option_product_id UUID REFERENCES products(id),
  option_name       TEXT NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  unit_price        NUMERIC NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservation_options_reservation_id
  ON reservation_options(reservation_id);

ALTER TABLE reservation_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservation_options: 본인 예약 조회" ON reservation_options;
CREATE POLICY "reservation_options: 본인 예약 조회"
  ON reservation_options FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.id = reservation_options.reservation_id
        AND rr.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.set_reservation_options(
  p_reservation_id BIGINT,
  p_options        JSONB   -- [{option_product_id, option_name, qty, unit_price}]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rental_reservations
    WHERE id = p_reservation_id AND user_id = auth.uid() AND status = 'hold'
  ) THEN
    RETURN;
  END IF;

  DELETE FROM reservation_options WHERE reservation_id = p_reservation_id;

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    COALESCE((elem->>'unit_price')::NUMERIC, 0)
  FROM jsonb_array_elements(p_options) AS elem
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.set_reservation_options(BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_reservation_options(BIGINT, JSONB) TO authenticated;
