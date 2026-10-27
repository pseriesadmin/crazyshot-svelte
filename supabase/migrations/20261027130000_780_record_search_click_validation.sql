-- 780_record_search_click_validation.sql
-- sp5(A-Lite) 완화안 3 반영 (2026-10-27): 고객 브라우저가 호출하는 record_search_click 에 입력 검증 추가.
--  · p_product_id 가 실제 공개 가능한 부모 상품(삭제 안 됨·자식 아님)이 아니면 무시 → 가짜 상품번호로 행이 무한히 쌓이는 것 차단
--  · 같은 (검색 로그, 상품) 조합은 1번만 반영 → 반복 호출로 clicked_ids·클릭 수가 부풀지 않음
--  · clicked_ids 최대 20개 → 한 로그 행이 비대해지는 것 차단
--  · 24시간이 지난 검색 로그에는 클릭을 더하지 않음
--  · 검색어가 100자를 넘으면 학습 대상에서 제외(클릭 수·학습 기록에 쓰이지 않음)
-- 기존 동작(정상 클릭의 클릭 수·사용자 수 집계)은 778 과 동일하다. 권한은 CREATE OR REPLACE 로 그대로 유지(anon 실행 가능).
-- 롤백: 20261027110000_778 의 record_search_click 정의로 되돌린다.
CREATE OR REPLACE FUNCTION public.record_search_click(p_search_log_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_query    TEXT;
  v_user     UUID;
  v_session  TEXT;
  v_created  TIMESTAMPTZ;
  v_clicked  UUID[];
  v_actor    TEXT;
  v_new      BOOLEAN;
BEGIN
  IF p_search_log_id IS NULL OR p_product_id IS NULL THEN RETURN; END IF;

  SELECT query, user_id, session_id, created_at, coalesce(clicked_ids, '{}')
    INTO v_query, v_user, v_session, v_created, v_clicked
  FROM search_logs WHERE id = p_search_log_id;
  IF v_query IS NULL OR length(v_query) > 100 THEN RETURN; END IF;
  IF v_created < now() - interval '24 hours' THEN RETURN; END IF;
  IF p_product_id = ANY(v_clicked) OR coalesce(array_length(v_clicked, 1), 0) >= 20 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND parent_product_id IS NULL AND deleted_at IS NULL) THEN RETURN; END IF;

  v_actor := coalesce(
    v_user::text,
    CASE WHEN v_session IS NOT NULL AND v_session <> '' THEN 's:' || left(v_session, 100) END,
    'guest'
  );

  INSERT INTO product_search_click_actors(product_id, search_term, actor_key)
  VALUES (p_product_id, v_query, v_actor)
  ON CONFLICT (product_id, search_term, actor_key)
  DO UPDATE SET click_count = product_search_click_actors.click_count + 1, last_clicked_at = now()
  RETURNING (xmax = 0) INTO v_new;

  INSERT INTO product_search_stats(product_id, search_term, impression_count, click_count, click_user_count)
  VALUES (p_product_id, v_query, 0, 1, 1)
  ON CONFLICT (product_id, search_term)
  DO UPDATE SET
    click_count      = product_search_stats.click_count + 1,
    click_user_count = product_search_stats.click_user_count + CASE WHEN v_new THEN 1 ELSE 0 END,
    last_updated     = now();

  UPDATE search_logs
  SET clicked_ids = array_append(coalesce(clicked_ids, '{}'), p_product_id)
  WHERE id = p_search_log_id;
END;
$function$;
