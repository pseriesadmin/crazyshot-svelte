-- #801 배너 HTML·MP4 주소 제한 — 우리 전용 저장소(home-hero-media) 주소만 허용
-- 롤백: DROP TRIGGER trg_banners_media_url_guard ON public.banners; DROP FUNCTION public.banners_media_url_guard();
--
-- 홈 히어로가 .html/.htm/.mp4 주소를 HTML·영상으로 재생하므로(HTML 은 방문자 브라우저에서 실행),
-- 배너 주소 칸에 외부 사이트 주소를 직접 넣어 업로드 제한을 우회하지 못하게 한다.
-- 배너를 쓰는 모든 경로(cms_create_banner·cms_update_banner RPC, 서버 폼, SQL)를 한 곳에서 막기 위해 테이블 트리거로 둔다.
-- 이미지 주소는 기존대로 제한하지 않는다. 기존 행은 건드리지 않고(이후 INSERT·image_url 변경 시에만 검사) 새 값만 본다.
CREATE OR REPLACE FUNCTION public.banners_media_url_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_clean text;
BEGIN
  IF NEW.image_url IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN
    RETURN NEW;
  END IF;

  v_clean := lower(split_part(split_part(NEW.image_url, '#', 1), '?', 1));
  IF v_clean ~ '\.(html|htm|mp4)$'
     AND NEW.image_url !~* '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/home-hero-media/' THEN
    RAISE EXCEPTION 'BANNER_MEDIA_URL_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banners_media_url_guard ON public.banners;
CREATE TRIGGER trg_banners_media_url_guard
  BEFORE INSERT OR UPDATE OF image_url ON public.banners
  FOR EACH ROW EXECUTE FUNCTION public.banners_media_url_guard();
