-- Migration 257: product_history_records — registered_by 컬럼 추가 + 고객 전용 RPC 신설
--
-- 목적: 고객이 반납 이력을 직접 등록할 수 있도록 DB 확장.
--   1. registered_by TEXT — 'admin'(관리자) / 'customer'(고객) 구분
--   2. get_product_history_for_customer — 소유권 검증 후 이력 조회
--   3. upsert_product_history_record_customer — 소유권 검증 후 이력 생성/수정
--   4. delete_product_history_record_customer — 소유권 검증 후 이력 삭제
--   5. get_product_history / get_product_history_multi — registered_by 컬럼 추가 반환
--
-- 보안: 모든 고객 RPC는 SECURITY DEFINER + auth.uid() 소유권 검증 내장.
--   고객은 자신이 예약한(rental_reservations.user_id = auth.uid()) 상품의 이력만 접근 가능.
--   고객은 registered_by = 'customer' 인 자신이 등록한 이력만 수정/삭제 가능.
--
-- 2026-08-15
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

-- ── 1. registered_by 컬럼 추가 ──────────────────────────────────────────────

ALTER TABLE product_history_records
  ADD COLUMN IF NOT EXISTS registered_by TEXT DEFAULT 'admin'
  CHECK (registered_by IN ('admin', 'customer'));

COMMENT ON COLUMN product_history_records.registered_by IS
  '등록 주체: admin(관리자 CMS) | customer(고객 반납이력 등록 화면)';

-- ── 2. get_product_history — registered_by 반환 컬럼 추가 ───────────────────
-- OUT 파라미터(반환 타입) 변경이라 CREATE OR REPLACE로 불가 — DROP 후 재생성 필수
DROP FUNCTION IF EXISTS get_product_history(UUID);

