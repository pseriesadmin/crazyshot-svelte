-- Migration #710: 문자 미도착 관리자 알림 — 발송 로그 점검 표시 + 관리자 푸시 이벤트 'sms_undelivered' (2026-10-14, Stephen 확정)
--
-- 배경: 솔라피가 이통사에 접수(3000)만 하고 단말 도착 리포트가 없는 문자(예: 전자계약서 안내)는 우리 로그엔 'sent'라 알 수 없었다.
-- 10분 크론(locker-guide)이 최근 발송 로그를 솔라피 결과와 대조해 미도착 의심 건을 관리자에게 1회만 푸시한다.
--
-- 변경: ① sms_notification_logs.delivery_confirmed_at(수신 완료 확인 → 더 이상 점검 안 함) / delivery_alerted_at(관리자 알림 완료 → 중복 알림 방지)
--       ② 점검 대상만 빠르게 찾는 부분 인덱스
--       ③ service_role이 두 컬럼만 UPDATE할 수 있게 권한 부여(기존엔 SELECT·INSERT만)
--       ④ user_profiles.admin_notify_sms_undelivered(기본 true — 기존 관리자 푸시 이벤트와 동일)
--       ⑤ get_admin_push_recipients·update_admin_notify_setting에 'sms_undelivered' 분기 1개씩 추가
--          — 함수 본문은 현행 라이브 정의에서 정확히 일치하는 줄만 치환한다(Migration 666과 같은 방식, 앵커가 없으면 중단).
-- 롤백: 두 함수에서 sms_undelivered 분기 제거(Migration 666 정의 복원) 후
--   ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS admin_notify_sms_undelivered;
--   DROP INDEX IF EXISTS sms_notification_logs_delivery_check_idx;
--   ALTER TABLE public.sms_notification_logs DROP COLUMN IF EXISTS delivery_alerted_at, DROP COLUMN IF EXISTS delivery_confirmed_at;

ALTER TABLE public.sms_notification_logs
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_alerted_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.sms_notification_logs.delivery_confirmed_at IS '솔라피 결과로 단말 수신 완료(4000)를 확인한 시각 — 이후 점검 제외';
COMMENT ON COLUMN public.sms_notification_logs.delivery_alerted_at   IS '미도착 의심(3000 30분 초과)·발송 실패 관리자 푸시를 보낸 시각 — 같은 건 중복 알림 방지';

CREATE INDEX IF NOT EXISTS sms_notification_logs_delivery_check_idx
  ON public.sms_notification_logs (created_at DESC)
  WHERE status = 'sent' AND delivery_confirmed_at IS NULL AND delivery_alerted_at IS NULL;

GRANT UPDATE (delivery_confirmed_at, delivery_alerted_at) ON public.sms_notification_logs TO service_role;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS admin_notify_sms_undelivered BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_profiles.admin_notify_sms_undelivered IS
  '관리자 푸시 수신 설정 — 고객 문자(전자계약서 안내·예약 승인)가 단말에 도착하지 않은 것으로 의심될 때 푸시(이벤트 sms_undelivered). cms_role 보유자에게만 의미 있음.';

DO $$
DECLARE
  v_oid  oid;
  v_def  text;
  v_new  text;
BEGIN
  -- ① get_admin_push_recipients
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_admin_push_recipients';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'get_admin_push_recipients 없음'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('admin_notify_sms_undelivered' IN v_def) = 0 THEN
    IF position(E'      WHEN ''crazychat_request''      THEN admin_notify_crazychat_request\n' IN v_def) = 0 THEN
      RAISE EXCEPTION 'get_admin_push_recipients 앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
    END IF;
    v_new := replace(v_def,
      E'      WHEN ''crazychat_request''      THEN admin_notify_crazychat_request\n',
      E'      WHEN ''crazychat_request''      THEN admin_notify_crazychat_request\n      WHEN ''sms_undelivered''        THEN admin_notify_sms_undelivered\n');
    EXECUTE v_new;
  END IF;

  -- ② update_admin_notify_setting
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'update_admin_notify_setting';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'update_admin_notify_setting 없음'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('admin_notify_sms_undelivered' IN v_def) = 0 THEN
    IF position('''identity_review'', ''crazychat_request'')' IN v_def) = 0
       OR position(E'  ELSIF p_event_key = ''crazychat_request'' THEN\n    UPDATE user_profiles SET admin_notify_crazychat_request = p_enabled\n    WHERE id = p_target_user_id AND cms_role IS NOT NULL;\n' IN v_def) = 0 THEN
      RAISE EXCEPTION 'update_admin_notify_setting 앵커를 찾지 못했습니다 — 라이브 정의가 예상과 다릅니다';
    END IF;
    v_new := replace(v_def,
      '''identity_review'', ''crazychat_request'')',
      '''identity_review'', ''crazychat_request'', ''sms_undelivered'')');
    v_new := replace(v_new,
      E'  ELSIF p_event_key = ''crazychat_request'' THEN\n    UPDATE user_profiles SET admin_notify_crazychat_request = p_enabled\n    WHERE id = p_target_user_id AND cms_role IS NOT NULL;\n',
      E'  ELSIF p_event_key = ''crazychat_request'' THEN\n    UPDATE user_profiles SET admin_notify_crazychat_request = p_enabled\n    WHERE id = p_target_user_id AND cms_role IS NOT NULL;\n  ELSIF p_event_key = ''sms_undelivered'' THEN\n    UPDATE user_profiles SET admin_notify_sms_undelivered = p_enabled\n    WHERE id = p_target_user_id AND cms_role IS NOT NULL;\n');
    EXECUTE v_new;
  END IF;
END $$;
