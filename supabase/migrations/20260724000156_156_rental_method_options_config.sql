-- Migration #156: rental_method_options 설정 컬럼 추가
-- checkout ↔ CMS 대여정보 탭 수령/반납 방식 DB 연동을 위한 필수 컬럼
-- method_key       : 코드값 (crazydelivery, quick, locker, visit, epost, airport 등)
-- fee_amount       : 배송요금 정수값 (원, 0 = 무료 or 착불)
-- fee_description  : 배송요금 표시 문구 (예: 'CRAZY등급 무료 / 3,500원')
-- deadline_time    : 마감 시각 문구 (예: '15:00 마감')
-- is_free_for_top_grade : CRAZY 등급 무료 여부

ALTER TABLE public.rental_method_options
  ADD COLUMN IF NOT EXISTS method_key            TEXT,
  ADD COLUMN IF NOT EXISTS fee_amount            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_description       TEXT,
  ADD COLUMN IF NOT EXISTS deadline_time         TEXT,
  ADD COLUMN IF NOT EXISTS is_free_for_top_grade BOOLEAN NOT NULL DEFAULT false;

-- method_key 유니크 인덱스 (배송 방식 코드 조회 최적화)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_method_options_method_key
  ON public.rental_method_options(method_key)
  WHERE method_key IS NOT NULL AND deleted_at IS NULL;
