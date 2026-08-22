-- Migration 320: 무인보관함(영업외시간) 안내 시스템 — 비밀번호 컬럼 + 발송이력 컬럼 + RPC 2종
-- (파일 원래 번호는 318이었으나, 병렬 세션이 동시에 만든 다른 마이그레이션과 번호가 겹쳐
-- 320으로 리네임함 — Stage에는 이미 "318_locker_guide_schema"라는 이름으로 적용·기록되어
-- 있어 DB 마이그레이션 이력 자체는 그대로 두고 로컬 파일명·주석 표기만 정정, 2026-08-20)
--
-- 배경: 09:00~22:00=방문배송 정상영업시간 / 23:00~08:00=영업외시간으로 규정. 방문대여(visit)
-- 선택 + 영업외시간 조합 시 무인보관함(락커) 인계로 부분 반영(pickup_method/return_method DB
-- 값은 'visit' 그대로 유지 — service-operations.md·rental-lifecycle.md 대상 아님, DB 값 전환 없음).
--
-- ⛔ 시간대 주의: rr.pickup_time/return_time은 고객이 화면에서 선택한 KST(한국시간) 벽시계
-- 값을 그대로 담은 TEXT("HH:MM")다. DB 세션 기본 timezone은 UTC(SHOW timezone 직접 확인,
-- 2026-08-20)이므로 `(date + time)`을 naive timestamp로 만든 뒤 그대로 now()(timestamptz)와
-- 비교하면 9시간 오차가 생긴다 — 반드시 `AT TIME ZONE 'Asia/Seoul'`로 KST→UTC 변환 후 비교
-- (rental-lifecycle.md의 auto_send_return_remind cron 스케줄 KST→UTC 환산과 동일 원칙).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 먼저 검증 → crazyshot production
-- (vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

-- 1. 컬럼 추가
ALTER TABLE rental_reservations
  ADD COLUMN IF NOT EXISTS locker_password              TEXT,
  ADD COLUMN IF NOT EXISTS locker_guide_sent_pickup_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locker_guide_sent_return_at   TIMESTAMPTZ;

-- 2. 관리자 전용 비밀번호 업데이트 RPC
--    update_reservation_tracking(Migration 268)과 동일 패턴 — SECURITY DEFINER + is_cms_user()
--    내부 검증(H-01 준수). manager 이상 게이팅은 앱 레이어(hasSettingsAccess)에서 별도 수행 —
--    이 RPC 자체는 "CMS 사용자 여부"만 검증(모든 CMS 역할 공통 하한선).
CREATE OR REPLACE FUNCTION public.update_reservation_locker_password(
  p_reservation_id BIGINT,
  p_password        TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'permission denied: cms role required';
  END IF;

  UPDATE rental_reservations
  SET
    locker_password = p_password,
    updated_at      = NOW()
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found: %', p_reservation_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reservation_locker_password(BIGINT, TEXT)
  TO authenticated;

-- 3. Vercel Cron 전용 원자적 선점 RPC — claim_subscriptions_due_for_billing(Migration 259)과
--    동일한 "FOR UPDATE SKIP LOCKED 후 UPDATE...RETURNING" 패턴. pickup leg/return leg는
--    서로 다른 컬럼(locker_guide_sent_pickup_at/return_at)을 갱신하므로 순차 두 개의
--    독립 UPDATE 문(RETURN QUERY 2회)으로 분리 — 동일 WITH절 내 동일 테이블 다중 DML의
--    "unspecified 동시성" 위험을 피하기 위함(공식 문서 경고 사항).
CREATE OR REPLACE FUNCTION public.claim_reservations_due_for_locker_guide(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  reservation_id BIGINT,
  leg            TEXT,
  phone          TEXT,
  password       TEXT,
  product_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- pickup leg: 방문대여 + 영업외시간(23:00~08:59) + 수령시각 1시간 이내 임박
  RETURN QUERY
  UPDATE rental_reservations rr
  SET locker_guide_sent_pickup_at = now()
  WHERE rr.id IN (
    SELECT r.id FROM rental_reservations r
    WHERE r.pickup_method = 'visit'
      AND r.status IN ('confirmed', 'shipped')
      AND r.locker_password IS NOT NULL
      AND r.locker_guide_sent_pickup_at IS NULL
      AND r.pickup_time IS NOT NULL
      AND (EXTRACT(HOUR FROM r.pickup_time::time) = 23 OR EXTRACT(HOUR FROM r.pickup_time::time) < 9)
      AND ((r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul') - now() <= INTERVAL '1 hour'
      AND ((r.start_date + r.pickup_time::time) AT TIME ZONE 'Asia/Seoul') > now()
    ORDER BY r.start_date, r.pickup_time
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING
    rr.id,
    'pickup'::TEXT,
    (SELECT up.phone FROM user_profiles up WHERE up.id = rr.user_id),
    rr.locker_password,
    (SELECT p.name FROM products p WHERE p.id = rr.product_id);

  -- return leg: 방문반납 + 영업외시간 + 반납시각 1시간 이내 임박
  RETURN QUERY
  UPDATE rental_reservations rr
  SET locker_guide_sent_return_at = now()
  WHERE rr.id IN (
    SELECT r.id FROM rental_reservations r
    WHERE r.return_method = 'visit'
      AND r.status IN ('in_use', 'return_requested')
      AND r.locker_password IS NOT NULL
      AND r.locker_guide_sent_return_at IS NULL
      AND r.return_time IS NOT NULL
      AND (EXTRACT(HOUR FROM r.return_time::time) = 23 OR EXTRACT(HOUR FROM r.return_time::time) < 9)
      AND ((r.end_date + r.return_time::time) AT TIME ZONE 'Asia/Seoul') - now() <= INTERVAL '1 hour'
      AND ((r.end_date + r.return_time::time) AT TIME ZONE 'Asia/Seoul') > now()
    ORDER BY r.end_date, r.return_time
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING
    rr.id,
    'return'::TEXT,
    (SELECT up.phone FROM user_profiles up WHERE up.id = rr.user_id),
    rr.locker_password,
    (SELECT p.name FROM products p WHERE p.id = rr.product_id);
END;
$$;

-- service_role 전용 — claim_subscriptions_due_for_billing과 동일하게 Vercel Cron 엔드포인트
-- (service-role 클라이언트)만 호출.
REVOKE ALL ON FUNCTION public.claim_reservations_due_for_locker_guide(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reservations_due_for_locker_guide(INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.claim_reservations_due_for_locker_guide(INTEGER) IS
  '무인보관함 1시간 전 안내(locker_guide) Vercel Cron 전용 — 방문대여/방문반납 + 영업외시간
   (23:00~08:59) + 수령·반납시각 1시간 이내 임박 예약을 원자적으로 선점(FOR UPDATE SKIP
   LOCKED)하고 locker_guide_sent_pickup_at/return_at으로 마킹해 중복발송을 방지한다.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.claim_reservations_due_for_locker_guide(INTEGER);
-- DROP FUNCTION IF EXISTS public.update_reservation_locker_password(BIGINT, TEXT);
-- ALTER TABLE rental_reservations DROP COLUMN IF EXISTS locker_password;
-- ALTER TABLE rental_reservations DROP COLUMN IF EXISTS locker_guide_sent_pickup_at;
-- ALTER TABLE rental_reservations DROP COLUMN IF EXISTS locker_guide_sent_return_at;
-- ============================================================
