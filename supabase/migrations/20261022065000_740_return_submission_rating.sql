-- Migration 740 — 반납 제출 이용 평가 점수(1~5) 컬럼 (2026-10-22)
--
-- 배경: 반납등록 미션 3단계(이용 평가)에 5개 점수 아이콘이 추가됐다(Stephen 지시). 점수도 반납 제출 기록에 함께 저장하고 CMS 검수 탭에서 읽는다.
-- 739(customer_feedback 글)와 같은 테이블·같은 정책: 선택 입력(NULL 허용), 서버 전용 테이블(RLS 정책 없음).

ALTER TABLE public.reservation_return_submissions
  ADD COLUMN IF NOT EXISTS customer_rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservation_return_submissions_rating_range'
       AND conrelid = 'public.reservation_return_submissions'::regclass
  ) THEN
    ALTER TABLE public.reservation_return_submissions
      ADD CONSTRAINT reservation_return_submissions_rating_range
      CHECK (customer_rating IS NULL OR customer_rating BETWEEN 1 AND 5);
  END IF;
END $$;

COMMENT ON COLUMN public.reservation_return_submissions.customer_rating IS
  '고객 이용 평가 점수 1~5(반납등록 미션 3단계, 선택) — CMS 검수 탭에서 읽기 전용으로 표시';

-- ── ROLLBACK(참고용) ──
-- ALTER TABLE public.reservation_return_submissions DROP CONSTRAINT IF EXISTS reservation_return_submissions_rating_range;
-- ALTER TABLE public.reservation_return_submissions DROP COLUMN IF EXISTS customer_rating;
