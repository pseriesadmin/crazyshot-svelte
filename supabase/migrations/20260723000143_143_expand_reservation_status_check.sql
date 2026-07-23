-- Migration 143: rental_reservations status 체크 제약 확장
-- 기존: pending | confirmed | active | completed | cancelled
-- 추가: hold | shipped | in_use | return_requested | returned | damage_claimed
-- 기존값(pending, active)은 호환성 유지를 위해 보존

ALTER TABLE rental_reservations
  DROP CONSTRAINT IF EXISTS rental_reservations_status_check;

ALTER TABLE rental_reservations
  ADD CONSTRAINT rental_reservations_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'hold'::text,
    'confirmed'::text,
    'active'::text,
    'shipped'::text,
    'in_use'::text,
    'return_requested'::text,
    'returned'::text,
    'completed'::text,
    'cancelled'::text,
    'damage_claimed'::text
  ]));
