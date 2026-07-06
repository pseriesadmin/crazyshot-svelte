-- migration #52: user_behavior_events 테이블 (CDP 행동 로그)
-- Phase 2 — CDP 행동 데이터 수집 레이어

-- 행동 이벤트 테이블
CREATE TABLE IF NOT EXISTS user_behavior_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- null 허용 (비로그인)
  session_id  TEXT,
  event_type  VARCHAR(30) NOT NULL,
  -- 'pageview'|'click'|'search'|'wishlist'|'cart_add'|'purchase'|'coupon_use'|'review'
  event_data  JSONB,
  page_path   TEXT,
  device_type VARCHAR(10),  -- 'pc' | 'mobile'
  referrer    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ube_user    ON user_behavior_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ube_type    ON user_behavior_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ube_session ON user_behavior_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ube_path    ON user_behavior_events(page_path, created_at DESC);

-- RLS
ALTER TABLE user_behavior_events ENABLE ROW LEVEL SECURITY;

-- 로그인 사용자: 자신의 이벤트 INSERT (anon 포함 — 비로그인 이벤트는 서버에서 삽입)
CREATE POLICY "ube_user_insert" ON user_behavior_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- 관리자: 전체 SELECT
CREATE POLICY "ube_admin_select" ON user_behavior_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND cms_role IS NOT NULL
    )
  );
