-- Migration #644: 주문이 전부 취소·만료되면 소진된 쿠폰·포인트를 되돌린다 (2026-10-05, CRITICAL — Stephen 지시)
--
-- 배경: update_reservation_status · cancel_reservation_payment · release_reservation_hold 어디에도 결제 확정 시 소진된
--   쿠폰(user_coupons.used_at/used_count/order_id, coupons.usage_count)과 차감된 포인트(user_profiles.points)를 되돌리는
--   코드가 없어, 취소·환불된 주문의 쿠폰이 "사용됨"으로 남고 포인트가 돌아오지 않았다.
-- 변경: rental_reservations.status가 cancelled/expired로 바뀌면(모든 경로 공통) 트리거가 그 예약의 주문을 찾아,
--   주문에 묶인 모든 예약이 cancelled/expired일 때만(부분 취소는 지원하지 않는 정책, 일부가 살아 있으면 보류)
--   ① 이 주문으로 소진된 쿠폰을 사용 가능 상태로 복귀(used_count -1 · 0이 되면 used_at NULL · order_id NULL ·
--      coupons.usage_count -1; 채번된 redeemed_code는 영구고정 정책에 따라 유지)
--   ② 이 주문의 use_points 차감분을 잔액에 복원하고 point_transactions(type='refund', ref_type='order', ref_id=주문id)로 기록.
--   멱등: 쿠폰은 order_id가 NULL로 바뀌어 재실행 시 대상이 없고, 포인트는 주문당 refund 1건 고유 인덱스 + unique_violation 흡수.
--   결제 전(소진 전) 주문은 대상 행이 없어 아무것도 바뀌지 않는다. 기존 이미 취소된 주문은 소급하지 않는다(별도 승인 후 백필).
--   환원 실패 시 취소 자체도 롤백(원자성) — 돈과 관련된 상태가 어긋난 채 취소만 되는 것을 막는다.
-- 포인트 통계: get_point_stats의 total_used에 refund를 합산(양수라 사용액에서 차감되어 순사용액이 된다).
--
-- ROLLBACK (필요 시 수동 실행):
--   DROP TRIGGER IF EXISTS trg_restore_order_benefits ON public.rental_reservations;
--   DROP FUNCTION IF EXISTS private.trg_restore_order_benefits();
--   DROP FUNCTION IF EXISTS private.restore_order_benefits(bigint);
--   DROP INDEX IF EXISTS public.uq_point_transactions_refund_per_order;
--   get_point_stats는 환원 합산 이전 정의(total_used = use+admin_deduct만)로 CREATE OR REPLACE 복원.

CREATE UNIQUE INDEX IF NOT EXISTS uq_point_transactions_refund_per_order
  ON public.point_transactions (ref_id)
  WHERE type = 'refund' AND ref_type = 'order';

CREATE OR REPLACE FUNCTION private.restore_order_benefits(p_order_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r       RECORD;
  v_uid   UUID;
  v_pts   INTEGER;
  v_bal   INTEGER;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  -- 주문에 아직 살아 있는 예약이 있으면 환원하지 않는다(주문 전체가 취소·만료됐을 때만)
  IF EXISTS (
    SELECT 1
    FROM order_items oi
    JOIN rental_reservations rr ON rr.id = oi.reservation_id
    WHERE oi.order_id = p_order_id
      AND rr.status NOT IN ('cancelled', 'expired')
  ) THEN
    RETURN;
  END IF;

  -- ① 쿠폰: 이 주문으로 소진된 쿠폰을 사용 가능 목록으로 복귀
  FOR r IN
    SELECT uc.id, uc.coupon_id
    FROM user_coupons uc
    WHERE uc.order_id = p_order_id AND uc.used_at IS NOT NULL
    FOR UPDATE OF uc
  LOOP
    UPDATE user_coupons
    SET used_count = GREATEST(used_count - 1, 0),
        used_at    = CASE WHEN used_count - 1 <= 0 THEN NULL ELSE used_at END,
        order_id   = NULL
    WHERE id = r.id;

    UPDATE coupons
    SET usage_count = GREATEST(usage_count - 1, 0)
    WHERE id = r.coupon_id;
  END LOOP;

  -- ② 포인트: 이 주문으로 차감된 포인트를 잔액에 복원
  SELECT pt.user_id, -pt.amount
    INTO v_uid, v_pts
  FROM point_transactions pt
  WHERE pt.type = 'use' AND pt.ref_type = 'order' AND pt.ref_id = p_order_id::text
  LIMIT 1;

  IF FOUND AND v_pts IS NOT NULL AND v_pts > 0 THEN
    BEGIN
      UPDATE user_profiles
      SET points = points + v_pts,
          updated_at = now()
      WHERE id = v_uid
      RETURNING points INTO v_bal;

      IF FOUND THEN
        INSERT INTO point_transactions(user_id, type, amount, balance_after, description, ref_type, ref_id)
        VALUES (v_uid, 'refund', v_pts, v_bal, '예약 취소로 사용 포인트 환원', 'order', p_order_id::text);
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- 이미 환원된 주문(동시/중복 실행) — 잔액 증가까지 함께 롤백되어 이중 환원 없음
      NULL;
    END;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.restore_order_benefits(BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.trg_restore_order_benefits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  SELECT oi.order_id INTO v_order_id
  FROM order_items oi
  WHERE oi.reservation_id = NEW.id
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    PERFORM private.restore_order_benefits(v_order_id);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.trg_restore_order_benefits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_restore_order_benefits ON public.rental_reservations;
CREATE TRIGGER trg_restore_order_benefits
  AFTER UPDATE OF status ON public.rental_reservations
  FOR EACH ROW
  WHEN (NEW.status IN ('cancelled', 'expired') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.trg_restore_order_benefits();

-- 포인트 통계: 환원(refund)은 사용액에서 차감해 순사용액으로 집계
CREATE OR REPLACE FUNCTION public.get_point_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result JSONB;
BEGIN
  IF NOT public.is_cms_user() THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  SELECT jsonb_build_object(
    'total_granted',    COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant')), 0),
    'total_used',       ABS(COALESCE(SUM(amount) FILTER (WHERE type IN ('use','admin_deduct','refund')), 0)),
    'total_expired',    ABS(COALESCE(SUM(amount) FILTER (WHERE type = 'expire'), 0)),
    'total_balance',    COALESCE((SELECT SUM(points) FROM user_profiles WHERE points > 0), 0),
    'usage_rate',       CASE WHEN COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant')), 0) = 0 THEN 0
      ELSE ROUND(ABS(COALESCE(SUM(amount) FILTER (WHERE type IN ('use','admin_deduct','refund')), 0))::NUMERIC / NULLIF(COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant')), 0), 0) * 100, 1) END,
    'avg_user_balance', COALESCE((SELECT ROUND(AVG(points),0) FROM user_profiles WHERE points > 0), 0),
    'monthly_issued',   COALESCE(SUM(amount) FILTER (WHERE type IN ('earn','admin_grant') AND created_at >= date_trunc('month',now())), 0),
    'expiring_30d',     0
  ) INTO v_result FROM point_transactions;
  RETURN v_result;
END; $function$;
