-- migration #58: execute_marketing_rules 함수 + pg_cron 등록
-- Phase 3 — Rule Engine 자동 발동
-- 의존성: marketing_rules (#56), marketing_rule_logs (#56),
--          user_behavior_events (#52), user_profiles (#03),
--          distribute_coupon RPC (#51), admin_grant_points RPC (#51)

-- ──────────────────────────────────────────────────────────────────────────────
-- execute_marketing_rules()
-- 매 1시간 pg_cron으로 자동 실행
-- trigger_type 별 대상 사용자 조회 → action 발동 → marketing_rule_logs INSERT
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_marketing_rules()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule         RECORD;
  v_user_id      UUID;
  v_action_result JSONB;
  v_total_fired  INT := 0;
  v_errors       INT := 0;

  -- 트리거별 사용자 커서
  cur_users      REFCURSOR;
BEGIN
  -- 활성화된 모든 룰 순회
  FOR v_rule IN
    SELECT * FROM marketing_rules WHERE is_active = true
  LOOP
    -- ────────────────────────────────────────────────────────────────
    -- trigger_type별 대상 사용자 조회
    -- ────────────────────────────────────────────────────────────────

    CASE v_rule.trigger_type

      -- 장바구니 추가 후 24h 미결제 사용자
      WHEN 'cart_abandon_24h' THEN
        OPEN cur_users FOR
          SELECT DISTINCT ube.user_id
          FROM user_behavior_events ube
          WHERE ube.event_type = 'cart_add'
            AND ube.user_id IS NOT NULL
            AND ube.created_at >= now() - INTERVAL '25 hours'
            AND ube.created_at <  now() - INTERVAL '24 hours'
            -- 이미 24h 내 purchase 이벤트 없는 사용자만
            AND NOT EXISTS (
              SELECT 1 FROM user_behavior_events ube2
              WHERE ube2.user_id = ube.user_id
                AND ube2.event_type = 'purchase'
                AND ube2.created_at >= ube.created_at
            )
            -- 이미 이 룰로 발동된 사용자 제외 (오늘)
            AND NOT EXISTS (
              SELECT 1 FROM marketing_rule_logs mrl
              WHERE mrl.rule_id = v_rule.id
                AND mrl.user_id = ube.user_id
                AND mrl.triggered_at >= now() - INTERVAL '24 hours'
            );

      -- 30일 이상 미접속 휴면 사용자 (auth.users.last_sign_in_at 기준)
      WHEN 'dormant_30d' THEN
        OPEN cur_users FOR
          SELECT au.id AS user_id
          FROM auth.users au
          JOIN user_profiles up ON up.user_id = au.id
          WHERE au.last_sign_in_at < now() - INTERVAL '30 days'
            AND up.deleted_at IS NULL
            -- 이미 이 룰로 발동된 사용자 제외 (30일 내)
            AND NOT EXISTS (
              SELECT 1 FROM marketing_rule_logs mrl
              WHERE mrl.rule_id = v_rule.id
                AND mrl.user_id = au.id
                AND mrl.triggered_at >= now() - INTERVAL '30 days'
            );

      -- VIP 등급 업그레이드: grade가 BASIC→PRO 또는 PRO→CRAZY인 사용자
      -- user_profiles.grade 변경 감지 → credit_score_audit 참조
      WHEN 'vip_upgrade' THEN
        OPEN cur_users FOR
          SELECT DISTINCT up.user_id
          FROM user_profiles up
          WHERE up.membership_grade IN ('pro', 'crazy')
            AND up.updated_at >= now() - INTERVAL '2 hours'
            -- 이미 이 룰로 발동된 사용자 제외 (24h 내)
            AND NOT EXISTS (
              SELECT 1 FROM marketing_rule_logs mrl
              WHERE mrl.rule_id = v_rule.id
                AND mrl.user_id = up.user_id
                AND mrl.triggered_at >= now() - INTERVAL '24 hours'
            );

      -- 당월 생일 사용자 (auth.users raw_user_meta_data.birth_date)
      WHEN 'birthday' THEN
        OPEN cur_users FOR
          SELECT au.id AS user_id
          FROM auth.users au
          WHERE (au.raw_user_meta_data->>'birth_date') IS NOT NULL
            AND EXTRACT(MONTH FROM (au.raw_user_meta_data->>'birth_date')::DATE)
                = EXTRACT(MONTH FROM now())
            -- 이미 이 룰로 이번 달 발동된 사용자 제외
            AND NOT EXISTS (
              SELECT 1 FROM marketing_rule_logs mrl
              WHERE mrl.rule_id = v_rule.id
                AND mrl.user_id = au.id
                AND EXTRACT(MONTH FROM mrl.triggered_at) = EXTRACT(MONTH FROM now())
                AND EXTRACT(YEAR  FROM mrl.triggered_at) = EXTRACT(YEAR  FROM now())
            );

      -- 신규 가입 사용자 (최근 1시간 이내)
      WHEN 'signup' THEN
        OPEN cur_users FOR
          SELECT au.id AS user_id
          FROM auth.users au
          WHERE au.created_at >= now() - INTERVAL '2 hours'
            AND au.created_at <  now() - INTERVAL '1 hour'
            -- 이미 이 룰로 발동된 사용자 제외
            AND NOT EXISTS (
              SELECT 1 FROM marketing_rule_logs mrl
              WHERE mrl.rule_id = v_rule.id
                AND mrl.user_id = au.id
            );

      ELSE
        CONTINUE;  -- 알 수 없는 trigger_type은 스킵
    END CASE;

    -- ────────────────────────────────────────────────────────────────
    -- 대상 사용자별 action 발동
    -- ────────────────────────────────────────────────────────────────
    LOOP
      FETCH cur_users INTO v_user_id;
      EXIT WHEN NOT FOUND;

      BEGIN
        CASE v_rule.action_type

          WHEN 'send_coupon' THEN
            -- distribute_coupon RPC 재사용 (specific_user 대상)
            v_action_result := public.distribute_coupon(
              p_coupon_id   := (v_rule.action_meta->>'coupon_id')::UUID,
              p_target_type := 'specific_user',
              p_target_meta := jsonb_build_object('user_id', v_user_id),
              p_admin_id    := NULL
            );

          WHEN 'grant_points' THEN
            -- admin_grant_points RPC 재사용
            v_action_result := public.admin_grant_points(
              p_user_id    := v_user_id,
              p_amount     := COALESCE((v_rule.action_meta->>'points')::INT, 0),
              p_type       := 'admin_grant',
              p_description := COALESCE(
                v_rule.action_meta->>'description',
                '마케팅 룰 자동 적립: ' || v_rule.name
              )
            );

          WHEN 'send_notification', 'send_kakao' THEN
            -- 실발송 미연동 — 로그 기록만 (외부 API 미완성)
            v_action_result := jsonb_build_object(
              'status', 'logged_only',
              'note',   '실발송 미연동 — marketing_rule_logs에 기록만 저장됨',
              'rule',   v_rule.name
            );

          ELSE
            v_action_result := jsonb_build_object('status', 'unknown_action');
        END CASE;

        -- 발동 로그 저장
        INSERT INTO marketing_rule_logs (rule_id, user_id, triggered_at, result)
        VALUES (v_rule.id, v_user_id, now(), v_action_result);

        v_total_fired := v_total_fired + 1;

      EXCEPTION WHEN OTHERS THEN
        -- 에러 시 로그에 에러 정보 저장 후 계속 진행 (단건 실패가 전체를 막지 않음)
        INSERT INTO marketing_rule_logs (rule_id, user_id, triggered_at, result)
        VALUES (
          v_rule.id,
          v_user_id,
          now(),
          jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE)
        );
        v_errors := v_errors + 1;
      END;
    END LOOP;

    CLOSE cur_users;
  END LOOP;

  RETURN jsonb_build_object(
    'total_fired', v_total_fired,
    'errors',      v_errors,
    'executed_at', now()
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- pg_cron 스케줄 등록: 매 1시간마다 실행
-- (cron.job 테이블에 같은 이름이 있으면 업데이트)
-- ──────────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'execute_marketing_rules_hourly',  -- job name
  '0 * * * *',                       -- 매 시 정각
  $cron$SELECT public.execute_marketing_rules();$cron$
)
ON CONFLICT DO NOTHING;


-- ── ROLLBACK ──
-- SELECT cron.unschedule('execute_marketing_rules_hourly');
-- DROP FUNCTION IF EXISTS execute_marketing_rules();
