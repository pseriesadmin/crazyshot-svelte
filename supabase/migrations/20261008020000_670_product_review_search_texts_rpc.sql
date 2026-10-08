-- Migration #670: NLSearch 상품 후기 색인용 묶음 RPC (L-1)
-- 목적: 상품 검색 인덱스(productSearchIndex.ts) 빌드 시, 상품별 "공개 후기" 텍스트를 한 번에 가져온다.
--   · 공개(is_public=true) 후기만, 삭제·비공개 후기는 즉시 제외 (인덱스 TTL 60초 안에 반영)
--   · 자식(재고) 상품에 달린 후기는 부모로 합친다. 대상 부모 = 검색 인덱스와 동일 조건
--     (parent_product_id IS NULL, is_active=true, option_only=false, deleted_at IS NULL)
--   · 상품별 최신 p_per_product개(기본 20), 합쳐서 p_max_chars자(기본 2000)까지만
--   · ⛔ 작성자 정보(user_id·author_name)는 조회·반환하지 않는다 — 제목+본문 텍스트만
--   · 서버 전용(service_role): 이 프로젝트 public 스키마는 ALTER DEFAULT PRIVILEGES로 신규 함수에
--     anon·authenticated EXECUTE를 자동 부여하므로(Migration 251b/357 사고) FROM PUBLIC만으로는 부족 → 명시 REVOKE
-- 2026-10-08

CREATE OR REPLACE FUNCTION public.get_product_review_search_texts(
  p_per_product INT DEFAULT 20,
  p_max_chars   INT DEFAULT 2000
)
RETURNS TABLE (
  product_id   UUID,
  review_count INT,
  review_text  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eff AS (
    -- 후기가 달린 상품(자식이면 부모)으로 환산
    SELECT r.id,
           COALESCE(c.parent_product_id, c.id) AS pid,
           r.title,
           r.content,
           r.created_at
    FROM public.product_reviews r
    JOIN public.products c ON c.id = r.product_id
    WHERE r.is_public = true
      AND c.deleted_at IS NULL
  ),
  ranked AS (
    SELECT e.id, e.pid, e.title, e.content, e.created_at,
           row_number() OVER (PARTITION BY e.pid ORDER BY e.created_at DESC, e.id) AS rn
    FROM eff e
    JOIN public.products p ON p.id = e.pid
    WHERE p.parent_product_id IS NULL
      AND p.deleted_at IS NULL
      AND p.is_active = true
      AND p.option_only = false
  )
  SELECT ranked.pid AS product_id,
         count(*)::INT AS review_count,
         left(
           string_agg(ranked.title || ' ' || ranked.content, ' ' ORDER BY ranked.created_at DESC, ranked.id),
           GREATEST(p_max_chars, 1)
         ) AS review_text
  FROM ranked
  WHERE ranked.rn <= GREATEST(p_per_product, 1)
  GROUP BY ranked.pid
$$;

REVOKE ALL ON FUNCTION public.get_product_review_search_texts(INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_review_search_texts(INT, INT)
  TO service_role;

COMMENT ON FUNCTION public.get_product_review_search_texts(INT, INT) IS
  'NLSearch 후기 색인용: 상품별 최신 공개 후기 텍스트(제목+본문)만 반환. 작성자 정보 없음. service_role 전용.';

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.get_product_review_search_texts(INT, INT);
-- ============================================================
