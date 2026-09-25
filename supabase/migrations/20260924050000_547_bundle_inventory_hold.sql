-- Migration #547: 결합상품 Phase 2 — 재고 연동 (A안 실물 단위 배정)
-- 2026-09-24 | Stephen GATE B 확정 | TDD: src/__tests__/services/bundleInventoryHold.test.ts
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- ⚠️ Production 적용은 Stephen이 오픈 시점을 별도 확인한 뒤(Q-M: Phase 1 #544·#545와 함께).
--
-- 정책:
--  1) 패키지 상품의 hold 생성(create_hold_reservation) / draft→hold 승격(promote_draft_reservation)과
--     같은 트랜잭션에서, product_bundle_links의 결합상품마다 활성 자식(실물) 1개를 배정한다.
--     날짜 기준 = 메인과 동일한 effective 기간(휴무일 연장 반영). 하나라도 배정 불가면 전체 롤백
--     ('구성품 재고가 부족해 예약할 수 없습니다.').
--  2) 배정 기록표 reservation_bundle_assets(예약 1건 ↔ 결합상품별 실물 1개). 해제 로직 없음 —
--     예약 status가 종결(cancelled/expired/returned/completed)이면 조인 조건에서 자동 제외된다.
--  3) 결합상품 단독 예약의 배정 쿼리(위 두 함수)에 "비종결 예약에 결합으로 배정된 실물 + 날짜 겹침" 제외
--     조건을 추가해 상호 차단한다. draft는 점유하지 않는다(draft에는 배정 기록이 생기지 않음).
--  4) get_available_stock_counts: 결합 점유 반영 + 패키지 가용 = min(자신, 각 결합상품 가용).
--  5) 요금·결제·옵션(set_reservation_options, Migration 428) 무변경.
--  6) 삭제된 결합상품(products.deleted_at) / 삭제된 연결(deleted_at)은 배정 대상 아님(EC-C).
--     결합상품의 활성 자식이 하나도 없으면 "재고 없음"으로 실패한다(Q-B).
--
-- 기반 본문: Migration 501(2026-09-15) create_hold_reservation / promote_draft_reservation,
--            Migration 421 get_available_stock_counts. 시그니처·반환형·권한 전부 무변경.
--
-- ROLLBACK (원본 본문 복원): 이 파일 하단 주석 참고.

