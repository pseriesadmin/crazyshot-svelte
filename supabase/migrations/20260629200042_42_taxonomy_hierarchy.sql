-- ★ MIGRATION: 42_taxonomy_hierarchy.sql
-- Description: 상품 분류체계 계층화 (무한 depth), 카메라 렌탈 업계 표준 시드
-- Dependencies: 41_product_category_codes.sql

-- ─── 1. product_category_codes 계층 컬럼 추가 ─────────────────────────────
ALTER TABLE product_category_codes
  ADD COLUMN IF NOT EXISTS parent_id    UUID REFERENCES product_category_codes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS depth        INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS path_codes   TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS code_rule    JSONB;  -- 브랜치별 코드 생성 규칙 오버라이드

CREATE INDEX IF NOT EXISTS idx_pcc_parent ON product_category_codes(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pcc_depth  ON product_category_codes(depth)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pcc_path   ON product_category_codes USING GIN(path_codes);

-- ─── 2. 기존 시드 초기화 (계층 재설계) ────────────────────────────────────
DELETE FROM product_category_codes;

-- ─── 3. 상품-분류코드 자동 매핑 테이블 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS category_taxonomy_map (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_category TEXT   NOT NULL,
  taxonomy_code_id UUID   NOT NULL REFERENCES product_category_codes(id) ON DELETE CASCADE,
  priority         INT    NOT NULL DEFAULT 0,
  is_auto          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_category, taxonomy_code_id)
);

ALTER TABLE category_taxonomy_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "category_taxonomy_map: cms only"
  ON category_taxonomy_map FOR ALL
  USING (is_cms_user());

-- ─── 4. 업계 표준 대분류 시드 (depth=0) ──────────────────────────────────
-- 카메라 렌탈 업계 글로벌 표준 (RentMan / EZRentOut / Current RMS 기준)
INSERT INTO product_category_codes
  (code, name, product_category, is_active, sort_order, depth, path_codes)
VALUES
  ('CAM',  '카메라 & 영상기기',   'camera',    true,  1, 0, ARRAY['CAM']),
  ('OPT',  '렌즈 & 광학기기',     'lens',      true,  2, 0, ARRAY['OPT']),
  ('LGT',  '조명기기',             'lighting',  true,  3, 0, ARRAY['LGT']),
  ('AUD',  '오디오기기',            'audio',     true,  4, 0, ARRAY['AUD']),
  ('SPT',  '지지대 & 리깅',        null,        true,  5, 0, ARRAY['SPT']),
  ('MON',  '모니터 & 디스플레이',  null,        true,  6, 0, ARRAY['MON']),
  ('PWR',  '전원 & 배터리',        null,        true,  7, 0, ARRAY['PWR']),
  ('MED',  '미디어 & 스토리지',    null,        true,  8, 0, ARRAY['MED']),
  ('STD',  '스튜디오 장비',        null,        true,  9, 0, ARRAY['STD']),
  ('VID',  '영상 송출기기',        null,        true, 10, 0, ARRAY['VID']),
  ('ACC',  '악세서리',             'accessory', true, 11, 0, ARRAY['ACC']),
  ('PKG',  '패키지 & 번들',        'package',   true, 12, 0, ARRAY['PKG']);

-- ─── 5. 소분류 시드 (depth=1) ────────────────────────────────────────────
-- CAM 하위
INSERT INTO product_category_codes (code, name, parent_id, is_active, sort_order, depth, path_codes)
SELECT c.code, c.name,
       (SELECT id FROM product_category_codes WHERE code = c.parent_code),
       true, c.so, 1, ARRAY[c.parent_code, c.code]
