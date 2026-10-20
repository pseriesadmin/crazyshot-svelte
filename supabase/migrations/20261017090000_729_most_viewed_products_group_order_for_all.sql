-- Migration 729: get_most_viewed_products — "전체"(카테고리 미지정) 조회 시 그룹 순서 적용 (Production 기록 정렬)
--
-- 배경(2026-10-17 Stage↔Production 점검): Production에는 2026-10-14 23:02 KST(UTC 14:02)에
-- 이름 "most_viewed_products_group_order_for_all"(번호 없음)로 직접 적용된 변경이 있으나,
-- 로컬 마이그레이션 파일과 Stage에는 없었다(Migration 576의 정렬만 있었음).
-- 이 파일은 Production의 현재 함수 정의를 그대로 옮긴 것이다 — Production에서는 정의가 이미 같아
-- 재실행해도 no-op(CREATE OR REPLACE)이고, Stage에만 실제 변경이 일어난다.
--
-- 변경 내용(Migration 576 대비 ORDER BY만 다르다 — 반환 컬럼·인자·권한·본문 나머지는 동일):
--   · 카테고리 미지정(p_category IS NULL)일 때만 그룹 순서를 먼저 적용하고, 그룹 안에서는 조회수 순.
--     그룹: 카메라(일반) 1 → 렌즈 2 → 액션캠 3 → 시네마 카메라(CRCCR) 4 → 하이프팩 5 → 드론·짐벌 6
--           → 아날로그 카메라(CRANL) 7 → 조명 8 → 액세서리 9 → 폰 10 → 판매전용·상품 11 → 그 외 12
--   · 카테고리를 지정한 조회(p_category 지정)는 이전과 동일(조회수 순 → 최신 등록 순).
--
-- 영향: 홈 등 "인기 상품 전체" 목록의 순서만 바뀐다. 시그니처 불변이라 호출부(src) 수정 없음.
--
-- ROLLBACK (실행 가능 — 아래 블록의 주석 기호 `-- `를 지우고 실행하면 Migration 576 정의로 복원, ORDER BY 한 줄만 다름):
-- CREATE OR REPLACE FUNCTION public.get_most_viewed_products(p_category text DEFAULT NULL::text, p_limit integer DEFAULT 16, p_days integer DEFAULT NULL::integer)
--  RETURNS TABLE(product_id uuid, name text, slug text, category text, image_urls jsonb, base_price_daily numeric, product_caption text, is_active boolean, view_count bigint)
--  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
--   WITH views AS (
--     SELECT e.event_data->>'product_id' AS pid, count(*) AS cnt
--     FROM user_behavior_events e
--     WHERE e.event_type = 'click' AND e.event_data->>'action' = 'product_view'
--       AND e.event_data->>'product_id' IS NOT NULL
--       AND (p_days IS NULL OR e.created_at >= now() - make_interval(days => p_days))
--     GROUP BY e.event_data->>'product_id'
--   )
--   SELECT p.id, p.name, p.slug, p.category::text, to_jsonb(p.image_urls), p.base_price_daily, p.product_caption, p.is_active, coalesce(v.cnt, 0)::bigint
--   FROM products p LEFT JOIN views v ON v.pid = p.id::text
--   WHERE p.deleted_at IS NULL AND p.parent_product_id IS NULL AND p.option_only = false AND p.is_active = true
--     AND (p_category IS NULL OR p.category::text = p_category)
--   ORDER BY coalesce(v.cnt, 0) DESC, p.created_at DESC
--   LIMIT greatest(p_limit, 1);
-- $function$;


CREATE OR REPLACE FUNCTION public.get_most_viewed_products(p_category text DEFAULT NULL::text, p_limit integer DEFAULT 16, p_days integer DEFAULT NULL::integer)
 RETURNS TABLE(product_id uuid, name text, slug text, category text, image_urls jsonb, base_price_daily numeric, product_caption text, is_active boolean, view_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH views AS (
    SELECT e.event_data->>'product_id' AS pid, count(*) AS cnt
    FROM user_behavior_events e
    WHERE e.event_type = 'click'
      AND e.event_data->>'action' = 'product_view'
      AND e.event_data->>'product_id' IS NOT NULL
      AND (p_days IS NULL OR e.created_at >= now() - make_interval(days => p_days))
    GROUP BY e.event_data->>'product_id'
  )
  SELECT
    p.id,
    p.name,
    p.slug,
    p.category::text,
    to_jsonb(p.image_urls),
    p.base_price_daily,
    p.product_caption,
    p.is_active,
    coalesce(v.cnt, 0)::bigint
  FROM products p
  LEFT JOIN views v ON v.pid = p.id::text
  WHERE p.deleted_at IS NULL
    AND p.parent_product_id IS NULL
    AND p.option_only = false
    AND p.is_active = true
    AND (p_category IS NULL OR p.category::text = p_category)
  ORDER BY
    -- 전체(카테고리 미지정) 조회 시에만 그룹 순서 적용. 그룹 안에서는 조회수 순.
    CASE WHEN p_category IS NULL THEN
      CASE
        WHEN p.sale_only OR p.category::text = 'product' THEN 11
        WHEN p.category::text = 'camera' AND p.code_series->>'category_code' = 'CRCCR' THEN 4
        WHEN p.category::text = 'camera' AND p.code_series->>'category_code' = 'CRANL' THEN 7
        WHEN p.category::text = 'camera' THEN 1
        WHEN p.category::text = 'lens' THEN 2
        WHEN p.category::text = 'actcam' THEN 3
        WHEN p.category::text = 'hypepack' THEN 5
        WHEN p.category::text = 'dronegim' THEN 6
        WHEN p.category::text = 'light' THEN 8
        WHEN p.category::text = 'accessorie' THEN 9
        WHEN p.category::text = 'phone' THEN 10
        ELSE 12
      END
    ELSE 0 END,
    coalesce(v.cnt, 0) DESC,
    p.created_at DESC
  LIMIT greatest(p_limit, 1);
$function$;
