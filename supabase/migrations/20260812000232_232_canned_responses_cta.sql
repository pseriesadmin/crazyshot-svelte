-- Migration 232: canned_responses에 이미지/CTA 컬럼 추가
-- GSD-18: P3-5 자동응답 메시지에 이미지·CTA버튼 첨부 — ADD-only, 전부 nullable

ALTER TABLE canned_responses
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_url   text;

COMMENT ON COLUMN canned_responses.image_url IS '자동응답 action_card에 첨부할 이미지 URL (Cloudinary 또는 Supabase Storage)';
COMMENT ON COLUMN canned_responses.cta_label IS 'CTA 버튼 레이블 (설정 시 action_card 형태로 전송됨)';
COMMENT ON COLUMN canned_responses.cta_url   IS 'CTA 버튼 클릭 시 이동 URL';
