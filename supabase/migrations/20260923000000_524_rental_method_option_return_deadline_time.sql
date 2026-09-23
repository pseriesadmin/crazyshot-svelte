-- Migration #524: 대여 방식 옵션에 "반납방식 노출용 안내문구"(return_deadline_time) 컬럼 신설
--
-- 배경(Stephen 요청, 2026-09-23): 기존 deadline_time(2026-09-21 Migration #513)은 이 방식이
-- 수령(pickup)·반납(return) 어느 쪽 탭에서 선택되든 동일한 안내문구가 그대로 노출됐다
-- (/cart deliveryTabs를 pickup 탭·return 탭이 그대로 공유 — computeReturnVisibleTabs는 그
-- 배열을 필터링만 할 뿐 deadline 필드를 건드리지 않음). Stephen이 기존 필드를 명시적으로
-- "수령방식 노출용"으로 지칭하며 별도의 "반납방식 노출용" 필드를 요청 — 새 컬럼을 추가해
-- 수령/반납 각각 독립된 안내문구를 노출할 수 있게 한다.
--
-- 패턴은 deadline_time과 완전히 동일(길이 제한 20자는 앱 레벨, DB는 text 무제한).

ALTER TABLE public.rental_method_options
  ADD COLUMN IF NOT EXISTS return_deadline_time TEXT;

-- upsert_rental_method_option — 5-param(#522) → 6-param(p_return_deadline_time 추가)
-- 기존 오버로드는 명시적으로 DROP(PostgREST 오버로드 모호성 방지 — products.md 확립된 패턴).
DROP FUNCTION IF EXISTS public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT);

CREATE FUNCTION public.upsert_rental_method_option(
  p_id                   UUID,
  p_name                 TEXT,
  p_display_order        INT DEFAULT 0,
  p_method_key           TEXT DEFAULT NULL,
  p_deadline_time        TEXT DEFAULT NULL,
  p_return_deadline_time TEXT DEFAULT NULL
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

  IF p_method_key IS NOT NULL AND trim(p_method_key) = '' THEN
    p_method_key := NULL;
  END IF;

  IF p_deadline_time IS NOT NULL AND trim(p_deadline_time) = '' THEN
    p_deadline_time := NULL;
  END IF;

  IF p_return_deadline_time IS NOT NULL AND trim(p_return_deadline_time) = '' THEN
    p_return_deadline_time := NULL;
  END IF;

  IF p_id IS NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM rental_method_options
    WHERE deleted_at IS NULL;

    IF v_count >= 10 THEN
      RAISE EXCEPTION 'max_limit: 대여 방식은 최대 10개까지 등록할 수 있습니다';
    END IF;

    INSERT INTO rental_method_options (name, display_order, method_key, deadline_time, return_deadline_time)
    VALUES (p_name, p_display_order, p_method_key, p_deadline_time, p_return_deadline_time)
    RETURNING id INTO v_id;
  ELSE
    UPDATE rental_method_options
    SET
      name                  = p_name,
      display_order         = p_display_order,
      method_key            = COALESCE(p_method_key, method_key),
      -- deadline_time/return_deadline_time 둘 다 무조건 덮어쓰기(Migration #522와 동일 원칙) —
      -- 이 두 필드는 항상 "지금 화면에 보이는 값 그대로 확정" 의도로 호출되므로(빈 값=삭제
      -- 의도 포함) COALESCE 대상이 아니다.
      deadline_time         = p_deadline_time,
      return_deadline_time  = p_return_deadline_time
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT, TEXT);
-- Migration #522의 5-param 버전을 그대로 재실행해 복구.
-- ALTER TABLE public.rental_method_options DROP COLUMN IF EXISTS return_deadline_time;
-- ============================================================
