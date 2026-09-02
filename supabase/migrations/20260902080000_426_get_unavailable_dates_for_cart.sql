-- Migration 426: get_unavailable_dates_for_cart RPC
-- 장바구니 대여예약옵션 캘린더 ↔ 실제 날짜별 재고 동기화 (2026-09-02, Stephen 승인 — "요구사항 1")
--
-- 배경: 장바구니 "대여예약옵션" 패널의 수령일/반납일 캘린더(CalendarGrid)가 실제 재고와
-- 무관하게 순수 날짜 계산(오늘 이전/휴무일)만으로 비활성 날짜를 결정하고 있었다. 장바구니에
-- 담긴(체크된) 상품들 중 어느 하나라도 해당 일자에 필요한 수량만큼 가용 재고가 없으면, 그
-- 날짜는 선택 자체가 불가능해야 한다는 요구사항을 반영한다.
--
-- 계산 기준: create_hold_reservation의 재고 배정 로직(동일 기간에 겹치는 비종결 상태 예약이
-- 없는 자식 상품만 가용)과 동일한 날짜-겹침 판정을 재사용하되, 날짜 범위별로 배치 계산한다.
--
-- 두 가지 호출 모드:
--   p_fixed_start가 NULL이면 — 수령일 캘린더용. 후보일 d 각각을 "[d,d] 1일 대여"로 가정해
--     가용성을 확인한다(더 긴 기간을 고르면 그 상위집합이라 최소한 이 조건은 만족해야 함 —
--     보수적 사전 필터, 반납일 확정 후 실제 배정에서 최종 검증됨).
--   p_fixed_start가 주어지면 — 반납일 캘린더용(수령일이 이미 확정됨). 후보일 d 각각을
--     "[p_fixed_start, d] 전체 기간"으로 실제 가용성을 확인한다.
--
-- p_product_ids/p_qty_needed는 인덱스로 대응되는 병렬 배열(장바구니 체크된 각 그룹의
-- 부모상품id·수량). 반환된 날짜 중 하나라도 걸리면 그 날짜는 캘린더에서 비활성화 대상이다.

CREATE OR REPLACE FUNCTION public.get_unavailable_dates_for_cart(
  p_product_ids UUID[],
  p_qty_needed  INT[],
  p_range_start DATE,
  p_range_end   DATE,
  p_fixed_start DATE DEFAULT NULL
)
RETURNS TABLE(unavailable_date DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN; -- 비로그인 — 장바구니 자체가 로그인 필요라 호출측이 빈 결과로 안전 처리
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series(p_range_start, p_range_end, '1 day'::interval)::date AS d
  ),
  items AS (
    SELECT product_id, qty_needed
    FROM unnest(p_product_ids, p_qty_needed) AS t(product_id, qty_needed)
  ),
  children AS (
    SELECT c.id, c.parent_product_id
    FROM products c
    WHERE c.parent_product_id = ANY(p_product_ids)
      AND c.is_active = true AND c.deleted_at IS NULL
  ),
  totals AS (
    SELECT parent_product_id, COUNT(*) AS total_active FROM children GROUP BY parent_product_id
  ),
  windows AS (
    SELECT
      d.d AS day,
      LEAST(COALESCE(p_fixed_start, d.d), d.d) AS win_start,
      GREATEST(COALESCE(p_fixed_start, d.d), d.d) AS win_end
    FROM days d
  ),
  occupied AS (
    SELECT w.day, ch.parent_product_id, COUNT(DISTINCT ch.id) AS occupied_count
    FROM windows w
    JOIN children ch ON true
    JOIN rental_reservations rr
      ON rr.product_id = ch.id
      AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired')
      AND daterange(rr.start_date, rr.end_date, '[]') && daterange(w.win_start, w.win_end, '[]')
    GROUP BY w.day, ch.parent_product_id
  )
  SELECT DISTINCT w.day
  FROM windows w
  CROSS JOIN items i
  LEFT JOIN totals t ON t.parent_product_id = i.product_id
  LEFT JOIN occupied o ON o.day = w.day AND o.parent_product_id = i.product_id
  WHERE GREATEST(0, COALESCE(t.total_active, 0) - COALESCE(o.occupied_count, 0)) < i.qty_needed
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unavailable_dates_for_cart(UUID[], INT[], DATE, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unavailable_dates_for_cart(UUID[], INT[], DATE, DATE, DATE) TO authenticated;
