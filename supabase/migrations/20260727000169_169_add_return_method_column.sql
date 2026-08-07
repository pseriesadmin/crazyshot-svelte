-- Migration 169: rental_reservations.return_method 컬럼 정합성 복구
-- 배경: 과거 세션에서 Stage DB에 직접 추가되었으나 마이그레이션 파일로 저장되지 않아
--      Production에 누락됨. create_hold_reservation RPC가 INSERT 시 return_method
--      컬럼을 참조하여 Production에서 "column does not exist" 에러 발생 (2026-07-27 발견)
-- IF NOT EXISTS: Stage(이미 존재)/Production(미존재) 양쪽에 안전하게 적용

ALTER TABLE rental_reservations
  ADD COLUMN IF NOT EXISTS return_method TEXT;
