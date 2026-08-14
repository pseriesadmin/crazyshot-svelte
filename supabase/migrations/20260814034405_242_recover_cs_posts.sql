-- ★ MIGRATION: 242_recover_cs_posts.sql
-- Schema version: v5.55
-- Description: Support — customer service post/inquiry board (RECOVERY)
-- Dependencies: (none beyond auth.users)
-- Author: Stephen Cconzy
-- Date: 2026-08-14
--
-- 복구 사유: 원본 20260529000024_24_cs_posts.sql이 2026-05-29 S0 초기 배치 적용 시
-- 함께 누락되어 stage/production 어디에도 테이블이 생성되지 않았음(2026-08-13 세션
-- Supabase MCP로 information_schema 직접 조회해 확인). 157_cs_inquiry_rpcs 마이그레이션은
-- 이 테이블을 참조하는 RPC(get_all_cs_posts/submit_cs_post/add_cs_reply/update_cs_post_status)를
-- 이미 정상 생성해뒀으나 대상 테이블이 없어 호출 시 100% 42P01 에러가 나는 상태였음.
-- 원본 파일(20260529000024_24_cs_posts.sql)은 수정하지 않고, 동일 내용을 신규 파일로 적용함.

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

-- ROLLBACK (243_recover_cs_inquiries.sql을 먼저 롤백한 뒤 실행할 것 — FK 참조):
-- DROP TABLE IF EXISTS cs_posts CASCADE;
