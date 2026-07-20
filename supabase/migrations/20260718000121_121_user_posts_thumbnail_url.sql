-- Migration #121: user_posts — create/update RPC에 p_thumbnail_url 파라미터 추가
-- Stage DB (ezyvffjvuwmtuhpxdjrw) 검증 후 Production 적용

-- 1. create_user_post 재정의
CREATE OR REPLACE FUNCTION public.create_user_post(
  p_log_type       TEXT,
  p_title          TEXT,
  p_content_blocks JSONB    DEFAULT '[]'::jsonb,
  p_keywords       TEXT[]   DEFAULT '{}',
  p_tags           TEXT[]   DEFAULT '{}',
  p_is_public      BOOLEAN  DEFAULT true,
  p_allow_comments BOOLEAN  DEFAULT true,
  p_allow_scrap    BOOLEAN  DEFAULT true,
  p_allow_ai_save  BOOLEAN  DEFAULT true,
  p_auto_source    BOOLEAN  DEFAULT false,
  p_ccl            TEXT     DEFAULT NULL,
  p_thumbnail_url  TEXT     DEFAULT NULL
)
RETURNS public.user_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_post    public.user_posts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_log_type IS NULL OR p_log_type = '' THEN
    RAISE EXCEPTION 'log_type is required';
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;

  INSERT INTO public.user_posts (
    user_id, log_type, title, content_blocks, keywords, tags,
    is_public, allow_comments, allow_scrap, allow_ai_save,
    auto_source, ccl, status, thumbnail_url
  ) VALUES (
    v_user_id, p_log_type, trim(p_title), p_content_blocks, p_keywords, p_tags,
    p_is_public, p_allow_comments, p_allow_scrap, p_allow_ai_save,
    p_auto_source, p_ccl, 'published', p_thumbnail_url
  )
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$$;

-- 2. update_user_post 재정의
CREATE OR REPLACE FUNCTION public.update_user_post(
  p_id             UUID,
  p_log_type       TEXT,
  p_title          TEXT,
  p_content_blocks JSONB    DEFAULT '[]'::jsonb,
  p_keywords       TEXT[]   DEFAULT '{}',
  p_tags           TEXT[]   DEFAULT '{}',
  p_is_public      BOOLEAN  DEFAULT true,
  p_allow_comments BOOLEAN  DEFAULT true,
  p_allow_scrap    BOOLEAN  DEFAULT true,
  p_allow_ai_save  BOOLEAN  DEFAULT true,
  p_auto_source    BOOLEAN  DEFAULT false,
  p_ccl            TEXT     DEFAULT NULL,
  p_thumbnail_url  TEXT     DEFAULT NULL
)
RETURNS public.user_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_post_user UUID;
  v_post      public.user_posts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT user_id INTO v_post_user FROM public.user_posts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
  IF v_post_user <> v_user_id AND NOT is_cms_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_log_type IS NULL OR p_log_type = '' THEN
    RAISE EXCEPTION 'log_type is required';
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;

  UPDATE public.user_posts SET
    log_type       = p_log_type,
    title          = trim(p_title),
    content_blocks = p_content_blocks,
    keywords       = p_keywords,
    tags           = p_tags,
    is_public      = p_is_public,
    allow_comments = p_allow_comments,
    allow_scrap    = p_allow_scrap,
    allow_ai_save  = p_allow_ai_save,
    auto_source    = p_auto_source,
    ccl            = p_ccl,
    thumbnail_url  = p_thumbnail_url
  WHERE id = p_id
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_user_post TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_post TO authenticated;
