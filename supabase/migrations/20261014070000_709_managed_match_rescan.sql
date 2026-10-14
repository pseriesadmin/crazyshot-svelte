-- Migration #709: 관리대상 대조 — 실패 기록 + 재스캔(놓친 건 구제·역방향·백필) + 정기 점검
--
-- 배경(QA 재판단, 2026-10-14): #708 트리거는 오류를 삼켜 가입을 막지 않지만, 대조 실패가 흔적 없이 영구 누락으로 남을 수 있었다
--   (대조는 전화·이메일 저장 시점에 한 번만 일어남). 또 관리대상을 가입 이후에 등록하면 이미 가입한 동일 회원은 감지되지 않았다.
--
-- 수정:
--   ① 트리거 함수: 오류를 삼키는 설계는 유지(가입 비차단)하되 RAISE WARNING으로 흔적을 남긴다.
--   ② 재스캔 함수 public.cms_rescan_managed_matches(): 활성·비관리자 회원 중 일치 기록이 없는 사람을 사전 등록 관리대상과 다시 대조해
--      pending으로 기록한다(전화 숫자 일치 우선, 없으면 이메일). 멱등 — 이미 기록이 있으면 건드리지 않음. 새로 기록한 건수를 반환.
--      놓친 건 구제·가입 이후 등록(역방향)·기존 회원 백필을 한 함수로 해결한다. service_role 전용.
--   ③ 정기 점검: pg_cron 'managed_match_rescan' 매일 03:30 KST(= 18:30 UTC). 관리대상 등록·수정 직후에도 앱이 호출한다(fail-soft).
-- 롤백: SELECT cron.unschedule('managed_match_rescan'); DROP FUNCTION public.cms_rescan_managed_matches();
--       트리거 함수는 #708의 EXCEPTION 블록(RAISE WARNING 없음)으로 되돌린다.

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
  -- 대조 실패가 가입·프로필 저장을 막아서는 안 된다(fail-soft). 단 흔적은 남긴다 — 놓친 건은 재스캔 함수가 구제한다.
  RAISE WARNING '[managed_match] 대조 실패 user=% : %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.match_signup_to_managed_person() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cms_rescan_managed_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  WITH cand AS (
    SELECT p.id AS user_id,
           (SELECT mp.id FROM public.managed_persons mp
             WHERE mp.deleted_at IS NULL
               AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') <> ''
               AND mp.phone_digits = regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')
             ORDER BY mp.created_at LIMIT 1) AS by_phone,
           (SELECT mp.id FROM public.managed_persons mp
             WHERE mp.deleted_at IS NULL AND mp.email IS NOT NULL
               AND btrim(COALESCE(p.email, '')) <> ''
               AND lower(btrim(mp.email)) = lower(btrim(p.email))
             ORDER BY mp.created_at LIMIT 1) AS by_email
      FROM public.user_profiles p
     WHERE p.cms_role IS NULL AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.managed_person_matches m WHERE m.user_id = p.id)
  ), ins AS (
    INSERT INTO public.managed_person_matches (user_id, person_id, basis)
    SELECT user_id, COALESCE(by_phone, by_email), CASE WHEN by_phone IS NOT NULL THEN 'phone' ELSE 'email' END
      FROM cand
     WHERE by_phone IS NOT NULL OR by_email IS NOT NULL
    ON CONFLICT (user_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;
  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.cms_rescan_managed_matches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cms_rescan_managed_matches() TO service_role;

-- 정기 점검: 매일 03:30 KST (pg_cron은 UTC 기준 → 18:30). 같은 이름이 있으면 교체.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'managed_match_rescan') THEN
    PERFORM cron.unschedule('managed_match_rescan');
  END IF;
  PERFORM cron.schedule('managed_match_rescan', '30 18 * * *', 'SELECT public.cms_rescan_managed_matches()');
END
$$;
