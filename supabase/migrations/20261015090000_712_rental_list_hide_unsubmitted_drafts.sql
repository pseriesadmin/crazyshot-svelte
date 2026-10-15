-- Migration #712: 관리자 예약·대여 목록에서 "제출된 적 없는 임시예약(장바구니 담기 잔재)" 숨김 (2026-10-15, Stephen 확정)
--
-- 배경: 상품상세 [장바구니 담기]는 날짜 없는 임시예약(draft)을 만들고, 담은 뒤 수량·옵션을 바꾸면 그 임시예약을 자동 취소한다(2026-10-11 정책).
-- 그래서 취소 상태(cancelled)이면서 날짜가 없고 주문에도 연결된 적 없는 행이 쌓이는데, 이는 고객이 예약신청을 한 적 없는 "장바구니 잔재"라
-- 관리자 '취소·환불' 목록에 섞여 실제 취소 건과 구분되지 않았다(요금 0원·날짜 없음 표시).
--
-- 변경: get_rental_list의 두 모드(예약 단위·주문 단위) WHERE에 "단건 조회(p_reservation_id)가 아니면
--   status='cancelled' AND start_date IS NULL AND 주문 연결 없음 행 제외"를 추가한다. 그 외 로직·시그니처·권한은 그대로.
--   (단건 조회는 허용 — 이미 알고 있는 id로 열람하는 경로는 유지.)
-- 함수 본문은 라이브 정의에서 정확히 일치하는 줄만 치환한다(앵커가 없으면 중단, 이미 적용돼 있으면 건너뜀).
-- 롤백: 아래 두 조건 줄을 제거한 정의로 CREATE OR REPLACE (Migration #618 정의).

DO $$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  a1 text := E'      AND (p_exclude_contract_sent IS NOT TRUE OR cs.sent_at IS NULL)\n    ORDER BY rr.submitted_at DESC';
  a2 text := E'      AND (p_exclude_contract_sent IS NOT TRUE OR g.b_signing_sent_at IS NULL)\n    ORDER BY g.b_created_at DESC';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p
   WHERE p.proname = 'get_rental_list' AND p.pronamespace = 'public'::regnamespace;
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_rental_list 없음'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('미제출 임시예약 제외' IN v_def) > 0 THEN RETURN; END IF;
  IF position(a1 IN v_def) = 0 OR position(a2 IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_rental_list 앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
  END IF;
  v_new := replace(v_def, a1,
    E'      AND (p_exclude_contract_sent IS NOT TRUE OR cs.sent_at IS NULL)\n      -- 미제출 임시예약 제외: 취소됐고 날짜가 없으며 주문에 연결된 적 없는 행(장바구니 담기 잔재)\n      AND (p_reservation_id IS NOT NULL OR NOT (rr.status = ''cancelled'' AND rr.start_date IS NULL AND oi.order_id IS NULL))\n    ORDER BY rr.submitted_at DESC');
  v_new := replace(v_new, a2,
    E'      AND (p_exclude_contract_sent IS NOT TRUE OR g.b_signing_sent_at IS NULL)\n      -- 미제출 임시예약 제외: 취소됐고 날짜가 없으며 주문에 연결된 적 없는 행(장바구니 담기 잔재)\n      AND (p_reservation_id IS NOT NULL OR NOT (g.g_status = ''cancelled'' AND g.b_rental_start IS NULL AND g.b_order_id IS NULL))\n    ORDER BY g.b_created_at DESC');
  EXECUTE v_new;
END $$;
