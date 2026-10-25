-- Migration #763: 회원 삭제·탈퇴 통합 — 공통 차단 조건 · CMS 삭제도 30일 유예 · 익명 전환 · 이메일 재가입 제한 (2026-10-24)
--
-- 정책 정본: .claude/plan/회원 삭제·탈퇴 정책 및 익명 전환 구현 계획(2026-10-24).md
--   · 본인 탈퇴와 CMS 관리자 삭제는 같은 흐름: 삭제 요청 → 30일 유예 → 익명 전환(withdrawal_status: requested → purged)
--   · 두 경로가 같은 차단 조건 함수(private.account_deletion_blockers)를 쓴다
--   · 본인 탈퇴는 유예 중 재로그인으로 자동 복구(현행), CMS 삭제는 관리자만 복구(고객 재로그인으로 되살아나지 않음)
--   · 익명 전환 시점(유예 종료 직후)부터 3개월 동안 같은 이메일 재가입 불가(이메일은 해시로만 보관)
--   · 관리대상(blacklisted)은 삭제로 풀리지 않고, 익명 전환 때 사전 등록 관리대상(managed_persons)으로도 이관
--   · 예약·주문·결제·계약 행은 법정 보존(5년) 대상이라 건드리지 않는다(만료 도래는 별도 리포트 — Migration #764)
-- 롤백은 파일 맨 아래 참고.

-- ── 0. 컬럼 ───────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS withdrawal_initiator   text,
  ADD COLUMN IF NOT EXISTS withdrawal_requested_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_withdrawal_initiator_check') THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_withdrawal_initiator_check
      CHECK (withdrawal_initiator IS NULL OR withdrawal_initiator IN ('user', 'admin'));
  END IF;
END $$;

-- ── 1. 감사 기록 · 저장소 정리 대기열 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_deletion_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid        NOT NULL,
  event      text        NOT NULL CHECK (event IN ('requested', 'restored', 'anonymized', 'anonymize_failed')),
  initiator  text,
  actor_id   uuid,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_events_user ON public.account_deletion_events (user_id, created_at DESC);
ALTER TABLE public.account_deletion_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.account_deletion_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.account_deletion_events_id_seq TO service_role;

-- 서류·아바타 파일은 SQL로 지우면 실제 파일이 남을 수 있어 서버(저장소 API)가 처리한다 — 대기열에 쌓아 두고 크론이 비운다
CREATE TABLE IF NOT EXISTS public.account_storage_cleanup (
  id         bigserial PRIMARY KEY,
  user_id    uuid        NOT NULL,
  bucket     text        NOT NULL,
  prefix     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at    timestamptz,
  attempts   int         NOT NULL DEFAULT 0,
  UNIQUE (user_id, bucket)
);
ALTER TABLE public.account_storage_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_storage_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.account_storage_cleanup TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.account_storage_cleanup_id_seq TO service_role;

-- ── 2. 삭제 차단 조건(공통) ───────────────────────────────────────────────────────
-- 돌려주는 코드: active_rental(진행 중 대여) · return_inspection(반납 후 검수·이슈 미결) · active_subscription(활성 구독)
CREATE OR REPLACE FUNCTION private.account_deletion_blockers(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(b.code ORDER BY b.ord), '[]'::jsonb)
  FROM (
    SELECT 1 AS ord, 'active_rental'::text AS code
     WHERE EXISTS (SELECT 1 FROM rental_reservations
                    WHERE user_id = p_user_id
                      AND status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested'))
    UNION ALL
    SELECT 2, 'return_inspection'
     WHERE EXISTS (SELECT 1 FROM rental_reservations
                    WHERE user_id = p_user_id
                      AND (status = 'returned' OR inspection_status = 'issue'))
    UNION ALL
    SELECT 3, 'active_subscription'
     WHERE EXISTS (SELECT 1 FROM user_subscriptions
                    WHERE user_id = p_user_id AND status = 'active')
  ) b;
$$;

-- ── 3. 본인 탈퇴 신청(공통 차단 조건 사용 · 시작 주체 기록) ──────────────────────────
CREATE OR REPLACE FUNCTION public.request_account_withdrawal(p_reasons text[], p_reason_etc text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid                 UUID;
  v_withdrawal_status   TEXT;
  v_blockers            JSONB;
  v_reason_etc_trimmed  TEXT;
  v_purge_at            TIMESTAMPTZ;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.');
  END IF;

  IF p_reasons IS NULL OR array_length(p_reasons, 1) IS NULL OR array_length(p_reasons, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '탈퇴 사유를 하나 이상 선택해 주세요.', 'error_code', 'invalid_reasons');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_reasons) AS r(code)
    WHERE r.code NOT IN ('no_longer_use', 'lack_of_options', 'complex_process', 'using_other_service', 'etc')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', '올바르지 않은 탈퇴 사유 코드입니다.', 'error_code', 'invalid_reasons');
  END IF;

  IF 'etc' = ANY(p_reasons) THEN
    v_reason_etc_trimmed := trim(p_reason_etc);
    IF v_reason_etc_trimmed IS NULL OR length(v_reason_etc_trimmed) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', '기타 사유를 입력해 주세요.', 'error_code', 'etc_required');
    END IF;
    IF length(v_reason_etc_trimmed) > 300 THEN
      RETURN jsonb_build_object('ok', false, 'error', '기타 사유는 300자 이내로 입력해 주세요.', 'error_code', 'etc_too_long');
    END IF;
  ELSE
    v_reason_etc_trimmed := NULL;
  END IF;

  SELECT withdrawal_status INTO v_withdrawal_status FROM user_profiles WHERE id = v_uid;

  IF v_withdrawal_status = 'requested' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 탈퇴가 신청된 계정입니다.', 'error_code', 'already_requested');
  END IF;

  v_blockers := private.account_deletion_blockers(v_uid);
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', CASE WHEN v_blockers ? 'active_rental'
                    THEN '진행 중인 대여를 먼저 완료해 주세요.'
                    ELSE '정리가 끝나지 않은 거래가 있어 탈퇴할 수 없습니다.' END,
      'error_code', CASE WHEN v_blockers ? 'active_rental' THEN 'active_rental_exists' ELSE 'not_deletable' END,
      'blockers', v_blockers
    );
  END IF;

  v_purge_at := now() + INTERVAL '30 days';

  UPDATE user_profiles
     SET withdrawal_status       = 'requested',
         withdrawal_requested_at = now(),
         withdrawal_purge_at     = v_purge_at,
         withdrawal_reasons      = p_reasons,
         withdrawal_reason_etc   = v_reason_etc_trimmed,
         withdrawal_initiator    = 'user',
         withdrawal_requested_by = v_uid,
         updated_at              = now()
   WHERE id = v_uid;

  INSERT INTO account_deletion_events (user_id, event, initiator, actor_id, details)
  VALUES (v_uid, 'requested', 'user', v_uid, jsonb_build_object('purge_at', v_purge_at));

  RETURN jsonb_build_object('ok', true, 'purge_at', v_purge_at);
END;
$function$;

-- ── 4. 유예 중 본인 로그인 자동 복구(관리자 삭제 건은 복구하지 않음) ────────────────────
CREATE OR REPLACE FUNCTION public.restore_withdrawn_account()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        UUID;
  v_status     TEXT;
  v_purge_at   TIMESTAMPTZ;
  v_initiator  TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '로그인이 필요합니다.');
  END IF;

  SELECT withdrawal_status, withdrawal_purge_at, withdrawal_initiator
    INTO v_status, v_purge_at, v_initiator
    FROM user_profiles
   WHERE id = v_uid;

  IF v_status IS DISTINCT FROM 'requested' THEN
    RETURN jsonb_build_object('ok', true, 'restored', false);
  END IF;

  IF now() >= v_purge_at THEN
    RETURN jsonb_build_object('ok', true, 'restored', false, 'expired', true);
  END IF;

  -- 관리자가 삭제한 계정은 고객 로그인으로 되살아나지 않는다(관리자 복구만 가능)
  IF v_initiator = 'admin' THEN
    RETURN jsonb_build_object('ok', true, 'restored', false, 'admin_blocked', true);
  END IF;

  UPDATE user_profiles
     SET withdrawal_status       = 'none',
         withdrawal_requested_at = NULL,
         withdrawal_purge_at     = NULL,
         withdrawal_reasons      = NULL,
         withdrawal_reason_etc   = NULL,
         withdrawal_initiator    = NULL,
         withdrawal_requested_by = NULL,
         updated_at              = now()
   WHERE id = v_uid;

  INSERT INTO account_deletion_events (user_id, event, initiator, actor_id)
  VALUES (v_uid, 'restored', 'user', v_uid);

  RETURN jsonb_build_object('ok', true, 'restored', true);
