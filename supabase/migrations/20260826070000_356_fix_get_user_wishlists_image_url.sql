-- Migration #356: get_user_wishlists() image_url 추출 SQL 오류 수정
-- 배경: 상품 탐색 화면(products/products/[id]/hype-pack/search)에 위시(찜) 토글 기능을
-- 신규 연결하는 작업 중, 실제로 찜을 추가해도 /account "관심가져봄"이 항상 빈 목록으로
-- 보이는 문제를 Stephen이 발견 — product_wishlists 테이블에는 실제로 정상 INSERT됨을
-- 직접 SQL로 확인(쓰기 경로 toggle_product_wishlist는 정상). 문제는 읽기 경로.
--
-- 근본원인: get_user_wishlists(#158)의 `COALESCE(p.image_urls[1], '')` — image_urls는
-- jsonb 컬럼이라 COALESCE 양쪽 타입을 jsonb로 통일하려고 리터럴 ''를 ''::jsonb로 캐스팅
-- 시도하는데, 빈 문자열은 유효한 JSON이 아니라서(최소 ""가 필요) 이 캐스팅 자체가
-- 예외(22P02 invalid input syntax for type json)를 던진다 — image_urls 값이 있든 없든
-- 사용자가 찜한 상품이 1개라도 있으면 이 RPC 호출 자체가 항상 실패했다(신규 회귀 아님,
-- Migration #158부터 존재하던 잠재 결함 — 실제로 위시리스트에 데이터가 쓰인 적이 거의
-- 없어 지금까지 발견되지 않았을 뿐). account/+page.server.ts는 이 RPC 실패를 조용히
-- 빈 배열로 폴백해(`wishlistRes.data ?? []`) 화면에는 에러 없이 그냥 "관심 상품이
-- 없습니다"로만 보였다.
--
-- 수정 1: `p.image_urls[1]`(1-based 네이티브 배열 subscript, jsonb에 안 맞음) →
-- `p.image_urls->>0`(0-based jsonb 연산자, 결과가 TEXT라 '' 리터럴과 타입 충돌 없음).
--
-- 수정 2(1차 수정 적용 시도 중 추가 발견 — 같은 이유로 여태 도달한 적 없던 별개 결함):
-- RETURNS TABLE의 product_name·slug가 VARCHAR로 선언돼 있는데 products.name/slug 컬럼은
-- 현재 TEXT 타입이라 "structure of query does not match function result type" 런타임
-- 에러가 발생 — p.name::VARCHAR / p.slug::VARCHAR로 명시 캐스팅해 선언된 반환타입에 맞춤
-- (RETURNS TABLE 시그니처 자체는 변경하지 않음 — DROP 없이 CREATE OR REPLACE로 처리 가능).
-- 로직·반환 컬럼 구성 전부 무변경 — SELECT 절 값 표현식만 수정.

CREATE OR REPLACE FUNCTION get_user_wishlists(
  p_user_id UUID
) RETURNS TABLE (
  wishlist_id  UUID,
  product_id   UUID,
  product_name VARCHAR,
  category     TEXT,
  image_url    TEXT,
  slug         VARCHAR,
  price24h     NUMERIC,
  price12h     NUMERIC,
  wished_at    TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 호출자 본인 또는 관리자만 허용
  IF auth.uid() != p_user_id AND NOT is_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pw.id                         AS wishlist_id,
    p.id                          AS product_id,
    p.name::VARCHAR                AS product_name,
    p.category::TEXT              AS category,
    COALESCE(p.image_urls->>0, '') AS image_url,
    p.slug::VARCHAR                AS slug,
    MAX(pr24.price)               AS price24h,
    MAX(pr12.price)               AS price12h,
    pw.created_at                 AS wished_at
  FROM product_wishlists pw
  JOIN products p ON p.id = pw.product_id
    AND p.deleted_at IS NULL AND p.is_active = true
  LEFT JOIN price_rules pr24 ON pr24.product_id = p.id
    AND pr24.duration_type = '24h' AND pr24.deleted_at IS NULL AND pr24.is_active = true
  LEFT JOIN price_rules pr12 ON pr12.product_id = p.id
    AND pr12.duration_type = '12h' AND pr12.deleted_at IS NULL AND pr12.is_active = true
  WHERE pw.user_id = p_user_id
  GROUP BY pw.id, p.id, p.name, p.category, p.image_urls, p.slug, pw.created_at
  ORDER BY pw.created_at DESC;
END;
$$;
