-- ★ MIGRATION: 10_rental_reservations.sql
-- Schema version: v5.46
-- Description: M2 Reservations — core reservation lifecycle management
-- Dependencies: 05_assets.sql, 08_pickup_points.sql, 02_enums.sql
-- Author: Stephen Cconzy
-- Date: 2026-05-29
--
-- §13 Business rules enforced here:
--   - Hold expiration: 10분 후 자동 만료 (pg_cron scheduled)
--   - EXCLUDE gist: 동일 자산 기간 중복 예방
--   - status 전환은 RPC를 통해서만 수행

CREATE TABLE IF NOT EXISTS rental_reservations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  asset_id              UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  order_id              UUID,          -- FK orders.id (결제 완료 후 연결)
  status                reservation_status_enum NOT NULL DEFAULT 'hold',
  rental_start_date     DATE NOT NULL,
  rental_end_date       DATE NOT NULL CHECK(rental_end_date >= rental_start_date),
  actual_pickup_date    DATE,
  actual_return_date    DATE,
  pickup_method         shipment_method_enum NOT NULL,
  return_method         shipment_method_enum NOT NULL,
  pickup_point_id       UUID REFERENCES pickup_points(id) ON DELETE SET NULL,
  return_point_id       UUID REFERENCES pickup_points(id) ON DELETE SET NULL,
  hold_expiration_at    TIMESTAMPTZ,  -- hold 상태일 때 10분 만료시간
  damage_reported       BOOLEAN NOT NULL DEFAULT false,
  damage_notes          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  -- ★ 핵심 제약: 동일 자산의 날짜 중복 예약 방지 (EXCLUDE using btree_gist)
  CONSTRAINT rental_reservations_no_overlap
    EXCLUDE USING gist (
      asset_id WITH =,
      daterange(rental_start_date, rental_end_date, '[]') WITH &&
    ) WHERE (
      deleted_at IS NULL
      AND status NOT IN ('cancelled', 'returned')
    )
);

CREATE INDEX idx_rental_reservations_user_id  ON rental_reservations(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_rental_reservations_asset_id ON rental_reservations(asset_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_rental_reservations_status   ON rental_reservations(status)   WHERE deleted_at IS NULL;
CREATE INDEX idx_rental_reservations_hold_exp ON rental_reservations(hold_expiration_at)
  WHERE status = 'hold' AND deleted_at IS NULL;

ALTER TABLE rental_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_reservations: 본인 조회" ON rental_reservations
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "rental_reservations: 본인 생성" ON rental_reservations
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "rental_reservations: 관리자 전체" ON rental_reservations
  FOR ALL USING (is_admin());

CREATE TRIGGER set_rental_reservations_updated_at
  BEFORE UPDATE ON rental_reservations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ★ pg_cron: 10분 hold 만료 자동 처리
-- (실제 cron은 이 migration 이후 별도 설정 또는 30_cron_jobs.sql에서 등록)
