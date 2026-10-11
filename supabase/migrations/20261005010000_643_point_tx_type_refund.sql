-- Migration #643: 포인트 원장 유형에 'refund'(환원) 추가 (2026-10-05, CRITICAL — 주문 취소 시 쿠폰·포인트 환원 선행)
--
-- 배경: point_transactions.type(point_tx_type)은 earn/use/expire/admin_grant/admin_deduct뿐이라, 주문 취소로 사용 포인트를
--   되돌릴 때 "신규 적립(earn)"이나 "관리자 지급(admin_grant)"으로 기록하면 총 발행·사용 통계가 왜곡된다. 별도 유형 'refund'로 기록한다.
--   (새 enum 값은 같은 트랜잭션에서 쓸 수 없어 사용은 Migration #644에서 한다.)
--
-- ROLLBACK: PostgreSQL enum은 값을 삭제할 수 없다 — 롤백이 필요하면 'refund' 행이 없는지 확인한 뒤 그대로 두는 것을 권장
--   (사용처인 Migration #644의 함수·트리거만 제거하면 'refund' 값은 무해하다).

ALTER TYPE public.point_tx_type ADD VALUE IF NOT EXISTS 'refund';
