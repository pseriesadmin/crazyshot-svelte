-- Migration #708: 신규 가입자 ↔ 사전 등록 관리대상(managed_persons) 대조 → 자동 분류(미확인) → 관리자 확인
--
-- 배경(Stephen 요청 2026-10-14): 관리자가 사전 등록한 관리대상(회원 가입 이력 없는 인물)이 나중에 가입하면 감지해
--   고객목록 '관리대상' 칩에 즉시 나타나고, 관리자가 미확인 건수를 배지로 확인한 뒤 확정/해당 없음을 판단한다.
--
-- 설계:
--   · 대조 시점 = user_profiles의 전화번호·이메일이 채워지는 모든 경로(회원가입 인증·이메일 전환·레거시 인증·마이페이지 수정)에서
--     트리거 하나로 처리한다 — 가입 직전 "중복 정보 대조"(전화번호 인증·이메일 확인)와 같은 시점에 동시에 일어난다.
--   · 판정(강한 일치만 자동 분류): 전화번호 숫자 일치 → 'phone', 이메일 일치(대소문자 무시) → 'email'.
--     이름·이메일 아이디만 비슷한 경우는 오탐 위험이 커 자동 분류하지 않는다(범위 밖).
--   · 가입은 차단하지 않고, 계정을 블랙리스트로 바꾸지도 않는다 — 일치 기록(managed_person_matches)만 남기고
--     관리자가 '관리대상으로 확정'(→ 기존 toggle_blacklist 경로)하거나 '해당 없음'으로 닫는다.
--   · 일치 기록은 고객이 읽을 수 없도록 별도 테이블(RLS ON·정책 0건, service_role 전용)에 둔다 — user_profiles 컬럼으로 두면
--     본인 행 조회로 노출될 수 있다.
--   · 고객목록 '관리대상' 필터(p_blacklisted=true)에 '미확인(pending) 일치' 가입자도 포함한다(라이브 정의에서 한 줄만 치환).
-- 롤백: 트리거·함수·테이블 DROP, get_customer_list 필터 줄을 원래대로(아래 주석).

-- ── 1) 일치 기록 테이블 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.managed_person_matches (
  user_id      UUID PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  person_id    UUID REFERENCES public.managed_persons(id) ON DELETE SET NULL,
  basis        TEXT NOT NULL CHECK (basis IN ('phone', 'email')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  matched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID
);
ALTER TABLE public.managed_person_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.managed_person_matches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.managed_person_matches TO service_role;
CREATE INDEX IF NOT EXISTS idx_managed_person_matches_pending
  ON public.managed_person_matches (matched_at DESC) WHERE status = 'pending';

-- ── 2) 대조 트리거 ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.match_signup_to_managed_person()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits TEXT := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');
  v_email  TEXT := lower(btrim(COALESCE(NEW.email, '')));
  v_person UUID;
  v_basis  TEXT;
BEGIN
  -- 관리자 계정·삭제 계정은 대조하지 않는다. 이미 일치 기록(확정·해당 없음 포함)이 있으면 다시 만들지 않는다.
  IF NEW.cms_role IS NOT NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.managed_person_matches m WHERE m.user_id = NEW.id) THEN RETURN NEW; END IF;

  IF v_digits <> '' THEN
    SELECT mp.id INTO v_person
      FROM public.managed_persons mp
     WHERE mp.deleted_at IS NULL AND mp.phone_digits = v_digits
     ORDER BY mp.created_at LIMIT 1;
    IF v_person IS NOT NULL THEN v_basis := 'phone'; END IF;
  END IF;

  IF v_person IS NULL AND v_email <> '' THEN
    SELECT mp.id INTO v_person
      FROM public.managed_persons mp
     WHERE mp.deleted_at IS NULL AND mp.email IS NOT NULL AND lower(btrim(mp.email)) = v_email
     ORDER BY mp.created_at LIMIT 1;
    IF v_person IS NOT NULL THEN v_basis := 'email'; END IF;
  END IF;

  IF v_person IS NOT NULL THEN
    INSERT INTO public.managed_person_matches (user_id, person_id, basis)
    VALUES (NEW.id, v_person, v_basis)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 대조 실패가 가입·프로필 저장을 막아서는 안 된다(fail-soft).
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.match_signup_to_managed_person() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_match_signup_to_managed_person ON public.user_profiles;
CREATE TRIGGER trg_match_signup_to_managed_person
  AFTER INSERT OR UPDATE OF phone, email ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION private.match_signup_to_managed_person();

-- ── 3) 서버 전용 RPC 3종 ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cms_managed_match_pending_count()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT count(*)::int FROM public.managed_person_matches m
        JOIN public.user_profiles p ON p.id = m.user_id AND p.deleted_at IS NULL
       WHERE m.status = 'pending'; $$;

CREATE OR REPLACE FUNCTION public.cms_get_managed_match_flags(p_user_ids uuid[])
RETURNS TABLE (user_id uuid, status text, basis text, matched_at timestamptz, person_id uuid, person_name text, person_phone text, person_reason text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT m.user_id, m.status, m.basis, m.matched_at, m.person_id, mp.name, mp.phone, mp.reason
    FROM public.managed_person_matches m
    LEFT JOIN public.managed_persons mp ON mp.id = m.person_id
   WHERE m.user_id = ANY(p_user_ids);
$$;

CREATE OR REPLACE FUNCTION public.cms_review_managed_match(p_user_id uuid, p_decision text, p_reviewer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_status TEXT;
BEGIN
  IF p_decision NOT IN ('confirmed', 'dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
  END IF;
  UPDATE public.managed_person_matches
     SET status = p_decision, reviewed_at = now(), reviewed_by = p_reviewer
   WHERE user_id = p_user_id AND status = 'pending'
   RETURNING status INTO v_status;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.cms_managed_match_pending_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_get_managed_match_flags(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cms_review_managed_match(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_managed_match_pending_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_get_managed_match_flags(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.cms_review_managed_match(uuid, text, uuid) TO service_role;

-- ── 4) 고객목록 '관리대상' 필터에 미확인 일치 가입자 포함(라이브 정의에서 한 줄만 치환) ─────────────
-- 롤백: 새 줄을 원래 줄 `AND (p_user_id IS NOT NULL OR p_blacklisted IS NULL OR c.c_blacklisted = p_blacklisted)`로 되돌린다.
DO $migration$
DECLARE
  v_def TEXT;
  v_old TEXT := $old$    AND (p_user_id IS NOT NULL OR p_blacklisted IS NULL OR c.c_blacklisted = p_blacklisted)$old$;
  v_new TEXT := $new$    AND (p_user_id IS NOT NULL OR p_blacklisted IS NULL OR (
          c.c_blacklisted
          OR EXISTS (SELECT 1 FROM public.managed_person_matches mm WHERE mm.user_id = c.c_user_id AND mm.status = 'pending')
        ) = p_blacklisted)$new$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p WHERE p.proname = 'get_customer_list' AND p.pronamespace = 'public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_customer_list 정의를 찾지 못했습니다'; END IF;
  IF position('managed_person_matches mm' IN v_def) > 0 THEN RETURN; END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION '치환 대상 관리대상 필터 줄을 라이브 정의에서 찾지 못했습니다 — 적용 중단';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;
