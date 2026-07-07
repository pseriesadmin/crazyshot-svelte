-- Migration #75: product-images 버킷 MIME 타입 확장
-- 목적: 모바일 카메라 촬영 라벨 이미지(JPEG/PNG)도 업로드 허용
--       기존: image/webp 전용 → 변경: webp + jpeg + png
-- 배경: OCR 스캐너가 카메라 캡처 후 File로 넘기는 포맷이 image/jpeg

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/jpg', 'image/png']
WHERE id = 'product-images';
