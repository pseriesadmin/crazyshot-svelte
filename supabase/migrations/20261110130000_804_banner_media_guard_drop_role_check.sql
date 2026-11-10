-- #804 배너 HTML·MP4 가드 — #803 에서 넣은 "파트너 등급 거절" 제거 (Stephen 판단: 실질 효과 없는 제한)
-- 롤백: #803 의 banners_media_url_guard() 정의(20261110120000_803)로 되돌린다.
--
-- 이유: HTML·MP4 파일을 올리는 서버 경로는 이미 매니저 이상만 허용하고 저장소는 서버만 쓸 수 있어, 파트너는 새 HTML 을 만들 수 없다.
--   파트너가 할 수 있는 일은 매니저가 이미 올려 승인한 파일 주소를 배너에 연결하는 것뿐이라 위험이 새로 생기지 않는다.
--   외부 HTML 유입은 아래 세 가지가 막는다 — 허용 주소 접두사 일치(설정은 서버만 변경, #803 트리거), 인코딩 우회 거절, 홈 화면의 호스트 검사.
-- 유지: 접두사 일치 · '..'·%2e·%25·%5c·역슬래시 거절 · 설정 없으면 거절(fail-closed). 제거: 등급(auth.uid → cms_role) 검사만.
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
       OR position('..' IN NEW.image_url) > 0
       OR lower(NEW.image_url) ~ '(%2e|%25|%5c|\\)' THEN
      RAISE EXCEPTION 'BANNER_MEDIA_URL_NOT_ALLOWED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.banners_media_url_guard() FROM PUBLIC, anon, authenticated;
