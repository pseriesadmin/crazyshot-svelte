-- Migration 748 — 회원가입 휴대폰 번호 중복 확인 RPC (2026-10-23)
--
-- 배경: 가입 화면의 번호 중복 확인이 브라우저 세션으로 user_profiles를 직접 조회했다. 일반 사용자는 남의 프로필을 읽을 수 없어
--       (본인 행만 조회) 항상 "없음"이 나왔고, 번호 형식도 하이픈 없는 값만 비교해 "010-1234-5678"로 저장된 번호는 놓쳤다.
-- 수정: check_email_registered와 같은 방식의 SECURITY DEFINER 함수로 서버 쪽에서 판정한다.
--       하이픈 등 숫자 외 문자를 무시하고 비교하며, 삭제(deleted_at)·탈회 완전삭제(번호 NULL) 계정은 제외한다.
-- 권한: 가입 화면이 익명/일반 세션으로 호출하므로 anon·authenticated 허용(반환값은 true/false뿐, 번호·계정 정보 미노출).

CREATE OR REPLACE FUNCTION public.check_phone_registered(p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE phone IS NOT NULL
      AND deleted_at IS NULL
      AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g')
      AND regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') <> ''
  );
$$;

REVOKE ALL ON FUNCTION public.check_phone_registered(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_phone_registered(TEXT) TO anon, authenticated;

-- ── ROLLBACK ── DROP FUNCTION public.check_phone_registered(TEXT);
