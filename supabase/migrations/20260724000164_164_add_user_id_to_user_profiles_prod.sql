-- Migration #164: user_profiles에 user_id 컬럼 추가 (Production 누락 보완)
-- 원인: Stage DB에는 user_id 컬럼 존재, Production DB에는 미적용 상태
--       Migration #163 트리거가 INSERT(id, user_id, email) 실행 → Production 컬럼 없음 → Auth signup 500
-- 수정: user_id 컬럼 추가 → 기존 행 id로 초기화 → NOT NULL 제약 적용

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- 기존 행: id 값과 동일하게 초기화
UPDATE public.user_profiles
SET user_id = id
WHERE user_id IS NULL;

-- NOT NULL 제약 적용
ALTER TABLE public.user_profiles
  ALTER COLUMN user_id SET NOT NULL;
