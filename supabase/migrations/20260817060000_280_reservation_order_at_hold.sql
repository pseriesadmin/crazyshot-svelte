-- Migration 280: 예약 신청(hold) 시점 주문(order) 연결 — 대여정보 탭 통합 표시 기반 마련
--
-- 배경: TASK.md "예약 신청 시점 주문 연결 + 대여정보 탭 통합 표시" (2026-08-17) 참고.
-- 지금까지 orders/order_items 연결은 체크아웃 확정(create_checkout_order, confirm-mock)
-- 시점에만 생성되어, hold 상태로 CMS 승인 대기 중인 예약이나 관리자가 체크아웃을 거치지 않고
-- 직접 "승인하기"로 confirmed 처리한 예약은 영원히 주문 연결이 비어 있었다. 이 마이그레이션은
-- 주문 생성 시점을 장바구니 제출(카트 페이지 체크아웃 버튼) 시점으로 앞당기고,
-- create_checkout_order는 이미 만들어진 주문을 재사용하는 멱등 동작으로 재정의한다.
--
-- STEP 1: order_key_sequences — order_key 원자적 채번 테이블. create_checkout_order의 기존
--         COUNT(*)+1 LIKE 채번 방식은 동시성 충돌 위험이 있다(reservation_code가 동일 COUNT
--         패턴으로 실제 충돌을 겪어 Migration 247에서 원자적 시퀀스 테이블로 교체한 전례 —
--         이 STEP은 그 검증된 패턴을 그대로 재사용).
-- STEP 2: create_reservation_order RPC 신규 — 멱등 가드(기존 연결 재사용) + 신규 주문 생성
-- STEP 3: create_checkout_order를 create_reservation_order에 위임 (시그니처/반환값 불변)
-- STEP 4: order_items.reservation_id 부분 유니크 인덱스(안전장치)

-- ─────────────────────────────────────────────
-- STEP 1: order_key_sequences (reservation_code_sequences, Migration 247과 동일 패턴)
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_key_sequences (
  seq_date  TEXT PRIMARY KEY,
  next_seq  INT  NOT NULL DEFAULT 1
);

ALTER TABLE public.order_key_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_order_key_sequences" ON public.order_key_sequences;
CREATE POLICY "service_role_all_order_key_sequences"
  ON public.order_key_sequences
  FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────
-- STEP 2: create_reservation_order — 멱등 주문 생성/재사용 (service_role 전용)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_reservation_order(
  p_user_id          UUID,
  p_reservation_ids  BIGINT[]
)
RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_grade     TEXT;
  v_rate      NUMERIC := 0;
  v_total     NUMERIC := 0;
  v_discount  NUMERIC := 0;
  v_final     NUMERIC := 0;
  v_order_id  BIGINT;
  v_order_key TEXT;
  v_count     INT;
  v_seq       INT;
  v_today     TEXT;
  r           RECORD;
  line        RECORD;
