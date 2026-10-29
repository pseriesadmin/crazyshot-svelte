-- #781 상품설명서(PDF) — 상품에 PDF 여러 개 등록 + 고객 상품상세 공개
-- 롤백: ALTER TABLE public.products DROP CONSTRAINT products_manual_files_valid, DROP COLUMN manual_files;
--       DELETE FROM storage.buckets WHERE id='product-manuals'(빈 버킷일 때).
--
-- 1) products.manual_files — [{path, name, size, uploaded_at}] 배열. 대표(부모) 상품만 쓴다(재고 단위 상품은 항상 빈 배열).
--    파일은 공개 버킷 product-manuals 의 {상품id}/{uuid}.pdf (등록 화면에서 올린 파일은 temp/{임시id}/ 에 있다가 등록 직후 상품 폴더로 이관, 실패 시 temp 경로 유지).
--    기존 행은 전부 '[]' — 기존 동작에 영향 없음. 개수 상한 10(앱·서버 검증과 같은 값, 직접 쓰기 방어선).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS manual_files jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_manual_files_valid' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_manual_files_valid
      CHECK (jsonb_typeof(manual_files) = 'array' AND jsonb_array_length(manual_files) <= 10);
  END IF;
END $$;

COMMENT ON COLUMN public.products.manual_files IS
  '상품설명서(PDF) 목록 [{path,name,size,uploaded_at}] — 버킷 product-manuals 경로, 최대 10개. 고객 상품상세에 공개.';

-- 2) 공개 버킷 — 고객 상품상세에서 누구나 열람하므로 공개(상품 이미지 버킷과 같은 방식).
--    PDF만, 파일당 10MB. storage.objects 정책은 만들지 않는다 — 올리기는 서버가 발급한 서명 URL(서비스 롤)로만,
--    읽기는 공개 버킷 주소로 한다(익명 직접 업로드 불가).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-manuals', 'product-manuals', true, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
