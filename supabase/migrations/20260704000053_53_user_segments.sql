-- migration #53: user_segments 테이블 (CDP 세그먼트 자동 분류)
-- Phase 2 — 세그먼트 기반 마케팅 타겟팅

CREATE TABLE IF NOT EXISTS user_segments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment     VARCHAR(30) NOT NULL,
  -- 'new_member'|'vip'|'dormant'|'cart_abandon'|
  -- 'first_purchase_ready'|'repurchase_ready'|'high_value'
  score       NUMERIC(5,2),
  computed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, segment)
);

CREATE INDEX IF NOT EXISTS idx_us_user    ON user_segments(user_id);
CREATE INDEX IF NOT EXISTS idx_us_segment ON user_segments(segment, computed_at DESC);

-- RLS
ALTER TABLE user_segments ENABLE ROW LEVEL SECURITY;

-- 로그인 사용자: 자신의 세그먼트 조회
CREATE POLICY "us_user_select" ON user_segments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 관리자: 전체 조회
CREATE POLICY "us_admin_select" ON user_segments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND cms_role IS NOT NULL
    )
  );

-- 관리자: UPDATE (세그먼트 수동 조정)
CREATE POLICY "us_admin_update" ON user_segments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND cms_role IS NOT NULL
    )
  );