END;
$function$;

-- ── 5. CMS 관리자 삭제 요청 / 복구 (서버 전용) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_request_account_deletion(p_user_id uuid, p_admin_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status   text;
  v_cms      text;
  v_blockers jsonb;
  v_purge_at timestamptz;
  v_reason   text := btrim(COALESCE(p_reason, ''));
BEGIN
  SELECT withdrawal_status, cms_role INTO v_status, v_cms
    FROM user_profiles WHERE id = p_user_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '계정을 찾을 수 없습니다.', 'error_code', 'not_found');
  END IF;
  IF v_cms IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '관리자 계정은 계정 관리에서 처리해 주세요.', 'error_code', 'admin_account');
  END IF;
  IF v_status = 'requested' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 삭제가 요청된 계정입니다.', 'error_code', 'already_requested');
  END IF;
  IF v_status = 'purged' THEN
    RETURN jsonb_build_object('ok', false, 'error', '이미 익명 전환된 계정입니다.', 'error_code', 'already_purged');
  END IF;
  IF length(v_reason) > 300 THEN
    RETURN jsonb_build_object('ok', false, 'error', '사유는 300자 이내로 입력해 주세요.', 'error_code', 'reason_too_long');
  END IF;

  v_blockers := private.account_deletion_blockers(p_user_id);
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '정리가 끝나지 않은 거래가 있어 삭제할 수 없습니다.',
                              'error_code', 'not_deletable', 'blockers', v_blockers);
  END IF;

  v_purge_at := now() + INTERVAL '30 days';

  -- 관리대상(blacklisted)·사유는 그대로 둔다(삭제로 풀리지 않음)
  UPDATE user_profiles
     SET withdrawal_status       = 'requested',
         withdrawal_requested_at = now(),
         withdrawal_purge_at     = v_purge_at,
         withdrawal_reasons      = ARRAY['admin_delete'],
         withdrawal_reason_etc   = NULLIF(v_reason, ''),
         withdrawal_initiator    = 'admin',
         withdrawal_requested_by = p_admin_id,
         updated_at              = now()
   WHERE id = p_user_id;

  -- 관리자 삭제는 고객이 로그인으로 되돌릴 수 없으므로 유예 시작과 함께 로그인 계정을 차단하고 열려 있는 세션을 끊는다(복구하면 해제)
  UPDATE auth.users SET banned_until = now() + INTERVAL '876000 hours', updated_at = now() WHERE id = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;

  INSERT INTO account_deletion_events (user_id, event, initiator, actor_id, details)
  VALUES (p_user_id, 'requested', 'admin', p_admin_id, jsonb_build_object('purge_at', v_purge_at, 'reason', NULLIF(v_reason, '')));

  RETURN jsonb_build_object('ok', true, 'purge_at', v_purge_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cms_restore_account_deletion(p_user_id uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status    text;
  v_purge_at  timestamptz;
  v_initiator text;
BEGIN
  SELECT withdrawal_status, withdrawal_purge_at, withdrawal_initiator INTO v_status, v_purge_at, v_initiator
    FROM user_profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '계정을 찾을 수 없습니다.', 'error_code', 'not_found');
  END IF;
  IF v_status IS DISTINCT FROM 'requested' THEN
    RETURN jsonb_build_object('ok', false, 'error', '삭제 유예 중인 계정이 아닙니다.', 'error_code', 'not_requested');
  END IF;
  IF now() >= v_purge_at THEN
    RETURN jsonb_build_object('ok', false, 'error', '유예 기간이 지나 복구할 수 없습니다.', 'error_code', 'expired');
  END IF;

  UPDATE user_profiles
     SET withdrawal_status       = 'none',
         withdrawal_requested_at = NULL,
         withdrawal_purge_at     = NULL,
         withdrawal_reasons      = NULL,
         withdrawal_reason_etc   = NULL,
         withdrawal_initiator    = NULL,
         withdrawal_requested_by = NULL,
         updated_at              = now()
   WHERE id = p_user_id;

  -- 관리자 삭제 때 걸었던 로그인 차단 해제(본인 탈퇴는 차단하지 않았으므로 건드리지 않는다)
  IF v_initiator = 'admin' THEN
    UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = p_user_id;
  END IF;

  INSERT INTO account_deletion_events (user_id, event, initiator, actor_id, details)
  VALUES (p_user_id, 'restored', 'admin', p_admin_id, jsonb_build_object('was_initiator', v_initiator));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_request_account_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_request_account_deletion(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.cms_restore_account_deletion(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_restore_account_deletion(uuid, uuid) TO service_role;

-- ── 6. 이메일 재가입 제한 ─────────────────────────────────────────────────────────
-- 이메일은 평문으로 저장하지 않는다 — 소문자·공백 제거 후 서버 비밀값(pepper)과 함께 SHA-256 해시로만 보관
CREATE TABLE IF NOT EXISTS public.signup_restrictions (
  email_hash       text        PRIMARY KEY,
  restricted_until timestamptz NOT NULL,
  source_user_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signup_restrictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_restrictions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_restrictions TO service_role;

CREATE TABLE IF NOT EXISTS private.signup_restriction_secret (
  id     int  PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pepper text NOT NULL
);
INSERT INTO private.signup_restriction_secret (id, pepper)
VALUES (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON private.signup_restriction_secret FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.email_restriction_hash(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT encode(
    sha256(convert_to(lower(btrim(COALESCE(p_email, ''))) || (SELECT pepper FROM private.signup_restriction_secret WHERE id = 1), 'UTF8')),
    'hex');
$$;

-- 가입 화면용 사전 확인(비로그인 가능) — 제한 중인지 여부만 돌려준다(가입 가능일은 알려주지 않는다 — 조회로 남의 탈퇴 시점을 추정하지 못하게)
CREATE OR REPLACE FUNCTION public.check_signup_restricted(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN jsonb_build_object('restricted', false);
  END IF;
  SELECT restricted_until INTO v_until
    FROM signup_restrictions
   WHERE email_hash = private.email_restriction_hash(p_email)
     AND restricted_until > now();
  IF v_until IS NULL THEN
    RETURN jsonb_build_object('restricted', false);
  END IF;
  RETURN jsonb_build_object('restricted', true);
END;
$$;
REVOKE ALL ON FUNCTION public.check_signup_restricted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_signup_restricted(text) TO anon, authenticated, service_role;

-- 마지막 방어선 — 화면을 거치지 않고 제한 중인 이메일로 계정을 만들거나 바꾸려 해도 DB가 거절한다
CREATE OR REPLACE FUNCTION public.enforce_signup_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz;
  v_candidate text;
BEGIN
  FOREACH v_candidate IN ARRAY ARRAY[NEW.email, NULLIF(NEW.email_change, '')]
  LOOP
    CONTINUE WHEN v_candidate IS NULL OR v_candidate = '' OR v_candidate LIKE '%@purged.crazyshot.kr';
    SELECT restricted_until INTO v_until
      FROM signup_restrictions
     WHERE email_hash = private.email_restriction_hash(v_candidate)
       AND restricted_until > now();
    IF v_until IS NOT NULL THEN
      RAISE EXCEPTION 'SIGNUP_RESTRICTED';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_signup_restriction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_signup_restriction_insert ON auth.users;
CREATE TRIGGER on_auth_user_signup_restriction_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS NOT NULL AND NEW.email <> '')
  EXECUTE FUNCTION public.enforce_signup_restriction();

DROP TRIGGER IF EXISTS on_auth_user_signup_restriction_update ON auth.users;
CREATE TRIGGER on_auth_user_signup_restriction_update
  BEFORE UPDATE OF email, email_change ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email OR OLD.email_change IS DISTINCT FROM NEW.email_change)
  EXECUTE FUNCTION public.enforce_signup_restriction();

-- ── 7. 익명 전환(유예 종료 직후, 크론이 호출) ─────────────────────────────────────────
-- 실패하면 그 계정의 변경 전체가 되돌려지고 'requested' 상태로 남아 다음 실행 때 다시 시도된다.
CREATE OR REPLACE FUNCTION private.anonymize_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prof   public.user_profiles%ROWTYPE;
  v_email  text;
  v_digits text;
  v_placeholder text;
BEGIN
  SELECT * INTO v_prof FROM user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_prof.withdrawal_status IS DISTINCT FROM 'requested' THEN
    RETURN;
  END IF;

  -- 유예 중에 새로 생긴 거래(예약 등)가 있으면 익명 전환하지 않는다 — 예외를 던져 크론이 실패로 기록하고(관리자에게 보임) 다음 실행에서 다시 확인한다
  IF jsonb_array_length(private.account_deletion_blockers(p_user_id)) > 0 THEN
    RAISE EXCEPTION 'anonymize_blocked: 유예 중 정리가 끝나지 않은 거래가 생겼습니다 (%)', private.account_deletion_blockers(p_user_id)::text;
  END IF;

  SELECT NULLIF(email, '') INTO v_email FROM auth.users WHERE id = p_user_id;
  v_email := COALESCE(v_email, NULLIF(v_prof.email, ''));
  v_placeholder := 'purged-' || p_user_id::text || '@purged.crazyshot.kr';

  -- (a) 이메일 재가입 제한 — 익명 전환일부터 3개월
  IF v_email IS NOT NULL AND v_email NOT LIKE '%@purged.crazyshot.kr' THEN
    INSERT INTO signup_restrictions (email_hash, restricted_until, source_user_id)
    VALUES (private.email_restriction_hash(v_email), now() + INTERVAL '3 months', p_user_id)
    ON CONFLICT (email_hash) DO UPDATE
      SET restricted_until = GREATEST(signup_restrictions.restricted_until, EXCLUDED.restricted_until),
          source_user_id   = EXCLUDED.source_user_id;
  END IF;

  -- (b) 관리대상이면 사전 등록 관리대상으로도 이관(같은 사람이 다시 가입하면 기존 대조 기능이 알려준다)
  --     프로필의 blacklisted·blacklist_reason은 그대로 둔다 — 관리대상 목록에서 빠지지 않는다
  IF v_prof.blacklisted THEN
    v_digits := private_managed_phone_digits(v_prof.phone);
    IF v_digits ~ '^0[0-9]{8,10}$'
       AND NOT EXISTS (SELECT 1 FROM managed_persons WHERE phone_digits = v_digits AND deleted_at IS NULL) THEN
      INSERT INTO managed_persons (name, phone, phone_digits, email, birth_date, reason, member_code)
      VALUES (
        COALESCE(NULLIF(btrim(v_prof.full_name), ''), '(이름 없음)'),
        private_managed_phone_display(v_digits),
        v_digits,
        v_email,
        v_prof.birth_date,
        left(COALESCE(NULLIF(v_prof.blacklist_reason, ''), '관리대상') || ' [탈퇴 전 관리대상 이관]', 1000),
        generate_member_code('B2C', true, 'MG')
      );
    END IF;
  END IF;

  -- (c) 프로필 개인정보 제거(관리대상 지정·거래 연결에 필요한 값은 유지)
  UPDATE user_profiles
     SET full_name            = NULL,
         phone                = NULL,
         birth_date           = NULL,
         address              = NULL,
         city                 = NULL,
         postal_code          = NULL,
         country              = NULL,
         email                = v_placeholder,
         avatar_url           = NULL,
         identity_type        = NULL,
         identity_doc_url     = NULL,
         identity_verified_at = NULL,
         foreign_doc_url      = NULL,
         foreign_doc_urls     = NULL,
         foreign_type         = NULL,
         foreign_stay_type    = NULL,
         foreign_verified_at  = NULL,
         points               = 0,
         withdrawal_status       = 'purged',
         withdrawal_purged_at    = now(),
         withdrawal_requested_at = NULL,
         withdrawal_purge_at     = NULL,
         withdrawal_reasons      = NULL,
         withdrawal_reason_etc   = NULL,
         updated_at           = now()
   WHERE id = p_user_id;

  -- (d) 로그인 계정 무력화 — 이메일 익명화(같은 이메일 재가입 충돌 해소) · 비밀번호 폐기 · 로그인 차단 · 세션 제거
  UPDATE auth.users
     SET email               = v_placeholder,
         phone               = NULL,
         encrypted_password  = '!' || gen_random_uuid()::text,
         banned_until        = now() + INTERVAL '876000 hours',   -- 100년(관리자 퇴직 처리와 같은 값) — 'infinity'는 Auth 서버가 읽지 못해 계정 조회가 깨진다
         email_change        = '',
         phone_change        = '',
         raw_user_meta_data  = '{}'::jsonb,
         updated_at          = now()
   WHERE id = p_user_id;
  DELETE FROM auth.identities WHERE user_id = p_user_id;
  DELETE FROM auth.sessions   WHERE user_id = p_user_id;

  -- (e) 목적이 끝난 개인 데이터 삭제(거래·계약·상담 기록은 법정 보존 기간 동안 유지)
  DELETE FROM user_shipping_addresses WHERE user_id = p_user_id;
  DELETE FROM notification_tokens     WHERE user_id = p_user_id;
  DELETE FROM product_wishlists       WHERE user_id = p_user_id;
  -- 쿠폰: 결제에 쓰인 쿠폰은 주문 기록이 참조(order_coupons·orders)하므로 거래 기록으로 남기고(개인정보 없음), 쓰이지 않은 쿠폰만 삭제한다
  DELETE FROM user_coupons uc
   WHERE uc.user_id = p_user_id
     AND NOT EXISTS (SELECT 1 FROM order_coupons oc WHERE oc.user_coupon_id = uc.id)
     AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.selected_coupon_id = uc.id);
  DELETE FROM user_segments           WHERE user_id = p_user_id;
  DELETE FROM foreign_users           WHERE user_id = p_user_id;
  DELETE FROM phone_otps              WHERE user_id = p_user_id;
  DELETE FROM password_reset_otps     WHERE user_id = p_user_id;

  -- (e-2) 작성한 댓글·후기는 내용을 남기고 작성자 표기만 익명으로(작성자가 직접 삭제하지 않은 글만 남아 있다 — 게시글은 프로필 이름이 비어 화면이 '익명'으로 표시)
  UPDATE post_comments   SET author_name = '익명' WHERE user_id = p_user_id;
  UPDATE product_reviews SET author_name = '익명' WHERE user_id = p_user_id;

  -- (f) 서류·아바타 파일은 서버 크론이 저장소 API로 지운다
  INSERT INTO account_storage_cleanup (user_id, bucket, prefix)
  VALUES (p_user_id, 'user-documents', p_user_id::text || '/'),
         (p_user_id, 'user-avatars',   p_user_id::text || '/')
  ON CONFLICT (user_id, bucket) DO NOTHING;

  INSERT INTO account_deletion_events (user_id, event, initiator, actor_id, details)
  VALUES (p_user_id, 'anonymized', v_prof.withdrawal_initiator, NULL,
          jsonb_build_object('had_blacklist', COALESCE(v_prof.blacklisted, false)));
END;
$$;

-- 매일 크론(purge-withdrawn-accounts)이 호출하는 기존 함수 이름 유지
CREATE OR REPLACE FUNCTION public.purge_withdrawn_accounts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM user_profiles
     WHERE withdrawal_status = 'requested'
       AND withdrawal_purge_at <= now()
  LOOP
    BEGIN
      PERFORM private.anonymize_account(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'anonymize_account 실패(다음 실행에서 재시도): % — %', r.id, SQLERRM;
      -- 실패를 기록해 크론·CMS 보존리포트에서 보이게 한다(같은 계정은 20시간에 한 번만 기록)
      IF NOT EXISTS (SELECT 1 FROM account_deletion_events e
                      WHERE e.user_id = r.id AND e.event = 'anonymize_failed' AND e.created_at > now() - INTERVAL '20 hours') THEN
        INSERT INTO account_deletion_events (user_id, event, initiator, actor_id, details)
        VALUES (r.id, 'anonymize_failed', NULL, NULL, jsonb_build_object('error', left(SQLERRM, 500)));
      END IF;
    END;
  END LOOP;
END;
$function$;

-- private 함수는 서버 DEFINER 함수 내부에서만 호출 — 외부 실행 권한을 모두 닫는다
REVOKE ALL ON FUNCTION private.anonymize_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.account_deletion_blockers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.email_restriction_hash(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_withdrawn_accounts() FROM PUBLIC, anon, authenticated;

-- ── 8. 관리자 삭제 유예 계정의 새 거래 차단 ──────────────────────────────────────────
-- 관리자 삭제는 로그인을 막지만 이미 발급된 토큰은 만료 전까지 DB 직접 호출이 가능하다(sp5 MEDIUM-1). 그 틈에 새 예약·주문·구독이 생기면 익명 전환이 막히므로
-- 거래를 만드는 표(예약·주문·구독)에서 "관리자 삭제 유예 중 계정"의 신규 행을 거절한다. 본인 탈퇴 유예(initiator='user')는 재로그인 시 자동 복구되는 설계라 대상이 아니다.
CREATE OR REPLACE FUNCTION public.block_admin_deleted_account_new_txn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = NEW.user_id AND withdrawal_status = 'requested' AND withdrawal_initiator = 'admin'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_PENDING: 삭제 처리 중인 계정은 새 거래를 만들 수 없습니다.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.block_admin_deleted_account_new_txn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_block_admin_deleted_txn ON public.rental_reservations;
CREATE TRIGGER trg_block_admin_deleted_txn BEFORE INSERT ON public.rental_reservations
  FOR EACH ROW EXECUTE FUNCTION public.block_admin_deleted_account_new_txn();
DROP TRIGGER IF EXISTS trg_block_admin_deleted_txn ON public.orders;
CREATE TRIGGER trg_block_admin_deleted_txn BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.block_admin_deleted_account_new_txn();
DROP TRIGGER IF EXISTS trg_block_admin_deleted_txn ON public.user_subscriptions;
CREATE TRIGGER trg_block_admin_deleted_txn BEFORE INSERT ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.block_admin_deleted_account_new_txn();

-- ── 롤백 ───────────────────────────────────────────────────────────────────────────
-- 데이터 변경(익명 전환)은 되돌릴 수 없으므로 크론 활성화 전에 대상 건수를 조회해 확인한다:
--   SELECT count(*) FROM user_profiles WHERE withdrawal_status='requested' AND withdrawal_purge_at <= now();
-- 구조 롤백: DROP TRIGGER on_auth_user_signup_restriction_insert/update ON auth.users; DROP FUNCTION public.enforce_signup_restriction();
--   DROP TRIGGER trg_block_admin_deleted_txn ON rental_reservations, orders, user_subscriptions; DROP FUNCTION public.block_admin_deleted_account_new_txn();
--   DROP FUNCTION public.check_signup_restricted(text), public.cms_request_account_deletion(uuid,uuid,text), public.cms_restore_account_deletion(uuid,uuid),
--   private.anonymize_account(uuid), private.account_deletion_blockers(uuid), private.email_restriction_hash(text);
--   DROP TABLE public.signup_restrictions, public.account_deletion_events, public.account_storage_cleanup, private.signup_restriction_secret;
--   request_account_withdrawal / restore_withdrawn_account / purge_withdrawn_accounts 는 Migration #366·#367·#368 정의로 복원
