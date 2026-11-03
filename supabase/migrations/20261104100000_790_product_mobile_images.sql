-- 모바일 전용 상품 이미지 (2026-11-04, Stephen 지시)
-- PC용 이미지(products.image_urls)를 모바일 상품상세 헤더 비율로 다시 만든 이미지를 따로 보관한다.
-- 형식: [{"src": PC 이미지 주소(image_urls의 값), "url": 모바일 이미지 큰 사이즈 주소, "enabled": 사용 여부}]
-- 모바일 상품상세 헤더에서 enabled=true 인 항목은 같은 src 의 PC 이미지를 대체해 보여준다.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS mobile_images jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.products.mobile_images IS
  '모바일 전용 이미지 [{src,url,enabled}] — src=PC image_urls 값, url=모바일 large 주소, enabled=모바일 헤더 대체 사용 여부';
