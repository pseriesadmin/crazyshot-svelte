-- Migration 343: 두발히어로(dhero) 배송사 API 실연동
-- Stage(ezyvffjvuwmtuhpxdjrw) 우선 검증 → Production 적용은 [NEXT] 태스크
--
-- 포함 내용:
--   A. rental_reservations에 dhero_* 컬럼 6개 추가
--   B. update_reservation_dhero_shipment RPC 신설 (service_role 전용)
--      rental_reservations.id = BIGINT (not UUID) — Migration 140 확인
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.update_reservation_dhero_shipment(BIGINT,TEXT,TEXT,TEXT,SMALLINT,TEXT,JSONB,TEXT);
--   ALTER TABLE rental_reservations
--     DROP COLUMN IF EXISTS dhero_status,
--     DROP COLUMN IF EXISTS dhero_status_code,
--     DROP COLUMN IF EXISTS dhero_return_book_id,
--     DROP COLUMN IF EXISTS dhero_dong_group,
--     DROP COLUMN IF EXISTS dhero_synced_at,
--     DROP COLUMN IF EXISTS dhero_meta;

-- ============================================================
-- A. rental_reservations — dhero 배송 상태 컬럼 추가
-- ============================================================
ALTER TABLE rental_reservations
  ADD COLUMN IF NOT EXISTS dhero_status       TEXT,        -- 사람이 읽을 수 있는 배송 상태(예: '출고완료')
  ADD COLUMN IF NOT EXISTS dhero_status_code  SMALLINT,    -- 두발히어로 숫자 상태코드(0~12)
  ADD COLUMN IF NOT EXISTS dhero_return_book_id TEXT,      -- 반품 운송장 번호 (registerReturn 결과)
  ADD COLUMN IF NOT EXISTS dhero_dong_group   TEXT,        -- 지역분류코드(dongGroup)
  ADD COLUMN IF NOT EXISTS dhero_synced_at    TIMESTAMPTZ, -- 마지막 dhero API 동기화 시각
  ADD COLUMN IF NOT EXISTS dhero_meta         JSONB;       -- 라이더정보·URL·지연사유 등 원본 JSON

-- ============================================================
-- B. update_reservation_dhero_shipment — service_role 전용 RPC
--    두발히어로 API 호출 결과(배송접수·상태갱신)를 rental_reservations에 반영.
--    기존 tracking_number/courier_code 컬럼을 그대로 재사용(§조사결과 A 핵심제약).
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_reservation_dhero_shipment(
  p_reservation_id  BIGINT,       -- rental_reservations.id (BIGINT — Migration 140 확인)
  p_tracking_number TEXT,         -- bookId (두발히어로 운송장 번호)
  p_courier_code    TEXT,         -- 고정값 '두발히어로'
  p_status          TEXT,         -- 사람이 읽을 수 있는 상태 텍스트
  p_status_code     SMALLINT,     -- 두발히어로 숫자 상태코드
  p_dong_group      TEXT,         -- 지역분류코드 (nullable)
  p_meta            JSONB,        -- 원본 API 응답 JSON (nullable)
  p_return_book_id  TEXT DEFAULT NULL -- 반품 bookId (registerReturn 후에만 채움)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role 전용: anon/authenticated 역할에서 호출 불가
  -- (아래 REVOKE/GRANT로 강제 — 이 코드는 이중 방어)
  UPDATE rental_reservations
  SET
    tracking_number    = p_tracking_number,
    courier_code       = p_courier_code,
    dhero_status       = p_status,
    dhero_status_code  = p_status_code,
    dhero_dong_group   = p_dong_group,
    dhero_meta         = p_meta,
    dhero_synced_at    = NOW(),
    dhero_return_book_id = COALESCE(p_return_book_id, dhero_return_book_id),
    updated_at         = NOW()
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id;
  END IF;
END;
$$;

-- service_role 전용 권한 설정
REVOKE ALL ON FUNCTION public.update_reservation_dhero_shipment(BIGINT,TEXT,TEXT,TEXT,SMALLINT,TEXT,JSONB,TEXT)
  FROM PUBLIC, anon, authenticated;
-- service_role은 SUPERUSER라 별도 GRANT 불필요하나 명시적으로 남김
GRANT EXECUTE ON FUNCTION public.update_reservation_dhero_shipment(BIGINT,TEXT,TEXT,TEXT,SMALLINT,TEXT,JSONB,TEXT)
  TO service_role;
