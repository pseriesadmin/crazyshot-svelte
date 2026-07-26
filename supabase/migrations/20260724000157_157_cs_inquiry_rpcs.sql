-- ★ MIGRATION: 157_cs_inquiry_rpcs.sql
-- Schema version: v5.52
-- Description: 빠른문의 CMS + 사용자 기능용 RPC — cs_posts/cs_inquiries 연동
-- Dependencies: 24_cs_posts.sql, 25_cs_inquiries.sql
-- Author: Stephen Cconzy
-- Date: 2026-07-24

-- ── 1. CMS 전체 문의 목록 (관리자 service_role 용) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_all_cs_posts(
  p_status  TEXT  DEFAULT NULL,
  p_search  TEXT  DEFAULT NULL,
  p_page    INT   DEFAULT 1,
  p_limit   INT   DEFAULT 20
)
RETURNS TABLE (
  id          UUID,
  title       VARCHAR(300),
  content     TEXT,
  category    VARCHAR(50),
  status      VARCHAR(20),
  created_at  TIMESTAMPTZ,
  user_id     UUID,
  user_name   TEXT,
  user_email  TEXT,
  reply_count BIGINT,
  replies     JSONB,
  total_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.title,
    p.content,
    p.category,
    p.status,
    p.created_at,
    p.user_id,
    COALESCE(up.full_name, up.email, p.user_id::TEXT)::TEXT        AS user_name,
    COALESCE(up.email, p.user_id::TEXT)::TEXT                      AS user_email,
    rep.reply_count,
    rep.replies,
    COUNT(*) OVER ()::BIGINT                                       AS total_count
  FROM cs_posts p
  LEFT JOIN user_profiles up ON up.id = p.user_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(ci.id)::BIGINT AS reply_count,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id',            ci.id,
            'response',      ci.response,
            'is_resolution', ci.is_resolution,
            'created_at',    ci.created_at,
            'responder_id',  ci.responder_id
          ) ORDER BY ci.created_at
        ) FILTER (WHERE ci.id IS NOT NULL),
        '[]'::JSONB
      ) AS replies
    FROM cs_inquiries ci
    WHERE ci.cs_post_id = p.id
  ) rep ON true
  WHERE p.deleted_at IS NULL
    AND (p_status IS NULL OR p.status = p_status)
    AND (
      p_search IS NULL
      OR p.title ILIKE '%' || p_search || '%'
      OR COALESCE(up.full_name, up.email, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET (p_page - 1) * p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_cs_posts TO service_role;
GRANT EXECUTE ON FUNCTION public.get_all_cs_posts TO authenticated;

-- ── 2. 사용자 문의 등록 (auth.uid() 기반, 인증 필수) ─────────────────────────
CREATE OR REPLACE FUNCTION public.submit_cs_post(
  p_title    TEXT,
  p_content  TEXT,
  p_category TEXT DEFAULT 'general'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO cs_posts (user_id, title, content, category)
  VALUES (auth.uid(), p_title, p_content, p_category)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_cs_post TO authenticated;

-- ── 3. 관리자 답변 등록 (service_role 전용) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_cs_reply(
  p_post_id       UUID,
  p_responder_id  UUID,
  p_response      TEXT,
  p_is_resolution BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO cs_inquiries (cs_post_id, responder_id, response, is_resolution)
  VALUES (p_post_id, p_responder_id, p_response, p_is_resolution)
  RETURNING id INTO v_id;

  -- 상태 자동 갱신
  IF p_is_resolution THEN
    UPDATE cs_posts SET status = 'resolved' WHERE id = p_post_id AND deleted_at IS NULL;
  ELSE
    UPDATE cs_posts SET status = 'in_progress'
    WHERE id = p_post_id AND status = 'open' AND deleted_at IS NULL;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_cs_reply TO service_role;

-- ── 4. 관리자 상태 변경 (service_role 전용) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_cs_post_status(
  p_post_id UUID,
  p_status  TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE cs_posts
  SET status = p_status
  WHERE id = p_post_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_cs_post_status TO service_role;
