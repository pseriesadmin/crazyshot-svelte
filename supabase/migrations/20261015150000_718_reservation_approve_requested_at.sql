-- Migration #718: 예약에 '승인 요청 시각' 추가 (2026-10-15, Stephen 확정)
--
-- 배경: '예약승인'을 눌렀는데 고객의 본인증명 서류가 미등록·승인 대기라 계약서를 바로 보내지 못한 예약을 기억해야, 관리자가 고객 서류를 승인하는 순간
--   "예약승인을 눌렀던 예약만" 전자계약을 자동 발행·발송할 수 있다(누르지 않은 예약에는 보내지 않는다).
-- 변경: rental_reservations.approve_requested_at timestamptz NULL — 예약승인 클릭 시 서류 미승인이면 기록, 서류 승인 후 자동발행 처리 때(성공·실패 무관) 비운다.
--   기존 행은 NULL(= 요청 없음)이라 동작 변화 없음. 컬럼 기본값·NOT NULL 없음. 권한은 기존 테이블 권한 그대로.
-- 롤백: DROP INDEX IF EXISTS idx_rr_approve_requested; ALTER TABLE public.rental_reservations DROP COLUMN IF EXISTS approve_requested_at;

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS approve_requested_at timestamptz;

COMMENT ON COLUMN public.rental_reservations.approve_requested_at IS
  '관리자가 예약승인을 눌렀으나 본인증명 서류 미승인으로 대기 중인 시각. 서류 승인 시 자동발행 후 NULL로 비운다.';

CREATE INDEX IF NOT EXISTS idx_rr_approve_requested
  ON public.rental_reservations (user_id)
  WHERE approve_requested_at IS NOT NULL;
