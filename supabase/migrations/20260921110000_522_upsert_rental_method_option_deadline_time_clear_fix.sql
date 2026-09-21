-- Migration #522: upsert_rental_method_option — deadline_time을 지울 수 없던 결함 수정
--
-- 배경(sp3-qa-agent GATE E 최종검수 발견, 2026-09-21): Migration #513이 UPDATE 분기에서
-- deadline_time = COALESCE(p_deadline_time, deadline_time)로 구현돼, 관리자가 CMS에서
-- 안내문구 입력칸을 비우고 저장하면 서버가 NULL을 전달하는데 COALESCE가 그 NULL을 무시하고
-- 기존 값을 그대로 유지해버렸다. RPC는 에러 없이 성공을 반환하므로 화면엔 "저장됐습니다"로
-- 표시되지만 실제로는 아무 것도 바뀌지 않는 조용한 무동작(silent no-op)이었다.
--
-- method_key는 COALESCE 유지가 올바르다 — 이 RPC를 호출하는 두 지점(addMethod=INSERT 전용,
-- updateMethodDeadline)중 updateMethodDeadline은 method_key를 "항상 현재값 그대로 재전송"
-- 하는 용도(변경 의도 없음)라 COALESCE가 "값 없으면 기존 유지" 시맨틱과 정확히 맞는다.
--
-- 반면 deadline_time은 updateMethodDeadline 액션의 존재 목적 자체가 "사용자가 입력칸에
-- 타이핑한 값(빈 값 포함)을 그대로 반영"이라, COALESCE의 "NULL이면 기존 유지" 시맨틱과
-- 충돌한다 — 이 RPC의 유일한 두 호출부(addMethod의 INSERT 분기, updateMethodDeadline의
-- UPDATE 분기) 어느 쪽도 "deadline_time을 안 건드리고 싶다"는 의도로 NULL을 보내는 경우가
-- 없으므로, UPDATE 분기의 deadline_time만 COALESCE 없이 무조건 덮어쓰기로 변경해도 기존
-- 정상 동작(값 변경, NULL→값)에는 전혀 영향이 없고 "값→NULL(지우기)"만 새로 가능해진다.
--
-- 시그니처는 무변경(5-param 그대로) — CREATE OR REPLACE로 같은 함수 객체를 교체하므로
-- 기존 GRANT는 유지되나, 2026-09-15 compute_reservation_line_amount 하드닝 누락 사고
-- 재발 방지 원칙에 따라 명시적으로 재적용한다(belt-and-suspenders).

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

  IF p_method_key IS NOT NULL AND trim(p_method_key) = '' THEN
    p_method_key := NULL;
  END IF;

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
      -- ⛔ 수정: COALESCE(p_deadline_time, deadline_time) → p_deadline_time 무조건 덮어쓰기.
      -- updateMethodDeadline 액션이 항상 "이 값으로 확정" 의도로 호출하므로(빈 값=삭제 의도
      -- 포함) 기존 값 보존이 아니라 항상 반영이 맞다.
      deadline_time = p_deadline_time
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'not_found: rental_method_option id %', p_id;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rental_method_option(UUID, TEXT, INT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration #513의 CREATE OR REPLACE 블록을 그대로 재실행(deadline_time을 다시 COALESCE로)
-- ============================================================
