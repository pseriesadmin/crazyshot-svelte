-- Migration #175: upsert_rental_method_option RPC에 method_key 파라미터 추가
-- CMS 대여방식 추가 시 method_key 선택 UI 지원

CREATE OR REPLACE FUNCTION public.upsert_rental_method_option(
  p_id            UUID,
  p_name          TEXT,
  p_display_order INT DEFAULT 0,
  p_method_key    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_id    UUID;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  p_name := trim(p_name);
  IF p_name = '' THEN
    RAISE EXCEPTION 'name cannot be empty';
  END IF;

  -- method_key 빈 문자열 → NULL 처리
  IF p_method_key IS NOT NULL AND trim(p_method_key) = '' THEN
    p_method_key := NULL;
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM rental_method_options
    WHERE deleted_at IS NULL;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'max_limit: 대여 방식은 최대 10개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO rental_method_options (name, display_order, method_key)
    VALUES (p_name, p_display_order, p_method_key)
    RETURNING id INTO v_id;
  ELSE
    UPDATE rental_method_options
    SET
      name          = p_name,
      display_order = p_display_order,
      method_key    = COALESCE(p_method_key, method_key)
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- 이전 시그니처 권한 유지 + 신규 시그니처 권한 부여
GRANT EXECUTE ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT) TO authenticated;
