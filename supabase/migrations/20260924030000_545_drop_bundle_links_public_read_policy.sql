-- Migration #545: product_bundle_links 공개 읽기 정책 제거
-- RLS 활성화 + 정책 없음 구조를 유지해 RPC(service_role 전용) 경유만 허용
-- get_product_bundle_links RPC(SECURITY DEFINER)가 유일한 공개 접근 경로

DROP POLICY IF EXISTS "public_read_bundle_links" ON product_bundle_links;
