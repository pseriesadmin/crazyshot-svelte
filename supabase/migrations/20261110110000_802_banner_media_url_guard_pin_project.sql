-- #802 배너 HTML·MP4 주소 제한 강화 — "아무 Supabase 프로젝트"가 아니라 "이 프로젝트의 home-hero-media 주소"만 허용
-- 롤백: #801 의 함수 정의로 되돌린다(CREATE OR REPLACE FUNCTION public.banners_media_url_guard() — 20261110100000_801 참고).
--
-- #801 은 https://<아무프로젝트>.supabase.co/storage/v1/object/public/home-hero-media/ 를 모두 허용해,
-- 다른 사람이 자기 프로젝트에 같은 이름의 저장소를 만들면 외부 HTML 을 배너로 넣을 수 있었다.
-- 허용 주소(접두사)는 환경마다 다르므로(Stage·Production 프로젝트 주소가 다름) 파일에 박지 않고
-- cms_settings 키 'hero_media_url_prefix'(값 = 문자열, 예: https://<project-ref>.supabase.co/storage/v1/object/public/home-hero-media/)
-- 에 환경별로 한 번 넣는다. 이 키는 화면용 공개 읽기 키 목록에 없어 방문자에게 노출되지 않는다.
-- 설정이 없으면 HTML·MP4 주소는 거절한다(fail-closed). 이미지 주소는 기존처럼 제한하지 않는다.
-- SECURITY DEFINER: 어떤 역할이 배너를 써도 설정 값을 읽을 수 있게 한다(search_path 고정).
CREATE OR REPLACE FUNCTION public.banners_media_url_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_clean  text;
  v_prefix text;
BEGIN
  IF NEW.image_url IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN
    RETURN NEW;
  END IF;

  v_clean := lower(split_part(split_part(NEW.image_url, '#', 1), '?', 1));
  IF v_clean ~ '\.(html|htm|mp4)$' THEN
    SELECT value #>> '{}' INTO v_prefix FROM public.cms_settings WHERE key = 'hero_media_url_prefix';
    IF v_prefix IS NULL OR v_prefix = ''
       OR left(NEW.image_url, length(v_prefix)) <> v_prefix
       OR position('..' IN NEW.image_url) > 0 THEN
      RAISE EXCEPTION 'BANNER_MEDIA_URL_NOT_ALLOWED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.banners_media_url_guard() FROM PUBLIC, anon, authenticated;
