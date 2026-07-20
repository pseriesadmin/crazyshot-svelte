-- Migration #117: user_posts 테이블 + RLS + RPC
-- crazylog 글등록·수정·조회 기능 전용
-- 2026-07-15

-- ──────────────────────────────────────
-- 1. 테이블 생성
-- ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_posts (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_type         TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  content_blocks   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  keywords         TEXT[]      NOT NULL DEFAULT '{}',
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  is_public        BOOLEAN     NOT NULL DEFAULT true,
  allow_comments   BOOLEAN     NOT NULL DEFAULT true,
  allow_scrap      BOOLEAN     NOT NULL DEFAULT true,
  allow_ai_save    BOOLEAN     NOT NULL DEFAULT true,
  auto_source      BOOLEAN     NOT NULL DEFAULT false,
  ccl              TEXT        DEFAULT NULL,
  status           TEXT        NOT NULL DEFAULT 'published',
  view_count       BIGINT      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_posts_pkey PRIMARY KEY (id),
  CONSTRAINT user_posts_log_type_check CHECK (
    log_type IN (
      '일상 로그', '여행 로그', '맛집 로그', '운동 로그',
      '독서 로그', '영화·드라마 로그', '공부 로그', '취미 로그'
    )
  ),
  CONSTRAINT user_posts_status_check CHECK (
    status IN ('draft', 'published', 'hidden', 'deleted')
  )
);

-- ──────────────────────────────────────
-- 2. 인덱스
-- ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_posts_user_id
  ON public.user_posts (user_id);

CREATE INDEX IF NOT EXISTS idx_user_posts_status_created_at
  ON public.user_posts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_posts_user_id_status
  ON public.user_posts (user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_posts_is_public_status
  ON public.user_posts (is_public, status)
  WHERE status = 'published';

-- ──────────────────────────────────────
-- 3. updated_at 자동 갱신 트리거
-- ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS
    $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$;
  END IF;
END;
$$;

CREATE TRIGGER trg_user_posts_updated_at
  BEFORE UPDATE ON public.user_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────
-- 4. RLS 활성화 + 정책
-- ──────────────────────────────────────
ALTER TABLE public.user_posts ENABLE ROW LEVEL SECURITY;

-- SELECT: 공개 글 또는 본인 글 또는 관리자
CREATE POLICY "user_posts_select"
  ON public.user_posts FOR SELECT
  USING (
    (is_public = true AND status = 'published')
    OR user_id = auth.uid()
    OR is_cms_user()
  );

-- INSERT: 본인만 (user_id 고정)
CREATE POLICY "user_posts_insert"
  ON public.user_posts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- UPDATE: 본인 또는 관리자
CREATE POLICY "user_posts_update"
  ON public.user_posts FOR UPDATE
  USING (user_id = auth.uid() OR is_cms_user())
  WITH CHECK (user_id = auth.uid() OR is_cms_user());

-- DELETE: 금지 (status = 'deleted' 소프트 삭제 사용)
-- (별도 정책 없음 — RLS 기본 차단)

-- ──────────────────────────────────────
-- 5. RPC 함수
-- ──────────────────────────────────────

-- 5-1. 글 등록 (신규 생성)
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
  p_ccl            TEXT     DEFAULT NULL
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

  -- 입력 검증
  IF p_log_type IS NULL OR p_log_type = '' THEN
    RAISE EXCEPTION 'log_type is required';
  END IF;
  IF p_title IS NULL OR trim(p_title) = '' THEN
    RAISE EXCEPTION 'title is required';
  END IF;

  INSERT INTO public.user_posts (
    user_id, log_type, title, content_blocks, keywords, tags,
    is_public, allow_comments, allow_scrap, allow_ai_save,
    auto_source, ccl, status
  ) VALUES (
    v_user_id, p_log_type, trim(p_title), p_content_blocks, p_keywords, p_tags,
    p_is_public, p_allow_comments, p_allow_scrap, p_allow_ai_save,
    p_auto_source, p_ccl, 'published'
  )
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$$;

-- 5-2. 글 수정
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
  p_ccl            TEXT     DEFAULT NULL
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

  -- 소유자 확인
  SELECT user_id INTO v_post_user FROM public.user_posts WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
  IF v_post_user <> v_user_id AND NOT is_cms_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- 입력 검증
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
    ccl            = p_ccl
  WHERE id = p_id
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$$;

-- 5-3. 상태 변경 (관리자 전용: 보류·삭제·공개)
CREATE OR REPLACE FUNCTION public.update_post_status(
  p_id     UUID,
  p_status TEXT
)
RETURNS public.user_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.user_posts;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'forbidden: cms_role required';
  END IF;

  IF p_status NOT IN ('draft', 'published', 'hidden', 'deleted') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE public.user_posts
    SET status = p_status
  WHERE id = p_id
  RETURNING * INTO v_post;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  RETURN v_post;
END;
$$;

-- 5-4. 사용자 통계 (등록 수 + 총 조회 수)
CREATE OR REPLACE FUNCTION public.get_user_post_stats(
  p_user_id UUID
)
RETURNS TABLE (
  post_count       BIGINT,
  total_view_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT          AS post_count,
    COALESCE(SUM(view_count), 0)::BIGINT AS total_view_count
  FROM public.user_posts
  WHERE user_id = p_user_id
    AND status NOT IN ('deleted');
END;
$$;

-- ──────────────────────────────────────
-- 6. 권한 부여
-- ──────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.user_posts TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_post TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_post TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_post_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_post_stats TO authenticated, anon;
