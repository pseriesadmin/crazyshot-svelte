-- #803 배너 HTML·MP4 가드 보강 — sp5 3차 지적(낮은 등급 관리자의 직접 쓰기 우회 · 인코딩 우회)
-- 롤백: DROP TRIGGER trg_cms_settings_hero_prefix_guard ON public.cms_settings; DROP FUNCTION public.cms_settings_hero_prefix_guard();
--       그리고 banners_media_url_guard() 를 #802 정의로 되돌린다(20261110110000_802 참고).
--
-- 배경: cms_settings·banners 는 "관리자 역할이 있으면 누구나(파트너 포함) 브라우저에서 직접 쓰기" 정책이라
--   ① 낮은 등급(파트너)이 허용 주소 설정(hero_media_url_prefix)을 바꾸거나 ② 배너 주소를 HTML·MP4 로 바꿔
--   "HTML·영상은 매니저 이상만 등록" 제한을 DB 에서는 집행하지 못했다. 화면의 호스트 검사가 마지막 방어선이었다.
-- 설정 테이블 전체의 정책은 다른 설정 화면에 영향이 크므로 건드리지 않고, 이 기능에 필요한 부분만 좁게 막는다.

-- 1) 허용 주소 설정(hero_media_url_prefix)은 브라우저 역할(anon·authenticated)이 직접 쓰지 못한다.
--    서버(service_role)·SQL 에디터·SECURITY DEFINER 함수(실행 주체=소유자)는 그대로 가능.
--    SECURITY INVOKER 여야 current_user 가 호출 주체로 보인다(#766 cms_role 가드와 같은 방식).
CREATE OR REPLACE FUNCTION public.cms_settings_hero_prefix_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_key text := CASE WHEN TG_OP = 'DELETE' THEN OLD.key ELSE NEW.key END;
BEGIN
  IF v_key = 'hero_media_url_prefix' AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'HERO_MEDIA_PREFIX_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_cms_settings_hero_prefix_guard ON public.cms_settings;
CREATE TRIGGER trg_cms_settings_hero_prefix_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cms_settings
  FOR EACH ROW EXECUTE FUNCTION public.cms_settings_hero_prefix_guard();

-- 2) 배너 주소 가드: ① HTML·MP4 주소는 매니저 이상(manager·superadmin)만 쓸 수 있다(로그인 사용자 기준 —
--    auth.uid() 가 없는 서버·SQL 은 통과) ② 접두사 뒤 경로의 인코딩 우회(%2e·%25·%5c·역슬래시)도 거절한다.
CREATE OR REPLACE FUNCTION public.banners_media_url_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clean  text;
  v_prefix text;
  v_role   text;
BEGIN
  IF NEW.image_url IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN
    RETURN NEW;
  END IF;

  v_clean := lower(split_part(split_part(NEW.image_url, '#', 1), '?', 1));
  IF v_clean ~ '\.(html|htm|mp4)$' THEN
    IF auth.uid() IS NOT NULL THEN
      SELECT cms_role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
      IF v_role IS NULL OR v_role NOT IN ('manager', 'superadmin') THEN
        RAISE EXCEPTION 'BANNER_MEDIA_ROLE_NOT_ALLOWED';
      END IF;
    END IF;

    SELECT value #>> '{}' INTO v_prefix FROM public.cms_settings WHERE key = 'hero_media_url_prefix';
    IF v_prefix IS NULL OR v_prefix = ''
       OR left(NEW.image_url, length(v_prefix)) <> v_prefix
       OR position('..' IN NEW.image_url) > 0
       OR lower(NEW.image_url) ~ '(%2e|%25|%5c|\\)' THEN
      RAISE EXCEPTION 'BANNER_MEDIA_URL_NOT_ALLOWED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.banners_media_url_guard() FROM PUBLIC, anon, authenticated;
