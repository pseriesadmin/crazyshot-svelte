-- Migration #119: user_posts 로그 타입 3종으로 축소 + thumbnail_url 컬럼 추가
-- 작업: 기존 CHECK 제약 삭제 → 새 3종 제약 추가 + thumbnail_url TEXT 컬럼 추가
-- 적용 순서: crazyshot-stage (ezyvffjvuwmtuhpxdjrw) → crazyshot (vnbpmvxruyciuuaermyh)

BEGIN;

-- ① 기존 데이터 log_type → 새 값으로 일괄 전환 (CHECK 변경 전 필수)
UPDATE public.user_posts
SET log_type = '상품리뷰'
WHERE log_type IS NOT NULL
  AND log_type NOT IN ('상품리뷰', '일상공유', '채널홍보');

-- ② 기존 log_type CHECK 제약 삭제
ALTER TABLE public.user_posts
  DROP CONSTRAINT IF EXISTS user_posts_log_type_check;

-- ③ 새 log_type CHECK 제약 추가 (3종)
ALTER TABLE public.user_posts
  ADD CONSTRAINT user_posts_log_type_check
  CHECK (log_type IN ('상품리뷰', '일상공유', '채널홍보'));

-- ④ thumbnail_url 컬럼 추가 (리스트 썸네일용)
ALTER TABLE public.user_posts
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

COMMIT;

/*
  ROLLBACK (적용 취소 시):
  BEGIN;
    ALTER TABLE public.user_posts DROP CONSTRAINT IF EXISTS user_posts_log_type_check;
    ALTER TABLE public.user_posts ADD CONSTRAINT user_posts_log_type_check
      CHECK (log_type IN ('일상 로그','여행 로그','맛집 로그','운동 로그','독서 로그','영화·드라마 로그','공부 로그','취미 로그'));
    ALTER TABLE public.user_posts DROP COLUMN IF EXISTS thumbnail_url;
  COMMIT;
*/
