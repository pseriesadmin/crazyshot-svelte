-- Migration #124: product_reviews 테이블 + RPC
-- 상품 후기 저장 (인증 사용자 전용 작성, 공개 리뷰 누구나 읽기)

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id   UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name  TEXT,
  title        TEXT        NOT NULL,
  content      TEXT        NOT NULL,
  is_public    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_reviews_title_length   CHECK (char_length(title)   BETWEEN 1 AND 20),
  CONSTRAINT product_reviews_content_length CHECK (char_length(content) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS product_reviews_product_id_idx
  ON public.product_reviews (product_id, created_at DESC);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

-- 공개 리뷰는 누구나 읽기 가능
CREATE POLICY "public_select_product_reviews"
  ON public.product_reviews FOR SELECT
  USING (is_public = true);

-- 인증 사용자만 본인 리뷰 작성 (RPC 경유 — 직접 INSERT는 이 정책으로만 허용)
CREATE POLICY "authenticated_insert_product_reviews"
  ON public.product_reviews FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RPC: 리뷰 등록 (SECURITY DEFINER — auth.uid() 내부 검증)
CREATE OR REPLACE FUNCTION public.create_product_review(
  p_product_id UUID,
  p_title      TEXT,
  p_content    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      UUID;
  v_user_id UUID := auth.uid();
  v_name    TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  IF char_length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION '제목을 입력해주세요.';
  END IF;

  IF char_length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION '내용을 입력해주세요.';
  END IF;

  SELECT full_name INTO v_name
    FROM public.user_profiles WHERE id = v_user_id;

  INSERT INTO public.product_reviews (product_id, user_id, author_name, title, content)
    VALUES (p_product_id, v_user_id, COALESCE(v_name, '익명'), trim(p_title), trim(p_content))
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_review TO authenticated;

-- RPC: 리뷰 목록 조회 (anon 포함 누구나 호출 가능)
CREATE OR REPLACE FUNCTION public.get_product_reviews(
  p_product_id UUID,
  p_limit      INT DEFAULT 20,
  p_offset     INT DEFAULT 0
)
RETURNS TABLE (
  id          UUID,
  author_name TEXT,
  title       TEXT,
  content     TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, author_name, title, content, created_at
  FROM public.product_reviews
  WHERE product_id = p_product_id
    AND is_public = true
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_reviews TO anon, authenticated;

-- rollback
-- DROP FUNCTION IF EXISTS public.get_product_reviews(UUID, INT, INT);
-- DROP FUNCTION IF EXISTS public.create_product_review(UUID, TEXT, TEXT);
-- DROP TABLE IF EXISTS public.product_reviews CASCADE;
