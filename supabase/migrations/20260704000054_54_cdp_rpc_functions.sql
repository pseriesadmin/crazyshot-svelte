-- migration #54: CDP RPC 함수 (RFM 집계 + 세그먼트 자동 분류)
-- Phase 2 — compute_rfm_scores, refresh_user_segments, get_segment_stats, track_behavior_event

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. 행동 이벤트 수집 (서버사이드 RPC — 비로그인 포함)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION track_behavior_event(
  p_user_id    UUID,
  p_session_id TEXT,
  p_event_type VARCHAR(30),
  p_event_data JSONB DEFAULT NULL,
  p_page_path  TEXT  DEFAULT NULL,
  p_device_type VARCHAR(10) DEFAULT NULL,
  p_referrer   TEXT  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO user_behavior_events (
    user_id, session_id, event_type, event_data, page_path, device_type, referrer
  ) VALUES (
    p_user_id, p_session_id, p_event_type, p_event_data, p_page_path, p_device_type, p_referrer
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. RFM 점수 집계 (Recency / Frequency / Monetary)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION compute_rfm_scores()
RETURNS TABLE (
  user_id         UUID,
  recency_days    INT,     -- 마지막 예약 이후 경과 일수 (낮을수록 최근)
  frequency       INT,     -- 총 완료된 예약 수
  monetary        NUMERIC, -- 총 결제 금액
  rfm_score       NUMERIC  -- 종합 점수 (0~100)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH rfm_raw AS (
    SELECT
      rr.user_id,
      EXTRACT(DAY FROM now() - MAX(rr.created_at))::INT          AS recency_days,
      COUNT(CASE WHEN rr.status = 'returned' THEN 1 END)::INT    AS frequency,
      COALESCE(SUM(pt.amount) FILTER (WHERE pt.type = 'earn'), 0) AS monetary
    FROM rental_reservations rr
    LEFT JOIN point_transactions pt ON pt.user_id = rr.user_id
    WHERE rr.status IN ('confirmed', 'active', 'returned')
    GROUP BY rr.user_id
  ),
  stats AS (
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY recency_days) AS med_r,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY frequency)    AS med_f,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY monetary)     AS med_m,
      MAX(recency_days) AS max_r,
      MAX(frequency)    AS max_f,
      MAX(monetary)     AS max_m
    FROM rfm_raw
  )
  SELECT
    r.user_id,
    r.recency_days,
    r.frequency,
    r.monetary,
    ROUND(
      (1 - LEAST(r.recency_days::NUMERIC / NULLIF(s.max_r, 0), 1)) * 40 +
      LEAST(r.frequency::NUMERIC / NULLIF(s.max_f, 0), 1)  * 30 +
      LEAST(r.monetary  / NULLIF(s.max_m, 0), 1)           * 30
    , 2) AS rfm_score
  FROM rfm_raw r, stats s;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. 세그먼트 자동 분류 (pg_cron으로 매일 실행 가능)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_user_segments()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT := 0;
  v_now   TIMESTAMPTZ := now();
BEGIN
  -- 기존 세그먼트 초기화
  DELETE FROM user_segments;

  -- 신규회원: 가입 30일 이내 + 예약 없음
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT up.id, 'new_member', 100, v_now
  FROM user_profiles up
  WHERE up.created_at > v_now - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.user_id = up.id AND rr.status NOT IN ('cancelled')
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;

  -- VIP: RFM 점수 70 이상
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT rfm.user_id, 'vip', rfm.rfm_score, v_now
  FROM compute_rfm_scores() rfm
  WHERE rfm.rfm_score >= 70
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;

  -- 휴면회원: 마지막 행동 로그 30일 초과
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT DISTINCT up.id, 'dormant', 0, v_now
  FROM user_profiles up
  WHERE NOT EXISTS (
    SELECT 1 FROM user_behavior_events ube
    WHERE ube.user_id = up.id
      AND ube.created_at > v_now - INTERVAL '30 days'
  )
    AND up.created_at < v_now - INTERVAL '30 days'
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;

  -- 장바구니이탈: cart_add 이벤트 48시간 내 + 미결제
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT DISTINCT ube.user_id, 'cart_abandon', 80, v_now
  FROM user_behavior_events ube
  WHERE ube.event_type = 'cart_add'
    AND ube.created_at > v_now - INTERVAL '48 hours'
    AND ube.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.user_id = ube.user_id
        AND rr.status = 'confirmed'
        AND rr.created_at > v_now - INTERVAL '48 hours'
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;

  -- 첫구매예정: 회원가입 후 결제 없고 상품 조회 있음
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT DISTINCT ube.user_id, 'first_purchase_ready', 60, v_now
  FROM user_behavior_events ube
  WHERE ube.event_type = 'pageview'
    AND ube.page_path LIKE '/products/%'
    AND ube.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.user_id = ube.user_id AND rr.status = 'confirmed'
    )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;

  -- 고가치 고객: monetary 상위 10%
  INSERT INTO user_segments (user_id, segment, score, computed_at)
  SELECT rfm.user_id, 'high_value', rfm.rfm_score, v_now
  FROM compute_rfm_scores() rfm
  WHERE rfm.monetary > (
    SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY monetary)
    FROM compute_rfm_scores()
  )
  ON CONFLICT (user_id, segment) DO UPDATE
    SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'segments_updated', v_count,
    'computed_at', v_now
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. 세그먼트 통계 조회 (CMS 대시보드용)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_segment_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_tracked_users',
      (SELECT COUNT(DISTINCT user_id) FROM user_behavior_events WHERE user_id IS NOT NULL),
    'total_events_7d',
      (SELECT COUNT(*) FROM user_behavior_events WHERE created_at > now() - INTERVAL '7 days'),
    'segments', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'segment', segment,
          'count', cnt,
          'avg_score', avg_score
        )
        ORDER BY cnt DESC
      )
      FROM (
        SELECT
          segment,
          COUNT(*) AS cnt,
          ROUND(AVG(score), 1) AS avg_score
        FROM user_segments
        GROUP BY segment
      ) s
    ),
    'last_refresh',
      (SELECT MAX(computed_at) FROM user_segments)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. 세그먼트별 사용자 목록 (페이지네이션)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_segment_users(
  p_segment VARCHAR(30),
  p_limit   INT DEFAULT 50,
  p_offset  INT DEFAULT 0
)
RETURNS TABLE (
  user_id    UUID,
  full_name  TEXT,
  phone      TEXT,
  email      TEXT,
  score      NUMERIC,
  computed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    us.user_id,
    up.full_name,
    up.phone,
    au.email::TEXT,
    us.score,
    us.computed_at
  FROM user_segments us
  JOIN user_profiles up ON up.id = us.user_id
  LEFT JOIN auth.users au ON au.id = us.user_id
  WHERE us.segment = p_segment
  ORDER BY us.score DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