FROM (VALUES
  ('CAM-ML',   '미러리스 카메라',     'CAM', 1),
  ('CAM-DSLR', 'DSLR 카메라',         'CAM', 2),
  ('CAM-CIN',  '시네마 카메라',        'CAM', 3),
  ('CAM-VDO',  '방송 / ENG 카메라',   'CAM', 4),
  ('CAM-ACT',  '액션 카메라',          'CAM', 5),
  ('CAM-DRN',  '드론',                 'CAM', 6),
  ('CAM-360',  '360도 카메라',         'CAM', 7),
  -- OPT 하위
  ('OPT-PRM',  '단렌즈 (Prime)',       'OPT', 1),
  ('OPT-ZM',   '줌렌즈',              'OPT', 2),
  ('OPT-CIN',  '시네 렌즈',           'OPT', 3),
  ('OPT-ANM',  '아나모픽 렌즈',       'OPT', 4),
  ('OPT-MCR',  '접사 / 매크로 렌즈',  'OPT', 5),
  ('OPT-FE',   '어안렌즈',             'OPT', 6),
  ('OPT-EXT',  '익스텐더 / 컨버터',   'OPT', 7),
  -- LGT 하위
  ('LGT-LED',  'LED 조명',             'LGT', 1),
  ('LGT-STR',  '스트로브 / 플래시',   'LGT', 2),
  ('LGT-TNG',  '텅스텐 조명',          'LGT', 3),
  ('LGT-HMI',  'HMI 조명',             'LGT', 4),
  ('LGT-RGB',  'RGB 컬러 조명',        'LGT', 5),
  ('LGT-BIO',  '바이오닉 / 형광등',   'LGT', 6),
  ('LGT-ACC',  '조명 악세서리',        'LGT', 7),
  -- AUD 하위
  ('AUD-MIC',  '마이크',               'AUD', 1),
  ('AUD-WLS',  '무선 오디오 시스템',   'AUD', 2),
  ('AUD-REC',  '레코더',               'AUD', 3),
  ('AUD-MON',  '헤드폰 / 모니터',     'AUD', 4),
  ('AUD-MIX',  '믹서 / 인터페이스',   'AUD', 5),
  ('AUD-SPK',  '스피커',               'AUD', 6),
  -- SPT 하위
  ('SPT-TRP',  '삼각대',               'SPT', 1),
  ('SPT-GBL',  '짐벌 / 스태빌라이저', 'SPT', 2),
  ('SPT-SLD',  '슬라이더 / 돌리',     'SPT', 3),
  ('SPT-RIG',  '카메라 리그',          'SPT', 4),
  ('SPT-JIB',  '지브 / 크레인',       'SPT', 5),
  ('SPT-MON',  '모니터 암 / 스탠드',  'SPT', 6),
  ('SPT-FLD',  '필드 스탠드',          'SPT', 7),
  -- MON 하위
  ('MON-FLD',  '필드 모니터',          'MON', 1),
  ('MON-DIR',  '디렉터 모니터',        'MON', 2),
  ('MON-PRJ',  '프로젝터',             'MON', 3),
  ('MON-SCR',  '스크린',               'MON', 4),
  -- PWR 하위
  ('PWR-BAT',  '배터리 팩',            'PWR', 1),
  ('PWR-CHG',  '충전기 / 어댑터',     'PWR', 2),
  ('PWR-GEN',  '발전기',               'PWR', 3),
  ('PWR-DIS',  '배전반 / 분배기',     'PWR', 4),
  ('PWR-UPS',  'UPS / 무정전전원',    'PWR', 5),
  -- MED 하위
  ('MED-SD',   'SD / SDXC 카드',      'MED', 1),
  ('MED-CF',   'CF / CFexpress 카드', 'MED', 2),
  ('MED-SSD',  'SSD / HDD',            'MED', 3),
  ('MED-RDR',  '카드 리더기',          'MED', 4),
  ('MED-RAW',  'RAW 레코더',           'MED', 5),
  -- STD 하위
  ('STD-BG',   '배경지 / 크로마키',   'STD', 1),
  ('STD-RFL',  '리플렉터',             'STD', 2),
  ('STD-DIF',  '디퓨저 / 소프트박스', 'STD', 3),
  ('STD-FRM',  '프레임 / 스탠드',     'STD', 4),
  ('STD-TBL',  '테이블 / 클램프',     'STD', 5),
  -- VID 하위
  ('VID-SDI',  'SDI 장비 / 분배기',   'VID', 1),
  ('VID-HDMI', 'HDMI 장비',            'VID', 2),
  ('VID-WLS',  '무선 영상 송출',       'VID', 3),
  ('VID-CVT',  '변환기 / 컨버터',     'VID', 4),
  ('VID-REC',  '영상 레코더 / 캡처',  'VID', 5),
  -- ACC 하위
  ('ACC-FLT',  '필터',                 'ACC', 1),
  ('ACC-MNT',  '마운트 / 어댑터',     'ACC', 2),
  ('ACC-CBL',  '케이블 / 커넥터',     'ACC', 3),
  ('ACC-BAG',  '가방 / 케이스',       'ACC', 4),
  ('ACC-CLN',  '클리닝 용품',          'ACC', 5),
  ('ACC-FLD',  '현장 소모품',          'ACC', 6),
  -- PKG 하위
  ('PKG-BAS',  '기본 패키지',          'PKG', 1),
  ('PKG-PRO',  '프로 패키지',          'PKG', 2),
  ('PKG-CIN',  '시네마 패키지',        'PKG', 3),
  ('PKG-EVT',  '이벤트 패키지',        'PKG', 4)
) AS c(code, name, parent_code, so);

-- ─── 6. 상품 카테고리 자동 매핑 기본 시드 ───────────────────────────────
INSERT INTO category_taxonomy_map (product_category, taxonomy_code_id, priority, is_auto)
SELECT pc, id, 1, true
FROM product_category_codes,
     (VALUES
       ('camera',    'CAM'),
       ('lens',      'OPT'),
       ('lighting',  'LGT'),
       ('audio',     'AUD'),
       ('accessory', 'ACC'),
       ('package',   'PKG')
     ) AS m(pc, root_code)
WHERE product_category_codes.code = m.root_code
  AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ─── 7. 예약코드 형식 설정 업데이트 ──────────────────────────────────────
INSERT INTO cms_settings (key, value, updated_at) VALUES
  ('reservation_code_format', '{
    "prefix": "CS",
    "date_format": "YYMM",
    "seq_digits": 3,
    "reset_monthly": true,
    "suffix": "",
    "preview": "CS-CAM-ML-2607-001"
  }', NOW())
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW();
