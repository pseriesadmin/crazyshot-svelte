-- Migration #183: 푸시알림 RPC 6종
-- 배경: CMS 전역 FCM 푸시알림 연동 (S1) — .claude/harness/TASK.md 참고
-- 권한 원칙: 고객 소유 토큰 등록/해지만 authenticated에 개방, 나머지는 service_role 전용
--   (Migration #172 "서버 전용 RPC service_role 잠금" 원칙과 동일 — CMS/서버 발신 허브에서만 호출)

-- ──────────────────────────────────────────────
-- 1. register_push_token — 고객·관리자 공통(로그인 사용자 본인 토큰 등록)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token    TEXT,
  p_platform TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다');
  END IF;

  IF p_platform NOT IN ('ios', 'android', 'web') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_platform');
  END IF;

  -- 동일 token 재로그인(계정 전환) 시 소유자를 최신 로그인 사용자로 갱신 (#181에서 UNIQUE(token)로 보정)
  INSERT INTO notification_tokens (user_id, token, platform, is_active)
  VALUES (v_user_id, p_token, p_platform, true)
  ON CONFLICT (token) DO UPDATE
    SET user_id    = EXCLUDED.user_id,
        platform   = EXCLUDED.platform,
        is_active  = true,
        updated_at = NOW();

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;

-- ──────────────────────────────────────────────
-- 2. unregister_push_token — 로그아웃 시 본인 토큰 비활성화
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unregister_push_token(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notification_tokens
  SET is_active  = false,
      updated_at = NOW()
  WHERE token = p_token AND user_id = auth.uid();

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;

-- ──────────────────────────────────────────────
-- 3. update_push_notification_config — CMS 설정 탭 섹션 a/b 저장 (manager 이상, 앱 레이어에서 권한 확인)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_push_notification_config(
  p_notify_type   TEXT,
  p_push_enabled  BOOLEAN,
  p_extra_config  JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE push_notification_config
  SET push_enabled = p_push_enabled,
      extra_config = COALESCE(p_extra_config, extra_config),
      updated_at   = NOW(),
      updated_by   = auth.uid()
  WHERE notify_type = p_notify_type;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'notify_type_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_push_notification_config(TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_push_notification_config(TEXT, BOOLEAN, JSONB) TO service_role;

-- ──────────────────────────────────────────────
-- 4. get_admin_push_recipients — 서버 발신 허브(push.ts)가 관리자 알림 대상 조회
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_admin_push_recipients(
  p_event_key TEXT
)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT id FROM user_profiles
  WHERE cms_role IS NOT NULL
    AND CASE p_event_key
      WHEN 'new_reservation'   THEN admin_notify_new_reservation
      WHEN 'contract_signed'   THEN admin_notify_contract_signed
      WHEN 'payment_completed' THEN admin_notify_payment_completed
      ELSE false
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_push_recipients(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_push_recipients(TEXT) TO service_role;

-- ──────────────────────────────────────────────
-- 5. update_admin_notify_setting — CMS 설정 탭 섹션 c 중앙관리 (manager 이상, 앱 레이어에서 권한 확인)
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_admin_notify_setting(
  p_target_user_id UUID,
  p_event_key      TEXT,
  p_enabled        BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_event_key NOT IN ('new_reservation', 'contract_signed', 'payment_completed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_event_key');
  END IF;

  IF p_event_key = 'new_reservation' THEN
    UPDATE user_profiles SET admin_notify_new_reservation = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSIF p_event_key = 'contract_signed' THEN
    UPDATE user_profiles SET admin_notify_contract_signed = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  ELSE
    UPDATE user_profiles SET admin_notify_payment_completed = p_enabled
    WHERE id = p_target_user_id AND cms_role IS NOT NULL;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_admin_notify_setting(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_admin_notify_setting(UUID, TEXT, BOOLEAN) TO service_role;

-- ──────────────────────────────────────────────
-- 6. log_push_notification — 서버 발신 허브(push.ts)가 발송 성공/실패 기록
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_push_notification(
  p_user_id  UUID,
  p_type     TEXT,
  p_title    TEXT,
  p_body     TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO notification_logs (user_id, type, title, body, metadata)
  VALUES (p_user_id, p_type, p_title, p_body, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_push_notification(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_push_notification(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- rollback:
-- DROP FUNCTION IF EXISTS public.register_push_token(TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.unregister_push_token(TEXT);
-- DROP FUNCTION IF EXISTS public.update_push_notification_config(TEXT, BOOLEAN, JSONB);
-- DROP FUNCTION IF EXISTS public.get_admin_push_recipients(TEXT);
-- DROP FUNCTION IF EXISTS public.update_admin_notify_setting(UUID, TEXT, BOOLEAN);
-- DROP FUNCTION IF EXISTS public.log_push_notification(UUID, TEXT, TEXT, TEXT, JSONB);
