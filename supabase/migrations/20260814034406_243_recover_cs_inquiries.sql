-- ★ MIGRATION: 243_recover_cs_inquiries.sql
-- Schema version: v5.55
-- Description: Support — admin responses to CS posts (RECOVERY)
-- Dependencies: 242_recover_cs_posts.sql
-- Author: Stephen Cconzy
-- Date: 2026-08-14
--
-- 복구 사유: 원본 20260529000025_25_cs_inquiries.sql이 242_recover_cs_posts.sql과 함께
-- 2026-05-29 S0 초기 배치에서 누락됨. 원본 파일은 수정하지 않고 동일 내용을 신규 파일로 적용함.

CREATE TABLE IF NOT EXISTS cs_inquiries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cs_post_id     UUID NOT NULL REFERENCES cs_posts(id) ON DELETE CASCADE,
  responder_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  response       TEXT NOT NULL,
  is_resolution  BOOLEAN NOT NULL DEFAULT false,   -- true이면 이 답변으로 케이스 종결
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cs_inquiries_post_id ON cs_inquiries(cs_post_id);

ALTER TABLE cs_inquiries ENABLE ROW LEVEL SECURITY;

-- 원 포스트 작성자도 답변 조회 가능
CREATE POLICY "cs_inquiries: 본인 포스트 답변 조회" ON cs_inquiries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cs_posts p
      WHERE p.id = cs_inquiries.cs_post_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "cs_inquiries: 관리자 전체" ON cs_inquiries
  FOR ALL USING (is_admin());

CREATE TRIGGER set_cs_inquiries_updated_at
  BEFORE UPDATE ON cs_inquiries
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ROLLBACK:
-- DROP TABLE IF EXISTS cs_inquiries CASCADE;
