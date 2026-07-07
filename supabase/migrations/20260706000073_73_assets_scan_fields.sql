-- Migration #73: assets 스캔 정보 필드 추가
-- 목적: OCR 스캔 라벨 이미지(label_image_url) + OCR 원본 텍스트(ocr_raw_text) DB 저장

-- 1. 컬럼 추가
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS label_image_url text,
  ADD COLUMN IF NOT EXISTS ocr_raw_text text;

-- 2. RPC 업데이트 (label_image_url, ocr_raw_text 파라미터 추가)
CREATE OR REPLACE FUNCTION public.update_asset_device_code(
  p_asset_id uuid,
  p_asset_code text DEFAULT NULL,
  p_serial_number text DEFAULT NULL,
  p_label_image_url text DEFAULT NULL,
  p_ocr_raw_text text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE assets
    SET asset_code = COALESCE(p_asset_code, asset_code),
        serial_number = COALESCE(p_serial_number, serial_number),
        label_image_url = COALESCE(p_label_image_url, label_image_url),
        ocr_raw_text = COALESCE(p_ocr_raw_text, ocr_raw_text),
        updated_at = now()
    WHERE id = p_asset_id AND deleted_at IS NULL;
END;
$$;
