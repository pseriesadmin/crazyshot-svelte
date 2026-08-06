-- Migration 191: 죽은 코드 generate_child_product_code RPC 제거 (CODE-CLEANUP-1)
--
-- 배경: migration_82에서 COUNT(*) WHERE deleted_at IS NULL 방식(위험 패턴 — 형제 재고 삭제 시
--       번호 재사용 가능)으로 정의된 함수이나, 앱 코드 어디서도 호출되지 않는 죽은 코드임.
--       실사용 경로는 generate_product_code + generate_inventory_product_code (단조증가 카운터).
--
-- 정책 근거: 품번(product_code) 영구고정 — COUNT 기반 재사용 가능 함수 코드베이스에서 완전 제거.
-- grep -r "generate_child_product_code" src/ → 0건 확인 후 DROP 진행.
--
-- 기존 마이그레이션 파일(82) 직접 수정 금지 — 이 파일로 DROP.

DROP FUNCTION IF EXISTS public.generate_child_product_code(UUID, UUID);
