-- Migration 340: orders에 장바구니 단계 쿠폰/포인트 사전선택 컬럼 추가
--
-- 배경: /cart에서 다시 노출하는 쿠폰 할인·포인트 사용 UI(2026-08-24 Stephen 요청 — "장바구니에서
-- 모든 설정과 대여 금액 정보까지 먼저 보여주는 UX가 정합")에서 고른 값을, 실제 결제가 일어나는
-- 3단계(/contract/[token], Migration 280/297 이후 설계)까지 이어가기 위한 저장소. 실제 쿠폰
-- 소진(use_coupon)·포인트 차감(use_points)은 여전히 결제 확정 시점(pay-mock)에서만 일어난다 —
-- 이 컬럼은 어디까지나 "장바구니에서 무엇을 골랐는지"를 계약서명 페이지가 다시 읽어 미리
-- 선택된 상태로 보여주기 위한 캐시일 뿐, 소진 기록이 아니다.
--
-- 저장 위치를 rental_reservations가 아니라 orders로 정한 이유: create_reservation_order
-- (Migration 280)가 이미 장바구니 제출 시점에 order를 확정 생성하고, use_coupon/use_points도
-- p_order_id 단위로 소진 기록을 남기는 구조(Migration 297)와 정합적이기 때문.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS selected_coupon_id UUID REFERENCES user_coupons(id),
  ADD COLUMN IF NOT EXISTS selected_points    INTEGER NOT NULL DEFAULT 0;

-- create_reservation_order — 시그니처에 선택 파라미터 2개 추가(DEFAULT NULL/0이라 기존
-- create_checkout_order(2-param 위임 호출)는 그대로 호환). 신규 주문 생성/기존 주문 재사용
-- 두 경로 모두 마지막에 선택값을 덮어써 "가장 최근 제출값이 저장된다"로 통일.
CREATE OR REPLACE FUNCTION public.create_reservation_order(
  p_user_id            UUID,
  p_reservation_ids    BIGINT[],
  p_selected_coupon_id UUID DEFAULT NULL,
  p_selected_points    INTEGER DEFAULT 0
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
  v_coupon_id UUID;
  v_points    INTEGER;
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

  -- 사전선택 쿠폰 소유권 검증 — 본인 쿠폰이 아니면 조용히 무시(실제 소진은 어차피 pay-mock
  -- 시점에 use_coupon이 다시 검증하므로, 여기선 하드 에러로 체크아웃 흐름을 막지 않는다)
  v_coupon_id := p_selected_coupon_id;
  IF v_coupon_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_coupons WHERE id = v_coupon_id AND user_id = p_user_id
  ) THEN
    v_coupon_id := NULL;
  END IF;
  v_points := GREATEST(0, COALESCE(p_selected_points, 0));

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
  SET total_amount = v_total, discount_amount = v_discount, final_amount = v_final,
      selected_coupon_id = v_coupon_id, selected_points = v_points
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_order_key, v_final;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservation_order(UUID, BIGINT[], UUID, INTEGER)
  TO service_role;

-- ⚠️ CREATE OR REPLACE는 파라미터 목록이 다르면 기존 함수를 "대체"하지 않고 별도 오버로드로
-- 남긴다 — 위 CREATE OR REPLACE 직후 Stage에서 실제로 2-param 버전이 그대로 남아있음을
-- 직접 재조회로 확인(products.md §2-3 "2-param 호출 시 PGRST203" 함정과 동일 유형).
-- create_checkout_order가 create_reservation_order를 2-param으로 위임 호출하는데, 오버로드가
-- 2개(2-param/4-param) 남아있으면 Postgres 함수 오버로드 해석 자체가 모호해져 실패할 수 있어
-- 구 2-param 버전을 명시적으로 제거— 이제 4-param(뒤 2개 DEFAULT) 버전 하나만 남는다.
DROP FUNCTION IF EXISTS public.create_reservation_order(UUID, BIGINT[]);

-- ============================================================
-- ROLLBACK
-- ============================================================
-- create_reservation_order를 Migration 280 원본(2-param, UPDATE에서 selected_coupon_id/
-- selected_points 두 필드 제거)으로 CREATE OR REPLACE 복원 후:
-- ALTER TABLE orders DROP COLUMN IF EXISTS selected_coupon_id;
-- ALTER TABLE orders DROP COLUMN IF EXISTS selected_points;
-- ============================================================
