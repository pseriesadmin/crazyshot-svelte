-- migration #581: delete_own_product_review RPC — 상품 후기 "본인 후기 영구 삭제"
-- product_reviews에는 DELETE 정책·RPC가 없어 본인 후기도 지울 수 없었다(#580 댓글 삭제와 동일 패턴).
-- H-01(직접 DML 금지) 원칙에 따라 RLS DELETE 정책을 열지 않고 SECURITY DEFINER RPC로만 제공.
--  · 로그인(auth.uid() 필수) 사용자가 본인(user_id = auth.uid())이 작성한 후기만 삭제
--  · 남의 후기·없는 id는 아무 것도 지우지 않고 FALSE 반환, anon 실행 불가

CREATE OR REPLACE FUNCTION public.delete_own_product_review(p_review_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count   INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  DELETE FROM public.product_reviews
   WHERE id = p_review_id
     AND user_id = v_user_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_product_review(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_own_product_review(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_own_product_review(UUID) TO authenticated;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.delete_own_product_review(UUID);
