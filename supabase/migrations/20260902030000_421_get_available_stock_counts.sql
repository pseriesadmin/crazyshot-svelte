-- Migration 421: get_available_stock_counts RPC
-- 상품상세·장바구니 수량 UI ↔ 실제 재고 동기화 (2026-09-02, Stephen GATE B 승인)
--
-- 배경: 상품상세/장바구니의 수량(±) 스테퍼가 실제 등록 재고와 무관한 하드코딩 상한
-- (MAX_RESERVATION_QTY=10)만 참조하고 있었다(옵션 상품은 상한 자체가 없었음). 이 RPC는
-- 여러 부모상품 id를 한 번에 받아 "지금 이 순간 대여 가능한 재고 수"를 계산해 반환한다
-- (find_matching_cart_reservation_group과 동일하게, 여러 호출부의 N+1/개별 재구현을
-- 막기 위해 단일 배치 RPC로 제공).
--
-- 계산 기준(Stephen 확정 — 날짜 무관, 현재 시점 점유 여부만):
--   available = (활성 자식 수) - (그 중 현재 비종결 상태 예약이 걸려있는 자식 수)
--   비종결 상태 = hold/confirmed/shipped/in_use/return_requested
--     (products.md §6 "상태별 재고 카운트 칩"의 버킷 정의와 동일 — cancelled/returned/
--      completed/expired는 재고를 점유하지 않은 것으로 간주)
--   이 계산은 대여 희망 기간(날짜)을 고려하지 않는 보수적 근사치다 — 실제 배정 가능
--   여부의 최종 판정은 여전히 create_hold_reservation의 날짜 기준 원자적 배정이 담당한다
--   (이 RPC는 UI 사전차단용 스냅샷일 뿐, 예약 생성 로직 자체를 대체하지 않음).
--
-- 옵션 상품도 동일한 products 테이블의 부모 상품이므로 이 RPC 하나로 메인 상품·옵션
-- 상품 양쪽 모두의 가용 재고를 함께 조회할 수 있다.
--
-- 공개 상품상세 페이지(비로그인 방문자 포함)에서 호출되므로 anon에게도 EXECUTE 권한을
-- 부여한다 — products_public_read 정책과 달리 이 함수는 SECURITY DEFINER로 자식 상품·
-- 예약 원본 행을 직접 노출하지 않고 집계된 개수만 반환한다.

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
  SELECT
    parent.id AS product_id,
    GREATEST(
      0,
      COUNT(DISTINCT child.id) FILTER (
        WHERE child.is_active = true AND child.deleted_at IS NULL
      )
      -
      COUNT(DISTINCT rr.product_id) FILTER (
        WHERE child.is_active = true AND child.deleted_at IS NULL
          AND rr.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested')
      )
    )::INT AS available_count
  FROM unnest(p_product_ids) AS parent(id)
  LEFT JOIN products child ON child.parent_product_id = parent.id
  LEFT JOIN rental_reservations rr ON rr.product_id = child.id
  GROUP BY parent.id;
$$;

REVOKE ALL ON FUNCTION public.get_available_stock_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_available_stock_counts(UUID[]) TO anon, authenticated;
