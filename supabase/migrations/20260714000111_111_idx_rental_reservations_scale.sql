-- Migration 111: rental_reservations 규모 대응 복합 인덱스
-- 근거: 100K건/월 → 12개월 1.2M rows에서 date range scan 한계 도달.
--       운영 핵심 쿼리 패턴 3종 커버링.

-- NOTE: rental_reservations에 deleted_at 컬럼 없음 → WHERE 조건 제거
-- NOTE: 컬럼명 rental_start_date/rental_end_date 없음 → start_date/end_date 사용

-- 1. 날짜 범위 필터 인덱스 (CMS 대시보드·이력조회 created_at 기준 필터 필수)
CREATE INDEX IF NOT EXISTS idx_rental_reservations_created_at
  ON rental_reservations(created_at DESC);

-- 2. 운영 핵심 복합 인덱스 (status + 날짜 범위 동시 필터 — 가장 빈번한 쿼리 패턴)
CREATE INDEX IF NOT EXISTS idx_rental_reservations_status_dates
  ON rental_reservations(status, start_date, end_date);

-- 3. user_id + created_at 복합 (마이페이지·고객별 이력: WHERE user_id=X ORDER BY created_at)
CREATE INDEX IF NOT EXISTS idx_rental_reservations_user_created
  ON rental_reservations(user_id, created_at DESC);

-- 단일 user_id 인덱스는 위 복합 인덱스가 포함하므로 제거
DROP INDEX IF EXISTS idx_rental_reservations_user_id;
