-- Migration #513: upsert_rental_method_option RPC에 p_deadline_time 파라미터 추가
--
-- 배경: rental_method_options.deadline_time(TEXT, 예: "19:00 마감")은 /cart 장바구니
-- 화면(cart/+page.server.ts → cart/+page.svelte tab.deadline)에 그대로 노출되는 안내
-- 문구인데, 지금까지 CMS에 이 값을 입력할 수 있는 화면이 전혀 없어 Supabase 콘솔로
-- 직접 넣어야 했다(products.md에 이미 "orphan 컬럼"으로 문서화돼 있던 공백).
-- "대여 방식 옵션" 목록 생성 폼에 이 문구를 입력하는 필드를 추가하면서, 저장을 받는
-- RPC 파라미터도 함께 신설한다.
--
-- ⛔ 인자 개수가 바뀌므로 CREATE OR REPLACE는 "교체"가 아니라 "새 오버로드 생성"이다.
-- 이 RPC는 과거에도 3-param→4-param(method_key 추가, Migration #175) 전환 시 구
-- 오버로드를 남겨둔 채 GRANT만 추가하는 방식을 썼었는데, 그 결과 지금 이 파일 작성
-- 시점에 3-param·4-param 두 오버로드가 동시에 GRANT돼 있는 상태다. 실제 호출부가
-- 코드베이스에 딱 1곳(cms/set/rental/+page.server.ts addMethod)뿐이라 지금까지는
-- 문제가 없었지만, 여기에 5번째 파라미터(DEFAULT 포함)를 또 추가하면 4-key 호출이
-- 4-param 오버로드와 5-param 오버로드(뒤 파라미터가 기본값으로 채워짐) 양쪽에 걸쳐
-- PostgREST가 모호성 에러(PGRST203)를 낼 수 있다(products.md §2-3에 기록된
-- generate_product_code 실사고와 동일 클래스 위험). 유일한 호출부를 5-param 전체
-- 명시 호출로 갱신하는 것과 함께, 구 3-param·4-param 오버로드를 명시적으로 DROP해
-- 이 위험을 원천 차단한다.

-- ============================================================
-- 1. 신규 5-param 함수 정의
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_rental_method_option(
  p_id            UUID,
  p_name          TEXT,
  p_display_order INT DEFAULT 0,
  p_method_key    TEXT DEFAULT NULL,
  p_deadline_time TEXT DEFAULT NULL
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

  -- deadline_time 빈 문자열 → NULL 처리(name/method_key와 동일 관례)
  IF p_deadline_time IS NOT NULL AND trim(p_deadline_time) = '' THEN
    p_deadline_time := NULL;
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM rental_method_options
    WHERE deleted_at IS NULL;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'max_limit: 대여 방식은 최대 10개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO rental_method_options (name, display_order, method_key, deadline_time)
    VALUES (p_name, p_display_order, p_method_key, p_deadline_time)
    RETURNING id INTO v_id;
  ELSE
    UPDATE rental_method_options
    SET
      name          = p_name,
      display_order = p_display_order,
      method_key    = COALESCE(p_method_key, method_key),
      deadline_time = COALESCE(p_deadline_time, deadline_time)
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 2. 구 오버로드 정리 (죽은 함수 + 모호성 위험 제거)
-- ============================================================
DROP FUNCTION IF EXISTS public.upsert_rental_method_option(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.upsert_rental_method_option(UUID, TEXT, INT, TEXT);

-- ============================================================
-- 3. 권한 재하드닝 — 신규 함수 객체는 구 버전의 GRANT 이력을 물려받지 못한다
--    (2026-09-15 compute_reservation_line_amount 하드닝 누락 사고 재발 방지 원칙)
-- ============================================================
REVOKE ALL ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT);
-- (구 버전 복원 시 Migration #127 원본 + #175 GRANT 블록을 그대로 재실행)
-- ============================================================
