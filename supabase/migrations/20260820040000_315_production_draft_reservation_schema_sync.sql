-- Migration 315: production DB에 Migration 179(날짜 미정 임시예약) 스키마 변경 누락분 재적용
--
-- 배경(2026-08-20): 실서비스(vnbpmvxruyciuuaermyh)에서 고객이 캘린더로 날짜를 선택하지 않고
-- "예약신청"을 누르면(수량+옵션만으로 임시예약을 만드는 draft 경로) 아래 에러로 실패하는
-- 결함이 실사용 중 발견됨.
--   null value in column "start_date" of relation "rental_reservations" violates
--   not-null constraint
--
-- 조사 결과 Migration 179(20260731000179)가 production에 부분적으로만 적용돼 있었음:
--   - status CHECK 제약에 'draft'/'expired' 포함 → 이미 반영됨
--   - start_date/end_date NOT NULL 해제(STEP 1) → 미반영(이번 결함의 직접 원인)
--   - EXCLUDE 제약에서 draft 상태 제외(STEP 3) → 미반영
-- 스테이지(ezyvffjvuwmtuhpxdjrw)는 두 항목 모두 이미 정상 반영돼 있어(직접 조회로 확인)
-- 이 파일 적용은 스테이지에서는 실질적으로 no-op(동일 정의 재생성), production에서만
-- 실제 스키마가 바뀐다. Migration 179 원본 파일은 수정하지 않고(core-rules.md — 기존
-- 마이그레이션 파일 직접 수정 금지) 신규 파일로 동일 STEP 1·STEP 3만 재적용한다.

-- STEP 1 (179 원본과 동일): start_date/end_date nullable 전환 — 이미 nullable이면 no-op
ALTER TABLE rental_reservations ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE rental_reservations ALTER COLUMN end_date   DROP NOT NULL;

-- STEP 3 (179 원본과 동일): EXCLUDE 제약에서 draft 제외 — draft는 start_date/end_date가
-- NULL이라 daterange(NULL, NULL+1)이 무한대 범위로 해석되어 같은 상품의 모든 예약과
-- 항상 "겹침" 오판이 발생하므로 반드시 제외해야 함
ALTER TABLE rental_reservations DROP CONSTRAINT IF EXISTS rental_reservations_product_dates_excl;
ALTER TABLE rental_reservations
  ADD CONSTRAINT rental_reservations_product_dates_excl
  EXCLUDE USING gist (
    product_id WITH =,
    daterange(start_date, end_date + 1, '[)') WITH &&
  )
  WHERE (status <> ALL (ARRAY['cancelled', 'returned', 'completed', 'expired', 'draft']::text[]));