CREATE FUNCTION get_product_history(p_product_id UUID)
RETURNS TABLE(
  id              UUID,
  product_id      UUID,
  recorded_date   DATE,
  images          JSONB,
  created_by      UUID,
  updated_by      UUID,
  created_by_email TEXT,
  updated_by_email TEXT,
  registered_by   TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT
      h.id,
      h.product_id,
      h.recorded_date,
      h.images,
      h.created_by,
      h.updated_by,
      cu.email::TEXT  AS created_by_email,
      uu.email::TEXT  AS updated_by_email,
      h.registered_by,
      h.created_at,
      h.updated_at
    FROM product_history_records h
    LEFT JOIN auth.users cu ON cu.id = h.created_by
    LEFT JOIN auth.users uu ON uu.id = h.updated_by
    WHERE h.product_id = p_product_id AND h.deleted_at IS NULL
    ORDER BY h.recorded_date DESC, h.created_at DESC;
END;
$$;

-- ── 3. get_product_history_multi — registered_by 반환 컬럼 추가 ────────────
DROP FUNCTION IF EXISTS get_product_history_multi(UUID[]);

CREATE FUNCTION get_product_history_multi(p_product_ids UUID[])
RETURNS TABLE(
  id              UUID,
  product_id      UUID,
  recorded_date   DATE,
  images          JSONB,
  created_by      UUID,
  updated_by      UUID,
  created_by_email TEXT,
  updated_by_email TEXT,
  registered_by   TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT
      h.id,
      h.product_id,
      h.recorded_date,
      h.images,
      h.created_by,
      h.updated_by,
      cu.email::TEXT  AS created_by_email,
      uu.email::TEXT  AS updated_by_email,
      h.registered_by,
      h.created_at,
      h.updated_at
    FROM product_history_records h
    LEFT JOIN auth.users cu ON cu.id = h.created_by
    LEFT JOIN auth.users uu ON uu.id = h.updated_by
    WHERE h.product_id = ANY(p_product_ids) AND h.deleted_at IS NULL
    ORDER BY h.recorded_date DESC, h.created_at DESC;
END;
$$;

-- ── 4. get_product_history_for_customer ─────────────────────────────────────
-- 소유권: rental_reservations.user_id = auth.uid() + reservation_id 검증

CREATE OR REPLACE FUNCTION get_product_history_for_customer(
  p_reservation_id BIGINT
)
RETURNS TABLE(
  id              UUID,
  product_id      UUID,
  recorded_date   DATE,
  images          JSONB,
  registered_by   TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_product_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN RETURN; END IF;

  SELECT rr.product_id INTO v_product_id
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id
    AND rr.user_id = v_caller_id;

  IF v_product_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT
      h.id,
      h.product_id,
      h.recorded_date,
      h.images,
      h.registered_by,
      h.created_at,
      h.updated_at
    FROM product_history_records h
    WHERE h.product_id = v_product_id
      AND h.deleted_at IS NULL
    ORDER BY h.recorded_date DESC, h.created_at DESC;
END;
$$;

REVOKE ALL     ON FUNCTION get_product_history_for_customer(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_product_history_for_customer(BIGINT) TO authenticated;

-- ── 5. upsert_product_history_record_customer ───────────────────────────────
-- 신규 생성 시 registered_by='customer' 자동 태깅.
-- 수정 시 registered_by='customer' 인 본인 등록 이력만 허용.

CREATE OR REPLACE FUNCTION upsert_product_history_record_customer(
  p_reservation_id BIGINT,
  p_recorded_date  DATE,
  p_images         JSONB DEFAULT '[]',
  p_id             UUID  DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_product_id UUID;
  v_result_id  UUID;
BEGIN
  IF v_caller_id IS NULL THEN RETURN NULL; END IF;

  SELECT rr.product_id INTO v_product_id
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id
    AND rr.user_id = v_caller_id;

  IF v_product_id IS NULL THEN RETURN NULL; END IF;

  IF p_id IS NOT NULL THEN
    -- 수정: 이 product의 고객 등록 이력만 허용
    UPDATE product_history_records
    SET images        = p_images,
        recorded_date = p_recorded_date,
        updated_by    = v_caller_id,
        updated_at    = now()
    WHERE id            = p_id
      AND product_id    = v_product_id
      AND registered_by = 'customer'
      AND deleted_at    IS NULL
    RETURNING id INTO v_result_id;
  ELSE
    -- 신규 생성
    INSERT INTO product_history_records(
      product_id, recorded_date, images, created_by, registered_by
    )
    VALUES (v_product_id, p_recorded_date, p_images, v_caller_id, 'customer')
    RETURNING id INTO v_result_id;
  END IF;

  RETURN v_result_id;
END;
$$;

REVOKE ALL     ON FUNCTION upsert_product_history_record_customer(BIGINT, DATE, JSONB, UUID)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION upsert_product_history_record_customer(BIGINT, DATE, JSONB, UUID)
  TO authenticated;

-- ── 6. delete_product_history_record_customer ───────────────────────────────
-- 고객이 등록한(registered_by='customer') 이력만 삭제 허용.

CREATE OR REPLACE FUNCTION delete_product_history_record_customer(
  p_id             UUID,
  p_reservation_id BIGINT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_product_id UUID;
  v_rows       INT;
BEGIN
  IF v_caller_id IS NULL THEN RETURN FALSE; END IF;

  SELECT rr.product_id INTO v_product_id
  FROM rental_reservations rr
  WHERE rr.id = p_reservation_id
    AND rr.user_id = v_caller_id;

  IF v_product_id IS NULL THEN RETURN FALSE; END IF;

  UPDATE product_history_records
  SET deleted_at = now(),
      updated_by = v_caller_id
  WHERE id            = p_id
    AND product_id    = v_product_id
    AND registered_by = 'customer'
    AND deleted_at    IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL     ON FUNCTION delete_product_history_record_customer(UUID, BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION delete_product_history_record_customer(UUID, BIGINT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS delete_product_history_record_customer(UUID, BIGINT);
-- DROP FUNCTION IF EXISTS upsert_product_history_record_customer(BIGINT, DATE, JSONB, UUID);
-- DROP FUNCTION IF EXISTS get_product_history_for_customer(BIGINT);
-- ALTER TABLE product_history_records DROP COLUMN IF EXISTS registered_by;
-- (get_product_history / get_product_history_multi는 이전 버전 재실행으로 복원)
-- ============================================================
