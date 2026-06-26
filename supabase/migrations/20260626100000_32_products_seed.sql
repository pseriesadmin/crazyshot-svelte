-- ★ MIGRATION: 32_products_seed.sql
-- crazyshot-stage products 컬럼 (2026-06-26 확인):
--   id, code, name, category, description,
--   base_price_daily, base_price_weekly, base_price_monthly,
--   status, created_at, updated_at
--
-- ═══════════════════════════════════════════════════════════
-- Supabase SQL Editor에 붙여넣을 구간: 아래 「▶ RUN」부터 「◀ END」까지
-- (주석·A블록·컬럼확인 쿼리는 붙이지 마세요)
-- ═══════════════════════════════════════════════════════════

-- ▶ RUN — 여기부터 복사 ─────────────────────────────────
INSERT INTO products (
  id, code, name, category, description,
  base_price_daily, base_price_weekly, base_price_monthly,
  status
)
VALUES
  (9,  'CANON-R5',      'Canon EOS R5',        'camera',    '4500만 화소 풀프레임 미러리스', 85000,  510000,  1700000, 'active'),
  (10, 'SONY-FX6',      'Sony FX6',            'camera',    '시네마 라인 4K 캠코더',         120000, 720000,  2400000, 'active'),
  (11, 'SONY-2470GM2',  'Sony FE 24-70mm GM2', 'lens',      '표준 줌 G Master',              45000,  270000,  900000,  'active'),
  (12, 'GODOX-AD600',   'Godox AD600',         'lighting',  '600W 스튜디오 플래시',          35000,  210000,  700000,  'active'),
  (13, 'RODE-NTG5',     'Rode NTG5',           'audio',     '슈퍼카디oid 샷건 마이크',       15000,  90000,   300000,  'active'),
  (14, 'DJI-RS4PRO',    'DJI RS4 Pro',         'accessory', '3축 짐벌',                      40000,  240000,  800000,  'active'),
  (15, 'MANFROTTO-055', 'Manfrotto 055',       'accessory', '카본 삼각대',                   20000,  120000,  400000,  'active'),
  (16, 'SONY-A7S3',     'Sony A7S III',        'camera',    '低照度 풀프레임',               75000,  450000,  1500000, 'active')
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  base_price_daily = EXCLUDED.base_price_daily,
  base_price_weekly = EXCLUDED.base_price_weekly,
  base_price_monthly = EXCLUDED.base_price_monthly,
  status = EXCLUDED.status,
  updated_at = NOW();

DO $$
BEGIN
  PERFORM setval(
    pg_get_serial_sequence('public.products', 'id'),
    (SELECT COALESCE(MAX(id), 1) FROM products),
    true
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
-- ◀ END — 여기까지 복사 ─────────────────────────────────

-- ── A. v5.46 시드 (slug·UUID) — crazyshot-stage에서는 실행 금지 ──
/*
INSERT INTO products (id, category, name, slug, ...) VALUES (...);
*/
