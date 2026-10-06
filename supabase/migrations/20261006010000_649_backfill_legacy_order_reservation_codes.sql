-- Migration 649: Migration 400(2026-08-31) 이전에 만들어진 옛 주문의 예약코드를 주문 대표 코드로 통일 (백필)
--
-- 배경: 예약코드 = 장바구니 1회 신청(묶음 상품·옵션 포함)에 부여되는 단일 최상위 코드(Stephen 확정 2026-10-06).
--       Migration 400이 create_reservation_order에서 주문 내 예약 전체를 대표 코드(주문 내 MIN(reservation_id)의 코드)로
--       통일하도록 했지만, 그 이전에 만든 주문(Production 10건·예약 33건)은 예약마다 다른 코드가 남아 있다.
-- 규칙: 400과 동일 — 주문 내 MIN(reservation_id) 예약의 코드를 대표값으로 그 주문의 모든 예약에 적용.
-- 성질: 데이터 UPDATE만(함수·스키마 변경 없음), 멱등(이미 통일된 주문은 영향 0행), 상태·금액·날짜 불변.
-- 영구 결번: 통일로 사라지는 옛 코드는 재사용하지 않는다(채번 시퀀스는 단조 증가 유지).
-- 과거 채팅 메시지 본문에 박힌 옛 코드는 이력 보존을 위해 수정하지 않는다.
--
-- ROLLBACK(적용 전 reservation_id별 옛 코드 매핑을 TASK.md "#649 롤백 매핑"에 기록해 둠):
--   UPDATE rental_reservations r SET reservation_code = v.code
--   FROM (VALUES (id, 'old_code'), ...) AS v(id, code) WHERE r.id = v.id;

WITH multi AS (
  SELECT oi.order_id, MIN(oi.reservation_id) AS rep_id
  FROM order_items oi
  JOIN rental_reservations r ON r.id = oi.reservation_id
  GROUP BY oi.order_id
  HAVING COUNT(DISTINCT r.reservation_code) > 1
), rep AS (
  SELECT m.order_id, r.reservation_code AS rep_code
  FROM multi m
  JOIN rental_reservations r ON r.id = m.rep_id
  WHERE r.reservation_code IS NOT NULL
)
UPDATE rental_reservations r
SET reservation_code = rep.rep_code
FROM order_items oi
JOIN rep ON rep.order_id = oi.order_id
WHERE oi.reservation_id = r.id
  AND r.reservation_code IS DISTINCT FROM rep.rep_code;
