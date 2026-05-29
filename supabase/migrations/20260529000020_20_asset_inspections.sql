-- ★ MIGRATION: 20_asset_inspections.sql
-- Schema version: v5.46
-- Description: M5 Inspection — pre/post rental asset damage detection with Vision AI
-- Dependencies: 05_assets.sql, 10_rental_reservations.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- Claude Vision Agent 연동:
--   - 신뢰도 ≥ 0.85 → 손상 확정 (damage_detected = true)
--   - ai_analysis JSONB: Claude API 원문 응답 보관
--   - 분쟁(disputed): 사용자-관리자 양측 이의 시 manual 처리

CREATE TABLE IF NOT EXISTS asset_inspections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  reservation_id          UUID NOT NULL REFERENCES rental_reservations(id) ON DELETE RESTRICT,
  inspection_type         inspection_type_enum NOT NULL,
  inspector_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  image_urls              TEXT[] NOT NULL DEFAULT '{}',
  damage_detected         BOOLEAN NOT NULL DEFAULT false,
  damage_confidence_score NUMERIC(4,3) DEFAULT 0 CHECK(damage_confidence_score BETWEEN 0 AND 1),
  damage_description      TEXT,
  ai_analysis             JSONB,    -- Claude Vision API 분석 결과 원문
  status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending', 'completed', 'disputed')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_asset_inspections_asset_id       ON asset_inspections(asset_id);
CREATE INDEX idx_asset_inspections_reservation_id ON asset_inspections(reservation_id);
CREATE INDEX idx_asset_inspections_type           ON asset_inspections(inspection_type);

ALTER TABLE asset_inspections ENABLE ROW LEVEL SECURITY;

-- 본인 예약 관련 검수 내역 조회
CREATE POLICY "asset_inspections: 본인 조회" ON asset_inspections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM rental_reservations rr
      WHERE rr.id = asset_inspections.reservation_id
        AND rr.user_id = auth.uid()
    )
  );

CREATE POLICY "asset_inspections: 관리자 전체" ON asset_inspections
  FOR ALL USING (is_admin());

CREATE TRIGGER set_asset_inspections_updated_at
  BEFORE UPDATE ON asset_inspections
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
