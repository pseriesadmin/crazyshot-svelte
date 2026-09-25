-- Migration #544: product_bundle_links — 결합상품 연결 테이블 + RPC 2종
-- Phase 1 (1단계): Stage(ezyvffjvuwmtuhpxdjrw) 검증 전용
-- 적용 순서: crazyshot-stage → crazyshot (Production은 Phase 2와 함께 적용)

-- ─── 테이블 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_bundle_links (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  bundle_product_id UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  display_order     SMALLINT    NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  UNIQUE(product_id, bundle_product_id),
  CHECK(product_id <> bundle_product_id)
);

-- ─── RLS ──────────────────────────────────────────────────
ALTER TABLE product_bundle_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_bundle_links" ON product_bundle_links
  FOR SELECT USING (deleted_at IS NULL);

-- ─── updated_at 트리거 ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_product_bundle_links_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_product_bundle_links_updated_at
  BEFORE UPDATE ON product_bundle_links
  FOR EACH ROW EXECUTE FUNCTION update_product_bundle_links_updated_at();

-- ─── RPC 1: upsert_product_bundle_links (service_role 전용) ───
-- p_bundle_links: [{bundle_product_id, display_order}]
-- 검증: 자기자신·자식상품·삭제상품·패키지중첩(양방향)·옵션상품중복
-- 전체교체(하드딜리트+UPSERT) — Migration 162 교훈 적용
CREATE OR REPLACE FUNCTION upsert_product_bundle_links(
  p_product_id   UUID,
  p_bundle_links JSONB
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_ids UUID[];
BEGIN
  -- 신규 목록의 bundle_product_id 배열 추출
  SELECT ARRAY(
    SELECT (el->>'bundle_product_id')::UUID
    FROM jsonb_array_elements(p_bundle_links) AS el
    WHERE el->>'bundle_product_id' IS NOT NULL
  ) INTO new_ids;

  -- 검증 1: 자기 자신 참조 금지
  IF p_product_id = ANY(new_ids) THEN
    RAISE EXCEPTION 'BUNDLE_SELF_REF';
  END IF;

  -- 검증 2: 자식(재고) 상품 등록 금지
  IF EXISTS (
    SELECT 1 FROM products
    WHERE id = ANY(new_ids)
      AND parent_product_id IS NOT NULL
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_CHILD_PRODUCT';
  END IF;

  -- 검증 3: 삭제된 상품 등록 금지
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM products
    WHERE id = ANY(new_ids)
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_DELETED_PRODUCT';
  END IF;

  -- 검증 4: 패키지 중첩 — 추가하려는 결합상품이 자체 결합목록을 가진 경우
  --         (bundle_product_id 자신이 이미 패키지인 경우)
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM product_bundle_links
    WHERE product_id = ANY(new_ids)
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_NESTING_FORBIDDEN';
  END IF;

  -- 검증 5: 패키지 중첩 — 이 상품(p_product_id)이 다른 패키지의 결합상품인 경우
  --         (결합목록을 비우는 저장(빈 배열)은 중첩을 만들지 않으므로 허용)
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM product_bundle_links
    WHERE bundle_product_id = p_product_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_IS_NESTED';
  END IF;

  -- 검증 6: 같은 상품의 옵션상품과 중복 금지
  IF CARDINALITY(new_ids) > 0 AND EXISTS (
    SELECT 1 FROM product_option_links
    WHERE product_id = p_product_id
      AND option_product_id = ANY(new_ids)
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'BUNDLE_OPTION_OVERLAP';
  END IF;

  -- 신규 목록에 없는 기존 행 하드딜리트 (soft-deleted 포함 전체 정리 — Migration 162 패턴)
  DELETE FROM product_bundle_links
  WHERE product_id = p_product_id
    AND (CARDINALITY(new_ids) = 0 OR bundle_product_id <> ALL(new_ids));

  -- 신규/변경 항목 UPSERT (ON CONFLICT: 기존 행 값 갱신)
  IF CARDINALITY(new_ids) > 0 THEN
    INSERT INTO product_bundle_links (product_id, bundle_product_id, display_order)
    SELECT
      p_product_id,
      (el->>'bundle_product_id')::UUID,
      COALESCE((el->>'display_order')::SMALLINT, 0)
    FROM jsonb_array_elements(p_bundle_links) AS el
    WHERE el->>'bundle_product_id' IS NOT NULL
    ON CONFLICT (product_id, bundle_product_id) DO UPDATE SET
      deleted_at    = NULL,
      display_order = EXCLUDED.display_order,
      updated_at    = NOW();
  END IF;
END;
$$;

-- upsert는 CMS 서버(+page.server.ts, service_role 키) 전용
-- Supabase 기본 권한이 public 스키마 신규 함수에 anon·authenticated EXECUTE를 개별 부여하므로
-- PUBLIC만 회수하면 무효(Migration 262 주석 참고) — 반드시 anon·authenticated도 명시 회수.
REVOKE ALL ON FUNCTION upsert_product_bundle_links(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_product_bundle_links(UUID, JSONB) TO service_role;

-- ─── RPC 2: get_product_bundle_links (anon + authenticated) ──
-- 고객 상품 상세 및 CMS 패널 공용 조회
-- 반환: link_id, bundle_product_id, bundle_name, components, display_order, image_url
CREATE OR REPLACE FUNCTION get_product_bundle_links(p_product_id UUID)
RETURNS TABLE(
  link_id           UUID,
  bundle_product_id UUID,
  bundle_name       TEXT,
  components        JSONB,
  display_order     SMALLINT,
  image_url         TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    pbl.id                AS link_id,
    pbl.bundle_product_id,
    p.name                AS bundle_name,
    p.components,
    pbl.display_order,
    p.image_urls->>0        AS image_url  -- image_urls는 JSONB(첫 이미지)
  FROM product_bundle_links pbl
  JOIN products p ON p.id = pbl.bundle_product_id AND p.deleted_at IS NULL
  WHERE pbl.product_id = p_product_id
    AND pbl.deleted_at IS NULL
  ORDER BY pbl.display_order ASC;
$$;

REVOKE ALL ON FUNCTION get_product_bundle_links(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_product_bundle_links(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_product_bundle_links(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_product_bundle_links(UUID) TO service_role;
