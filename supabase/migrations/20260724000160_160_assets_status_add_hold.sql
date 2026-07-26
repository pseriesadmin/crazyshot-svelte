-- Migration 160: assets.status 체크 제약에 'hold' 추가
-- hold 예약 생성 시 asset을 hold 상태로 전환하기 위해 필요

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_status_check;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_status_check
  CHECK (status = ANY (ARRAY['available'::text, 'hold'::text, 'rented'::text, 'maintenance'::text, 'retired'::text]));
