-- Migration 268: rental_reservations 운송장 추적 컬럼 추가 + 관리자 전용 RPC
-- stage 전용 (production 배포 보류 — GATE E 스텁 상태, API 키 확보 후 라이브 전환)

-- 1. 컬럼 추가
ALTER TABLE rental_reservations
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS courier_code    TEXT;

-- 2. 관리자 전용 운송장 정보 업데이트 RPC
--    SECURITY DEFINER + is_cms_user() 내부 검증 — 직접 DML 금지(H-01) 준수
--    호출 방식: locals.supabase(관리자 실세션) 전용
--               service_role 호출 시 auth.uid()=null → is_cms_user() 거부됨

CREATE OR REPLACE FUNCTION public.update_reservation_tracking(
  p_reservation_id  BIGINT,
  p_tracking_number TEXT,
  p_courier_code    TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- CMS 관리자 권한 검증 (auth.uid() 기반 — locals.supabase 세션 호출 시에만 통과)
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'permission denied: cms role required';
  END IF;

  -- rental_reservations에는 deleted_at 컬럼이 없음(소프트삭제 미지원) — 2026-08-16 재검증 시
  -- 존재하지 않는 컬럼 필터로 이 RPC가 매번 실패하던 버그 발견·제거
  UPDATE rental_reservations
  SET
    tracking_number = p_tracking_number,
    courier_code    = p_courier_code,
    updated_at      = NOW()
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id;
  END IF;
END;
$$;

-- 3. 권한 설정
--    "REVOKE FROM PUBLIC, anon, authenticated 후 GRANT TO authenticated" 패턴
--    (anon만 REVOKE하면 PUBLIC의 암묵적 EXECUTE 권한이 남아 무력화되는 함정 방지)
REVOKE ALL ON FUNCTION public.update_reservation_tracking(BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_tracking(BIGINT, TEXT, TEXT)
  TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.update_reservation_tracking(BIGINT, TEXT, TEXT);
-- ALTER TABLE rental_reservations DROP COLUMN IF EXISTS tracking_number;
-- ALTER TABLE rental_reservations DROP COLUMN IF EXISTS courier_code;
-- ============================================================
