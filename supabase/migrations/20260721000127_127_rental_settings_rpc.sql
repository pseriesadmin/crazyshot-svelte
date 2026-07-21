-- ★ MIGRATION: 127_rental_settings_rpc.sql
-- Description: /cms/set/ 대여관리 설정 RPC 함수 (H-01: DML 금지 → RPC 경유)
-- Dependencies: 126_rental_settings_tables.sql, is_cms_user()
-- Author: Stephen Cconzy
-- Date: 2026-07-21

-- ═══════════════════════════════════════════
-- 1. 대여 기간 조건 RPC
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_rental_period_option(
  p_id   UUID,
  p_name TEXT,
  p_display_order INT DEFAULT 0
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

  -- 신규 추가 시 최대 10개 체크
  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM rental_period_options
    WHERE deleted_at IS NULL;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'max_limit: 대여 기간 조건은 최대 10개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO rental_period_options (name, display_order)
    VALUES (p_name, p_display_order)
    RETURNING id INTO v_id;
  ELSE
    UPDATE rental_period_options
    SET name = p_name, display_order = p_display_order
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_period_option id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_period_option(UUID, TEXT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_rental_period_option(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE rental_period_options
  SET deleted_at = NOW()
  WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_rental_period_option(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.reorder_rental_period_options(p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  FOR v_i IN 1..array_length(p_ids, 1) LOOP
    UPDATE rental_period_options
    SET display_order = v_i - 1
    WHERE id = p_ids[v_i] AND deleted_at IS NULL;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_rental_period_options(UUID[]) TO authenticated;


-- ═══════════════════════════════════════════
-- 2. 대여 방식 RPC
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_rental_method_option(
  p_id   UUID,
  p_name TEXT,
  p_display_order INT DEFAULT 0
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

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM rental_method_options
    WHERE deleted_at IS NULL;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'max_limit: 대여 방식은 최대 10개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO rental_method_options (name, display_order)
    VALUES (p_name, p_display_order)
    RETURNING id INTO v_id;
  ELSE
    UPDATE rental_method_options
    SET name = p_name, display_order = p_display_order
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_rental_method_option(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE rental_method_options
  SET deleted_at = NOW()
  WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_rental_method_option(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.reorder_rental_method_options(p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  FOR v_i IN 1..array_length(p_ids, 1) LOOP
    UPDATE rental_method_options
    SET display_order = v_i - 1
    WHERE id = p_ids[v_i] AND deleted_at IS NULL;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_rental_method_options(UUID[]) TO authenticated;


-- ═══════════════════════════════════════════
-- 3. 지점 정보 RPC
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_pickup_point(
  p_id             UUID,
  p_name           TEXT,
  p_address        TEXT DEFAULT '',
  p_phone          TEXT DEFAULT '',
  p_contact_person TEXT DEFAULT ''
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

  -- contact_person: 한영숫자 최대 10자
  IF length(p_contact_person) > 10 THEN
    RAISE EXCEPTION 'contact_person must be 10 chars or less';
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM pickup_points
    WHERE deleted_at IS NULL;

    IF v_count >= 20 THEN
      RAISE EXCEPTION 'max_limit: 지점은 최대 20개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO pickup_points (name, location, address, phone, contact_person)
    VALUES (p_name, p_name, p_address, p_phone, NULLIF(p_contact_person, ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE pickup_points
    SET
      name           = p_name,
      location       = p_name,
      address        = p_address,
      phone          = p_phone,
      contact_person = NULLIF(p_contact_person, '')
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: pickup_point id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_pickup_point(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_pickup_point(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE pickup_points
  SET deleted_at = NOW()
  WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_pickup_point(UUID) TO authenticated;


-- ═══════════════════════════════════════════
-- 4. 이용안내 RPC
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_rental_guide(p_guide_text TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  IF length(p_guide_text) > 1000 THEN
    RAISE EXCEPTION 'guide_text exceeds 1000 characters';
  END IF;

  -- 싱글톤: 없으면 INSERT, 있으면 UPDATE
  IF EXISTS (SELECT 1 FROM rental_guide_settings LIMIT 1) THEN
    UPDATE rental_guide_settings SET guide_text = p_guide_text;
  ELSE
    INSERT INTO rental_guide_settings (guide_text) VALUES (p_guide_text);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_guide(TEXT) TO authenticated;


-- ═══════════════════════════════════════════
-- 5. 필수 동의문 RPC
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_rental_consent_item(
  p_id      UUID,
  p_content TEXT,
  p_display_order INT DEFAULT 0
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

  p_content := trim(p_content);
  IF p_content = '' THEN
    RAISE EXCEPTION 'content cannot be empty';
  END IF;

  IF length(p_content) > 200 THEN
    RAISE EXCEPTION 'content exceeds 200 characters';
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM rental_consent_items
    WHERE deleted_at IS NULL;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'max_limit: 필수 동의문은 최대 10개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO rental_consent_items (content, display_order)
    VALUES (p_content, p_display_order)
    RETURNING id INTO v_id;
  ELSE
    UPDATE rental_consent_items
    SET content = p_content, display_order = p_display_order
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_consent_item id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_rental_consent_item(UUID, TEXT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_rental_consent_item(p_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  UPDATE rental_consent_items
  SET deleted_at = NOW()
  WHERE id = p_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_rental_consent_item(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.reorder_rental_consent_items(p_ids UUID[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i INT;
BEGIN
  IF NOT public.is_cms_user() THEN
    RAISE EXCEPTION 'unauthorized: cms role required';
  END IF;

  FOR v_i IN 1..array_length(p_ids, 1) LOOP
    UPDATE rental_consent_items
    SET display_order = v_i - 1
    WHERE id = p_ids[v_i] AND deleted_at IS NULL;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_rental_consent_items(UUID[]) TO authenticated;

-- ROLLBACK (수동 실행):
-- DROP FUNCTION IF EXISTS public.reorder_rental_consent_items(UUID[]);
-- DROP FUNCTION IF EXISTS public.delete_rental_consent_item(UUID);
-- DROP FUNCTION IF EXISTS public.upsert_rental_consent_item(UUID, TEXT, INT);
-- DROP FUNCTION IF EXISTS public.upsert_rental_guide(TEXT);
-- DROP FUNCTION IF EXISTS public.delete_pickup_point(UUID);
-- DROP FUNCTION IF EXISTS public.upsert_pickup_point(UUID, TEXT, TEXT, TEXT, TEXT);
-- DROP FUNCTION IF EXISTS public.reorder_rental_method_options(UUID[]);
-- DROP FUNCTION IF EXISTS public.delete_rental_method_option(UUID);
-- DROP FUNCTION IF EXISTS public.upsert_rental_method_option(UUID, TEXT, INT);
-- DROP FUNCTION IF EXISTS public.reorder_rental_period_options(UUID[]);
-- DROP FUNCTION IF EXISTS public.delete_rental_period_option(UUID);
-- DROP FUNCTION IF EXISTS public.upsert_rental_period_option(UUID, TEXT, INT);