-- ============================================================
-- 1. 배정 기록표
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reservation_bundle_assets (
  id                BIGSERIAL   PRIMARY KEY,
  reservation_id    BIGINT      NOT NULL REFERENCES public.rental_reservations(id) ON DELETE CASCADE,
  bundle_product_id UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE, -- 결합상품 부모
  asset_product_id  UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE, -- 배정된 실물(자식)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reservation_id, bundle_product_id),
  UNIQUE (reservation_id, asset_product_id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_bundle_assets_asset
  ON public.reservation_bundle_assets (asset_product_id);

-- RLS 활성 + 정책 없음 = RPC(SECURITY DEFINER)·service_role 전용
ALTER TABLE public.reservation_bundle_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_bundle_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.reservation_bundle_assets TO service_role;
REVOKE ALL ON SEQUENCE public.reservation_bundle_assets_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.reservation_bundle_assets_id_seq TO service_role;

-- ============================================================
-- 2. 배정 헬퍼 — 결합상품별 실물 1개 배정(실패 시 EXCEPTION → 호출 함수의 예외 블록이 전체 롤백)
--    후보 행을 FOR UPDATE SKIP LOCKED로 잠근 "뒤" 별도 문장에서 겹침을 재확인한다 — 잠금 획득 후
--    새 스냅샷으로 재검사하므로 잠금 대기 중 커밋된 다른 트랜잭션의 배정도 놓치지 않는다.
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_bundle_assets(
  p_reservation_id bigint,
  p_package_id     uuid,
  p_start_date     date,
  p_end_date       date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle_id uuid;
  v_asset_id  uuid;
  v_cand      uuid;
BEGIN
  FOR v_bundle_id IN
    SELECT pbl.bundle_product_id
    FROM product_bundle_links pbl
    JOIN products bp ON bp.id = pbl.bundle_product_id AND bp.deleted_at IS NULL
    WHERE pbl.product_id = p_package_id
      AND pbl.deleted_at IS NULL
    ORDER BY pbl.display_order, pbl.bundle_product_id
  LOOP
    v_asset_id := NULL;

    FOR v_cand IN
      SELECT c.id
      FROM products c
      WHERE c.parent_product_id = v_bundle_id
        AND c.deleted_at IS NULL
        AND c.is_active = true
      ORDER BY c.created_at
      FOR UPDATE SKIP LOCKED
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM rental_reservations rr
        WHERE rr.product_id = v_cand
          AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
          AND daterange(rr.start_date, rr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
      ) AND NOT EXISTS (
        SELECT 1
        FROM reservation_bundle_assets a
        JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
        WHERE a.asset_product_id = v_cand
          AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
          AND daterange(rr2.start_date, rr2.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
      ) THEN
        v_asset_id := v_cand;
        EXIT;
      END IF;
    END LOOP;

    IF v_asset_id IS NULL THEN
      RAISE EXCEPTION '구성품 재고가 부족해 예약할 수 없습니다.';
    END IF;

    INSERT INTO reservation_bundle_assets (reservation_id, bundle_product_id, asset_product_id)
    VALUES (p_reservation_id, v_bundle_id, v_asset_id);
  END LOOP;
END;
$function$;

-- 내부 전용: 호출자는 create_hold/promote(SECURITY DEFINER, 소유자 권한) 뿐. 직접 호출 차단.
REVOKE ALL ON FUNCTION public.assign_bundle_assets(bigint, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_bundle_assets(bigint, uuid, date, date) TO service_role;

-- ============================================================
-- 3. create_hold_reservation — 501 본문 + (a) 단독 배정 쿼리 결합 점유 제외 (b) INSERT 직후 결합 배정
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_hold_reservation(
  p_product_id uuid,
  p_start_date date,
  p_end_date date,
  p_pickup_method text DEFAULT NULL::text,
  p_return_method text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, reservation_id bigint, asset_id bigint, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_is_anonymous   BOOLEAN;
  v_unit_id        UUID;
  v_reservation_id BIGINT;
  v_effective_start DATE;
  v_effective_end   DATE;
  v_pickup_extra    INT;
  v_return_extra    INT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  SELECT is_anonymous INTO v_is_anonymous FROM auth.users WHERE id = v_user_id;
  IF v_is_anonymous IS TRUE THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '회원 가입 후 예약이 가능합니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND blacklisted = true
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '서비스 이용이 제한된 계정입니다.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = v_user_id AND credit_score < 30
  ) THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '신용점수가 낮아 예약이 제한됩니다.';
    RETURN;
  END IF;

  SELECT effective_start_date, effective_end_date, pickup_extra_days, return_extra_days
  INTO v_effective_start, v_effective_end, v_pickup_extra, v_return_extra
  FROM compute_holiday_extended_period(p_start_date, p_end_date, p_pickup_method, p_return_method);

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = p_product_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(v_effective_start, v_effective_end, '[]')
    )
    -- [#547] 다른 패키지 예약에 결합으로 배정된 실물은 단독 대여 대상에서 제외
    AND NOT EXISTS (
      SELECT 1
      FROM reservation_bundle_assets rba
      JOIN rental_reservations rr2 ON rr2.id = rba.reservation_id
      WHERE rba.asset_product_id = p.id
        AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr2.start_date, rr2.end_date, '[]') &&
            daterange(v_effective_start, v_effective_end, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  INSERT INTO rental_reservations (
    user_id, product_id, status,
    start_date, end_date,
    pickup_method, return_method,
    pickup_holiday_extra_days, return_holiday_extra_days
  )
  VALUES (
    v_user_id, v_unit_id, 'hold',
    v_effective_start, v_effective_end,
    COALESCE(p_pickup_method, 'visit'), COALESCE(p_return_method, 'visit'),
    v_pickup_extra, v_return_extra
  )
  RETURNING id INTO v_reservation_id;

  -- [#547] 결합상품 실물 배정(같은 트랜잭션 — 실패 시 아래 EXCEPTION 블록이 위 INSERT까지 롤백)
  PERFORM assign_bundle_assets(v_reservation_id, p_product_id, v_effective_start, v_effective_end);

  RETURN QUERY SELECT true, v_reservation_id, NULL::BIGINT, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, NULL::BIGINT, SQLERRM;
END;
$function$;

-- ============================================================
-- 4. promote_draft_reservation — 501 본문 + (a) 단독 배정 쿼리 결합 점유 제외 (b) UPDATE 직후 결합 배정
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_draft_reservation(
  p_reservation_id bigint,
  p_start_date date,
  p_end_date date,
  p_pickup_method text DEFAULT NULL::text,
  p_return_method text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, reservation_id bigint, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_parent_id UUID;
  v_unit_id   UUID;
  v_effective_start DATE;
  v_effective_end   DATE;
  v_pickup_extra    INT;
  v_return_extra    INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '대여 기간을 올바르게 입력해주세요.';
    RETURN;
  END IF;

  SELECT product_id INTO v_parent_id
  FROM rental_reservations
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft'
  FOR UPDATE;

  IF v_parent_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약 정보를 찾을 수 없습니다.';
    RETURN;
  END IF;

  SELECT effective_start_date, effective_end_date, pickup_extra_days, return_extra_days
  INTO v_effective_start, v_effective_end, v_pickup_extra, v_return_extra
  FROM compute_holiday_extended_period(p_start_date, p_end_date, p_pickup_method, p_return_method);

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = v_parent_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(v_effective_start, v_effective_end, '[]')
    )
    -- [#547] 다른 패키지 예약에 결합으로 배정된 실물은 단독 대여 대상에서 제외
    AND NOT EXISTS (
      SELECT 1
      FROM reservation_bundle_assets rba
      JOIN rental_reservations rr2 ON rr2.id = rba.reservation_id
      WHERE rba.asset_product_id = p.id
        AND rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr2.start_date, rr2.end_date, '[]') &&
            daterange(v_effective_start, v_effective_end, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  UPDATE rental_reservations
  SET product_id = v_unit_id,
      start_date = v_effective_start,
      end_date   = v_effective_end,
      status     = 'hold',
      pickup_holiday_extra_days = v_pickup_extra,
      return_holiday_extra_days = v_return_extra
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft';

  -- [#547] 결합상품 실물 배정(같은 트랜잭션 — 실패 시 위 UPDATE까지 롤백되어 draft 유지)
  PERFORM assign_bundle_assets(p_reservation_id, v_parent_id, v_effective_start, v_effective_end);

  RETURN QUERY SELECT true, p_reservation_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$function$;

-- 권한 재확인(#503 — CREATE OR REPLACE는 기존 ACL 보존, 재실행에도 동일 결과가 되도록 명시)
REVOKE ALL ON FUNCTION public.create_hold_reservation(uuid, date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_hold_reservation(uuid, date, date, text, text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.promote_draft_reservation(bigint, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_draft_reservation(bigint, date, date, text, text) TO authenticated, service_role;

-- ============================================================
-- 5. get_available_stock_counts — 결합 점유 반영 + 패키지 = min(자신, 각 결합상품)
--    421 정의와 동일하게 날짜 무관 스냅샷(비종결 5상태 점유). 시그니처·권한 무변경.
--    자식 점유 = (자식 본인 예약) OR (다른 패키지 예약에 결합 배정). 결합 배정의 draft는 존재하지 않음.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_available_stock_counts(p_product_ids UUID[])
RETURNS TABLE(
  product_id       UUID,
  available_count  INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH req AS (
    SELECT DISTINCT id FROM unnest(p_product_ids) AS t(id)
  ),
  need AS (
    SELECT id FROM req
    UNION
    SELECT pbl.bundle_product_id
    FROM req
    JOIN product_bundle_links pbl ON pbl.product_id = req.id AND pbl.deleted_at IS NULL
  ),
  own AS (
    SELECT
      n.id AS pid,
      (
        SELECT COUNT(*)
        FROM products c
        WHERE c.parent_product_id = n.id
          AND c.is_active = true AND c.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM rental_reservations rr
            WHERE rr.product_id = c.id
              AND rr.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested')
          )
          AND NOT EXISTS (
            SELECT 1 FROM reservation_bundle_assets a
            JOIN rental_reservations rr2 ON rr2.id = a.reservation_id
            WHERE a.asset_product_id = c.id
              AND rr2.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested')
          )
      )::INT AS cnt
    FROM need n
  )
  SELECT
    req.id AS product_id,
    GREATEST(
      0,
      LEAST(
        COALESCE((SELECT o.cnt FROM own o WHERE o.pid = req.id), 0),
        COALESCE((
          SELECT MIN(COALESCE(bo.cnt, 0))
          FROM product_bundle_links pbl
          JOIN products bp ON bp.id = pbl.bundle_product_id AND bp.deleted_at IS NULL
          LEFT JOIN own bo ON bo.pid = pbl.bundle_product_id
          WHERE pbl.product_id = req.id AND pbl.deleted_at IS NULL
        ), 2147483647)
      )
    )::INT AS available_count
  FROM req;
$$;

REVOKE ALL ON FUNCTION public.get_available_stock_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_stock_counts(UUID[]) TO anon, authenticated;

-- ============================================================
-- ROLLBACK 초안 (별도 마이그레이션으로 적용 — 이 파일은 수정하지 않음)
-- ------------------------------------------------------------
-- 1) create_hold_reservation / promote_draft_reservation:
--    supabase/migrations/20260915010000_501_holiday_extension_reintegration.sql 의
--    섹션 4(create_hold_reservation)·섹션 6(promote_draft_reservation) CREATE OR REPLACE 본문을 그대로 재실행
--    후 #503 하단 REVOKE/GRANT 4줄 재실행.
-- 2) get_available_stock_counts: 20260902030000_421_get_available_stock_counts.sql 본문 재실행
--    (REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO anon, authenticated).
-- 3) DROP FUNCTION public.assign_bundle_assets(bigint, uuid, date, date);
-- 4) DROP TABLE public.reservation_bundle_assets;   -- 이미 생성된 배정 기록도 함께 사라짐
-- (순서: 1·2 → 3 → 4. 함수가 표를 참조하므로 함수 복원 후 표 삭제)
-- ============================================================
