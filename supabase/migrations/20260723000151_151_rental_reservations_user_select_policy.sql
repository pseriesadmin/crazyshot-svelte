-- Migration 151: rental_reservations 사용자 SELECT RLS 정책 추가
-- 인증된 사용자가 자신의 예약 데이터를 직접 조회할 수 있도록 허용

CREATE POLICY "user_own_reservations_select"
  ON public.rental_reservations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
