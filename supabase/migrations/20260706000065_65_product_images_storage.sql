-- ============================================================
-- Migration 65: product-images Storage Bucket + RLS
-- Cloudinary 제거 → Supabase Storage 자체 관리로 전환
-- 이미지 변환 API 미사용 (클라이언트 사전 리사이즈로 비용 회피)
-- ============================================================

-- 1. 버킷 생성
--    public = true: 공개 URL로 직접 서빙 (CDN 캐시 활용)
--    file_size_limit = 10MB: 업로드 전 클라이언트 리사이즈로 실질적 크기 ~300KB 이하
--    allowed_mime_types: webp 전용 (클라이언트에서 변환 후 업로드)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  10485760,
  ARRAY['image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 2. RLS 활성화 (storage.objects는 기본 활성화)

-- 3. 공개 읽기 — 누구든 상품 이미지 열람 가능
DROP POLICY IF EXISTS "product_images_public_read" ON storage.objects;
CREATE POLICY "product_images_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- 4. CMS 관리자 업로드
DROP POLICY IF EXISTS "product_images_cms_upload" ON storage.objects;
CREATE POLICY "product_images_cms_upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  )
);

-- 5. CMS 관리자 삭제 (이미지 제거 시 Storage 오브젝트도 정리)
DROP POLICY IF EXISTS "product_images_cms_delete" ON storage.objects;
CREATE POLICY "product_images_cms_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND cms_role IS NOT NULL
  )
);

-- ============================================================
-- 주의: Supabase Image Transformation API 사용 안 함
--   이유: Pro 플랜 origin image 100개 초과 시 100개당 $5 추가 과금
--   대안: 업로드 전 클라이언트(Canvas API)에서 thumb(400×300) + large(1200×900)
--         두 가지 크기를 미리 생성 후 별도 경로에 저장
--   경로 규칙:
--     thumb: {product_id}/thumb_{uuid}.webp
--     large: {product_id}/large_{uuid}.webp
--     products.image_urls에는 large URL 저장 → thumb는 /large_ → /thumb_ 치환으로 도출
-- ============================================================
