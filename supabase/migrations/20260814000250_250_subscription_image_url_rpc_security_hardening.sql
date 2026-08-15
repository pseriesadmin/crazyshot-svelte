-- Migration 250: append_subscription_image_url RPC 보안 강화
--
-- Supabase 보안 어드바이저(get_advisors)가 Migration 249 적용 직후 아래 2건을 CRITICAL로 지적:
--   1) mutable search_path — SECURITY DEFINER 함수에 search_path 미고정(스키마 인젝션 위험)
--   2) anon_security_definer_function_executable / authenticated_...
--      — Postgres는 신규 함수 생성 시 기본적으로 PUBLIC(anon·authenticated 포함)에게 EXECUTE를
--        부여한다. GRANT ... TO service_role만 추가하고 기존 PUBLIC 권한을 REVOKE하지 않으면,
--        누구든 /rest/v1/rpc/append_subscription_image_url을 직접 호출해 CMS 인증 없이 임의
--        구독 플랜의 image_urls에 URL을 주입할 수 있는 상태였다(SECURITY DEFINER라 상승권한 실행).
--
-- 동일 패턴이 append_product_image_url(기존, products 모듈)에도 존재함을 확인했으나, 그 함수는
-- 이번 세션 작업 범위 밖(다른 모듈)이라 이 마이그레이션에서 손대지 않는다 — Stephen에게 별도
-- 확인 후 조치.

ALTER FUNCTION public.append_subscription_image_url(BIGINT, TEXT) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.append_subscription_image_url(BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.append_subscription_image_url(BIGINT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.append_subscription_image_url(BIGINT, TEXT) FROM authenticated;
-- service_role EXECUTE 권한은 Migration 249에서 이미 GRANT됨 — 유지.
