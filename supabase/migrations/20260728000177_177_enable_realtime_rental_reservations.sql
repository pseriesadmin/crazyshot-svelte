-- Migration 177: rental_reservations Realtime 활성화
-- /cms/rentals 대여현황 실시간 갱신을 위해 퍼블리케이션 등록 및 REPLICA IDENTITY 설정

ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_reservations;
ALTER TABLE public.rental_reservations REPLICA IDENTITY FULL;
