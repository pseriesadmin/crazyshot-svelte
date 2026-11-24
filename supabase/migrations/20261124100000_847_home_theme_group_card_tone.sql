-- Migration #847: 홈 취향직격 테마그룹 — 슬라이드 카드 바탕색(card_tone) 노출
--
-- 배경: 테마그룹 안 상품별로 슬라이드 카드 하단(요금·상품명) 바탕색을 '흰색 / 옅은 퍼플 / 다크'로 고를 수 있게 한다.
--       값은 home_theme_groups.product_ids(JSONB 배열) 각 항목의 선택 필드 'tone'('white'|'dark'|'lilac')으로 저장한다.
--       cms_create_theme_group / cms_update_theme_group 은 product_ids 를 그대로 저장하므로 변경하지 않는다(테이블·열 변경 없음).
--
-- 변경 내용(읽기 함수 2개만 CREATE OR REPLACE — #392 정의에 'card_tone' 한 줄만 추가):
--   1. get_home_theme_groups_with_products — 고객용(anon/authenticated)
--   2. get_home_theme_groups_admin         — 관리자 편집용
--   · card_tone = 'white'·'dark'·'lilac' 만 내보내고, 그 외 값·없음은 NULL(= 기존 다크 카드 그대로)
--
-- 호환: 새 필드를 모르는 옛 코드는 무시하면 되고, 이 마이그레이션 적용 전에는 card_tone 이 없어 기존 모습 그대로.
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)

CREATE OR REPLACE FUNCTION public.get_home_theme_groups_with_products()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         g.id,
        'title',      g.title,
        'sub_copy',   g.sub_copy,
        'image_url',  g.image_url,
        'sort_order', g.sort_order,
        'products',   COALESCE(plist.data, '[]'::jsonb)
      )
      ORDER BY g.sort_order, g.created_at
    ),
    '[]'::jsonb
  )
  FROM public.home_theme_groups g
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',               p.id,
        'name',             p.name,
        'slug',             p.slug,
        'image_urls',       COALESCE(p.image_urls, '[]'::jsonb),
        'base_price_daily', COALESCE(p.base_price_daily, 0),
        'card_tone',        CASE WHEN elem->>'tone' IN ('white', 'dark', 'lilac') THEN elem->>'tone' ELSE NULL END
      )
      ORDER BY COALESCE((elem->>'order')::integer, 0)
    ) AS data
    FROM jsonb_array_elements(COALESCE(g.product_ids, '[]'::jsonb)) AS elem
    INNER JOIN public.products p ON p.id = (elem->>'id')::uuid
    WHERE p.deleted_at IS NULL
      AND p.is_active = true
      AND p.parent_product_id IS NULL
      AND p.option_only = false
  ) plist ON true
  WHERE g.is_active = true
    AND g.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_home_theme_groups_with_products() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_home_theme_groups_admin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',         g.id,
          'title',      g.title,
          'sub_copy',   g.sub_copy,
          'image_url',  g.image_url,
          'sort_order', g.sort_order,
          'is_active',  g.is_active,
          'products',   COALESCE(plist.data, '[]'::jsonb)
        )
        ORDER BY g.sort_order, g.created_at
      ),
      '[]'::jsonb
    )
    FROM public.home_theme_groups g
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               p.id,
          'name',             p.name,
          'slug',             p.slug,
          'image_urls',       COALESCE(p.image_urls, '[]'::jsonb),
          'base_price_daily', COALESCE(p.base_price_daily, 0),
          'card_tone',        CASE WHEN elem->>'tone' IN ('white', 'dark', 'lilac') THEN elem->>'tone' ELSE NULL END
        )
        ORDER BY COALESCE((elem->>'order')::integer, 0)
      ) AS data
      FROM jsonb_array_elements(COALESCE(g.product_ids, '[]'::jsonb)) AS elem
      INNER JOIN public.products p ON p.id = (elem->>'id')::uuid
      WHERE p.deleted_at IS NULL
        AND p.is_active = true
        AND p.parent_product_id IS NULL
        AND p.option_only = false
    ) plist ON true
    WHERE g.deleted_at IS NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_home_theme_groups_admin() TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #392 의 두 함수 CREATE OR REPLACE 문 재실행으로 복구(card_tone 줄 제거)
-- ============================================================
