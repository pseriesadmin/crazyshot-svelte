-- Migration 186: auto_reply_settings 싱글톤 테이블
-- 자동답변 전역 스위치 저장용 (rental_guide_settings 패턴 참고)
-- 파일 생성만 — DB 적용은 별도 Stephen 확인 후 진행

CREATE TABLE IF NOT EXISTS auto_reply_settings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE auto_reply_settings ENABLE ROW LEVEL SECURITY;

-- 관리자(is_cms_user)는 전체 조작, 일반 공개 읽기
CREATE POLICY "ars_admin_all" ON auto_reply_settings
  FOR ALL USING (is_cms_user());

CREATE POLICY "ars_read" ON auto_reply_settings
  FOR SELECT USING (true);

-- 싱글톤 초기행 (중복 삽입 방지)
INSERT INTO auto_reply_settings (enabled)
VALUES (false)
ON CONFLICT DO NOTHING;
