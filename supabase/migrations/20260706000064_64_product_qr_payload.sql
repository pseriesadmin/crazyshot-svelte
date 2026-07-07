-- Migration 64: products 테이블에 qr_payload 컬럼 추가
-- QR 코드 엔터티 식별자 시스템 도입 (상품 → 예약 → 자산 확장 예정)
-- 2026-07-06

ALTER TABLE products ADD COLUMN IF NOT EXISTS qr_payload TEXT;

-- 기존 상품 backfill: UUID 기반 URL (슬러그 변경 시에도 QR 불변)
UPDATE products
  SET qr_payload = 'https://crazyshot.kr/qr/product/' || id::text
  WHERE qr_payload IS NULL AND deleted_at IS NULL;

-- 인덱스 불필요 (읽기 전용, 등록 시 1회 생성)

COMMENT ON COLUMN products.qr_payload IS
  'QR 코드에 인코딩되는 URL. 형식: https://crazyshot.kr/qr/product/{uuid}. 스캔 시 CMS 상세 패널로 redirect됨. 향후 rental_reservations, assets 테이블에도 동일 패턴 적용 예정.';
