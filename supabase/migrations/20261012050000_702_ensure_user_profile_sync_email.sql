-- Migration #702: ensure_user_profile() — 익명→정식 전환 시 프로필 이메일 동기화
--
-- 배경(2026-10-12 Production 조회로 확인): 회원가입 화면은 휴대폰 인증을 위해 먼저 익명 세션 + 빈 프로필(email='')을 만들고,
-- 인증 후 updateUser({email, password})로 정식 계정으로 전환한 뒤 ensure_user_profile()을 다시 호출한다.
-- 그런데 이 함수는 ON CONFLICT (id) DO NOTHING이라 이미 있는 빈 프로필의 email을 채우지 못했다(handle_new_user 트리거는
-- auth.users INSERT에만 걸려 UPDATE 전환에는 실행되지 않음). 결과: 2026-10-03 이후 가입자 4명이 프로필 이메일이 빈 채로
-- 번호만 있는 회원으로 남음(CMS 고객목록에 이메일 공란).
--
-- 수정: 이메일은 JWT(전환 직후엔 갱신 전 토큰일 수 있음)가 아니라 auth.users에서 직접 읽고,
--       프로필 이메일이 비어 있을 때만 채운다(이미 값이 있으면 덮어쓰지 않음). 다른 컬럼은 건드리지 않는다.
-- 권한: 기존과 동일(authenticated 호출 가능 — 가입 화면이 브라우저 세션으로 호출). 함수 본문만 교체.
-- 기존 4명 데이터 보정은 이 마이그레이션 범위 밖(별도 승인 후 처리).

CREATE OR REPLACE FUNCTION public.ensure_user_profile()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_email   TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;

  SELECT COALESCE(u.email, auth.jwt() ->> 'email', '')
    INTO v_email
    FROM auth.users u
   WHERE u.id = v_user_id;

  INSERT INTO public.user_profiles (id, user_id, email)
  VALUES (v_user_id, v_user_id, COALESCE(v_email, ''))
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email
    WHERE COALESCE(public.user_profiles.email, '') = ''
      AND COALESCE(EXCLUDED.email, '') <> '';

  RETURN v_user_id;
END;
$$;

-- ── 롤백(직전 정의 복구, 2026-10-12 Stage·Production 라이브 정의 기준) ──
-- CREATE OR REPLACE FUNCTION public.ensure_user_profile()
-- RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
-- DECLARE v_user_id UUID;
-- BEGIN
--   v_user_id := auth.uid();
--   IF v_user_id IS NULL THEN RAISE EXCEPTION 'User not authenticated'; END IF;
--   INSERT INTO public.user_profiles (id, user_id, email)
--   VALUES (v_user_id, v_user_id, auth.jwt() ->> 'email')
--   ON CONFLICT (id) DO NOTHING;
--   RETURN v_user_id;
-- END; $$;
-- (보정된 4명의 이메일은 정상 데이터라 되돌리지 않는다.)
