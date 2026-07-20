-- Rollback: Migration #124 — product_reviews
-- 적용 대상: Stage(ezyvffjvuwmtuhpxdjrw) / Production(vnbpmvxruyciuuaermyh)
-- 실행 전 주의: 기존 리뷰 데이터가 모두 삭제됩니다. 백업 후 실행할 것.

-- 1. GRANT 회수
REVOKE EXECUTE ON FUNCTION public.create_product_review FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_product_reviews FROM anon, authenticated;

-- 2. RPC 함수 제거
DROP FUNCTION IF EXISTS public.create_product_review(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.get_product_reviews(UUID, INT, INT);

-- 3. RLS 정책 제거
DROP POLICY IF EXISTS "public_select_product_reviews" ON public.product_reviews;
DROP POLICY IF EXISTS "authenticated_insert_product_reviews" ON public.product_reviews;

-- 4. 인덱스 제거
DROP INDEX IF EXISTS public.product_reviews_product_id_idx;

-- 5. 테이블 제거 (데이터 전체 삭제)
DROP TABLE IF EXISTS public.product_reviews;
