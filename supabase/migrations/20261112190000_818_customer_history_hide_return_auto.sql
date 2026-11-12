-- Migration 818: 고객용 상품 이력 조회에서 '반납 등록 자동 반영' 이력 제외 (2026-11-12, Stephen '관리자 전용으로 수정', sp5 SEC-001 HIGH)
--
-- 배경: 예약이 완료로 마감될 때 서버(recordReturnHistory.ts)가 고객 반납 제출·관리자 등록·검수 이슈 사진을 해당 재고 상품 이력에 자동 기록한다(사진 주소에 /return_history/ 포함).
--       고객용 get_product_history_for_customer 는 호출 고객의 예약 재고 상품(product_id) 이력 전체를 돌려줘, 같은 재고를 나중에 빌린 다른 고객에게
--       이전 고객의 반납 사진·코멘트가 보일 수 있었다. 이 이력은 CMS 직원 전용이다.
-- 변경: 함수 본문은 Migration 257 정의 그대로이고, 이미지 주소에 /return_history/ 가 들어 있는 이력 행만 결과에서 제외한다. 권한(authenticated 만 실행)은 그대로.
-- 영향: 고객 마이페이지 이력 화면에서 자동 반영분이 보이지 않는다. 고객이 직접 등록한 이력·관리자 수동 등록 이력은 기존과 동일(이 범위 밖 정책은 변경하지 않음).
-- 롤백: Migration 257 의 get_product_history_for_customer 정의로 CREATE OR REPLACE.

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
      -- 반납 등록 자동 반영 이력(CMS 직원 전용) 제외 — 이미지 주소에 /return_history/ 가 있는 행
      AND NOT (
        CASE WHEN jsonb_typeof(h.images) = 'array'
          THEN EXISTS (SELECT 1 FROM jsonb_array_elements(h.images) AS img WHERE img->>'url' LIKE '%/return_history/%')
          ELSE false
        END
      )
    ORDER BY h.recorded_date DESC, h.created_at DESC;
END;
$$;

REVOKE ALL     ON FUNCTION get_product_history_for_customer(BIGINT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_product_history_for_customer(BIGINT) TO authenticated;