BEGIN
  IF p_user_id IS NULL OR p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RAISE EXCEPTION '주문을 생성할 예약이 없습니다.';
  END IF;

  -- 소유·상태 방어적 재검증 (create_checkout_order와 동일 원칙)
  SELECT COUNT(*) INTO v_count
  FROM rental_reservations
  WHERE id = ANY(p_reservation_ids) AND user_id = p_user_id AND status = 'hold';

  IF v_count IS DISTINCT FROM array_length(p_reservation_ids, 1) THEN
    RAISE EXCEPTION '본인 소유의 신청대기(hold) 예약만 주문으로 묶을 수 있습니다.';
  END IF;

  -- 멱등 가드: p_reservation_ids 중 이미 order_items에 연결된 게 있으면, 그중 가장 먼저
  -- 생성된 order를 재사용한다(2개 이상 서로 다른 order로 갈라져 있는 드문 충돌 케이스도
  -- "가장 먼저 생성된 order"로 수렴시켜 처리 — 기존 연결을 이동/삭제하지 않고 그대로 둔다).
  SELECT o.id INTO v_order_id
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.reservation_id = ANY(p_reservation_ids)
  ORDER BY o.created_at ASC
  LIMIT 1;

  SELECT membership_grade INTO v_grade FROM user_profiles WHERE id = p_user_id;
  v_rate := CASE COALESCE(v_grade, 'NONE')
    WHEN 'POP'   THEN 10
    WHEN 'CRAZY' THEN 20
    ELSE 0
  END;

  IF v_order_id IS NULL THEN
    -- 신규 주문 생성 — order_key 원자적 채번 (reservation_code_sequences와 동일 패턴:
    -- 신규 날짜(seq=1): INSERT next_seq=2, RETURNING 2-1=1
    -- 기존 날짜(seq=N): UPDATE next_seq=N+1, RETURNING (N+1)-1=N
    v_today := TO_CHAR(NOW(), 'YYYYMMDD');
    INSERT INTO order_key_sequences (seq_date, next_seq)
    VALUES (v_today, 2)
    ON CONFLICT (seq_date) DO UPDATE SET next_seq = order_key_sequences.next_seq + 1
    RETURNING order_key_sequences.next_seq - 1 INTO v_seq;

    IF v_seq IS NULL THEN v_seq := 1; END IF;

    v_order_key := 'ORD-' || v_today || '-' || LPAD(v_seq::TEXT, 5, '0');

    INSERT INTO orders (order_key, user_id, total_amount, discount_amount, tax_amount, final_amount, status)
    VALUES (v_order_key, p_user_id, 0, 0, 0, 0, 'pending')
    RETURNING id INTO v_order_id;
  ELSE
    SELECT o.order_key INTO v_order_key FROM orders o WHERE o.id = v_order_id;
  END IF;

  -- 어느 주문에도 아직 연결 안 된 id만 이 주문에 신규 연결
  FOR r IN
    SELECT rr.id, rr.product_id
    FROM rental_reservations rr
    WHERE rr.id = ANY(p_reservation_ids)
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.reservation_id = rr.id)
  LOOP
    SELECT * INTO line FROM compute_reservation_line_amount(r.id);

    INSERT INTO order_items (order_id, reservation_id, product_id, quantity, unit_price, line_total)
    VALUES (v_order_id, r.id, r.product_id, 1, line.rental_fee, line.rental_fee + line.options_fee);
  END LOOP;

  -- 금액 재계산 — 이 주문에 현재 연결된 order_items 전체 기준(기존 연결분 포함, 재사용 시에도 정합)
  SELECT COALESCE(SUM(oi.line_total), 0) INTO v_total
  FROM order_items oi WHERE oi.order_id = v_order_id;

  v_discount := ROUND(v_total * v_rate / 100.0);
  v_final    := v_total - v_discount;

  UPDATE orders
  SET total_amount = v_total, discount_amount = v_discount, final_amount = v_final
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_order(UUID, BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_order(UUID, BIGINT[]) TO service_role;

-- ─────────────────────────────────────────────
-- STEP 3: create_checkout_order — create_reservation_order에 위임 (시그니처/반환값 불변,
-- confirm-mock 쪽 코드 변경 없음). 정상 흐름에서는 카트 제출 시점에 이미 주문이 생성돼
-- 있으므로 이 호출은 기존 주문을 그대로 반환하는 멱등 동작이 된다.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_user_id          UUID,
  p_reservation_ids  BIGINT[]
)
RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM public.create_reservation_order(p_user_id, p_reservation_ids);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) TO service_role;

-- ─────────────────────────────────────────────
-- STEP 4: order_items.reservation_id 부분 유니크 인덱스 — 한 예약이 두 주문에 동시에
-- 연결되는 것을 DB 레벨에서 원천 차단하는 안전장치(현재 이 컬럼에 유니크 제약이 전혀
-- 없음을 Stage DB information_schema/pg_indexes 직접 조회로 확인함).
-- ─────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS order_items_reservation_id_uq
  ON public.order_items (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- ─────────────────────────────────────────────
-- ROLLBACK (필요 시 아래 순서대로 수동 실행 — 이 마이그레이션은 CREATE OR REPLACE로
-- create_checkout_order를 완전히 대체하므로, 파일을 삭제하는 것만으로는 이미 적용된 Stage/
-- Production DB의 함수 정의가 되돌아가지 않는다. 아래 SQL을 직접 실행해야 실제 롤백된다.)
-- ─────────────────────────────────────────────
--
-- 1. DROP INDEX IF EXISTS public.order_items_reservation_id_uq;
--
-- 2. create_checkout_order를 Migration 251b 시점(위임 없는 자체 로직)으로 복원:
--    CREATE OR REPLACE FUNCTION public.create_checkout_order(
--      p_user_id UUID, p_reservation_ids BIGINT[]
--    )
--    RETURNS TABLE(order_id BIGINT, order_key TEXT, final_amount NUMERIC)
--    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--    AS $function$
--    -- 전체 본문은 supabase/migrations/20260814070000_251_checkout_order_grouping.sql
--    -- STEP 3(146-221행)을 그대로 복사해 사용할 것 — 소유·상태 재검증, COUNT(*)+1 LIKE 방식
--    -- order_key 채번, orders/order_items INSERT, 금액 계산까지 전부 원본 그대로.
--    $function$;
--    REVOKE ALL ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) FROM PUBLIC, anon, authenticated;
--    GRANT EXECUTE ON FUNCTION public.create_checkout_order(UUID, BIGINT[]) TO service_role;
--
-- 3. DROP FUNCTION IF EXISTS public.create_reservation_order(UUID, BIGINT[]);
--
-- 4. DROP POLICY IF EXISTS "service_role_all_order_key_sequences" ON public.order_key_sequences;
--    DROP TABLE IF EXISTS public.order_key_sequences;
--
-- ⚠️ 주의: 롤백 시점까지 create_reservation_order를 거쳐 order_items에 연결된 예약(장바구니
-- 제출 시점에 생성된 hold 상태 주문 연결)이 있다면, 그 orders/order_items 행은 위 SQL로
-- 자동 삭제되지 않는다 — 필요 시 별도로 데이터 정리 여부를 검토할 것.
