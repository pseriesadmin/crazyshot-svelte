-- #800 홈 히어로 배너 — 키네틱 모션 HTML · MP4 영상 등록용 공개 버킷
-- 롤백: DELETE FROM storage.buckets WHERE id='home-hero-media' (빈 버킷일 때).
--
-- 기존 상품 이미지 버킷(product-images)은 이미지 형식만 받도록 막혀 있어 HTML·MP4를 올릴 수 없다.
-- 이미지 배너는 그대로 product-images를 쓰고, HTML·MP4 배너만 이 버킷에 둔다.
-- 공개 버킷(고객 홈에서 누구나 재생) · 파일당 10MB. storage.objects 정책은 만들지 않는다 —
-- 올리기는 서버(/api/cms/home/hero-banner, CMS 직원 확인 후 서비스 롤)로만, 읽기는 공개 주소로 한다.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('home-hero-media', 'home-hero-media', true, 10485760, ARRAY['text/html', 'video/mp4'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
