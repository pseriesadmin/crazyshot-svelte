-- Migration 452: rental_reservations에 pickup_point_id/return_point_id 컬럼 추가
--
-- 원래 최초 스키마 마이그레이션(20260529000010_10_rental_reservations.sql, 2026-05-29)에
-- 정의돼 있었으나 실제 Stage·Production DB 어디에도 반영된 적이 없었다(2026-09-07 확인 —
-- contract-data API(src/routes/api/cms/reservations/[id]/contract-data/+server.ts)가 이
-- 컬럼을 조회하며 500 에러 발생 중이었음). 기존 마이그레이션 파일은 수정하지 않고(위반
-- 금지 원칙) 신규 마이그레이션으로 컬럼만 추가한다.
--
-- CS2654 C2(지점옵션) 기능은 컬럼 추가만으로 완성되지 않는다 — 예약 생성/수정 시 이 값을
-- 실제로 채워 넣는 경로는 별도 스코프(Stephen 확정, 2026-09-07). 지금은 500 에러 해소만 목적.

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS pickup_point_id UUID REFERENCES public.pickup_points(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_point_id UUID REFERENCES public.pickup_points(id) ON DELETE SET NULL;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE public.rental_reservations
--   DROP COLUMN IF EXISTS pickup_point_id,
--   DROP COLUMN IF EXISTS return_point_id;
-- ============================================================
