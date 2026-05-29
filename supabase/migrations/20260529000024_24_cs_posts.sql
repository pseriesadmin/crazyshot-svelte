-- ★ MIGRATION: 24_cs_posts.sql
-- Schema version: v5.46
-- Description: Support — customer service post/inquiry board
-- Dependencies: (none beyond auth.users)
-- Author: Stephen Cconzy
-- Date: 2026-05-29

CREATE TABLE IF NOT EXISTS cs_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  title       VARCHAR(300) NOT NULL,
  content     TEXT NOT NULL,
  category    VARCHAR(50) NOT NULL DEFAULT 'general',
  status      VARCHAR(20) NOT NULL DEFAULT 'open'
                CHECK(status IN ('open', 'in_progress', 'resolved', 'closed')),
  attachments TEXT[],   -- Cloudinary URL 배열
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_cs_posts_user_id  ON cs_posts(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_cs_posts_status   ON cs_posts(status)  WHERE deleted_at IS NULL;
CREATE INDEX idx_cs_posts_category ON cs_posts(category) WHERE deleted_at IS NULL;

ALTER TABLE cs_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs_posts: 본인 전체" ON cs_posts
  FOR ALL USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "cs_posts: 관리자 전체" ON cs_posts
  FOR ALL USING (is_admin());

CREATE TRIGGER set_cs_posts_updated_at
  BEFORE UPDATE ON cs_posts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
