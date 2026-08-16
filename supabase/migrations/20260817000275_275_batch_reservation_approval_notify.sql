-- Migration 275: 예약 승인 알림 통합(배치) RPC 신규 추가
--
-- 배경(Stephen 정책 변경, 2026-08-17): 장바구니에서 상품 2개 이상을 체크한 채 한 번에
-- 승인(confirm-mock)하면, 기존에는 예약 건별로 send_rental_chat_notification을 각각 호출해
-- 같은 상담세션 안에 상품마다 별도의 "예약이 승인되었습니다" 카드가 개별 생성됐다.
-- 대여반출납 옵션이 장바구니 단위로 단일화된 정책과 맞춰, 같은 체크아웃 배치로 승인된
-- 예약들은 하나의 통합 카드로 묶어 상담채팅에 노출한다.
--
-- 설계: 기존 send_rental_chat_notification(단건, 7개 notify_type·다수 호출부 공유)은 전혀
-- 건드리지 않고, confirm-mock 전용의 신규 배치 함수를 별도로 추가한다 — 기존 단건 알림
-- 흐름(반출·수령확인·반납예정 등)에 영향 없음.
--
-- action_payload에 items(JSONB 배열, {reservation_no, product_name, return_deadline})를
-- 추가하고, 최상위 reservation_no/product_name/return_deadline은 첫 번째 항목 값으로 채워
-- 기존 ActionCard.svelte 단일 필드 렌더링과도 하위호환된다(items 배열은 클라이언트에서
-- 다건일 때만 추가 렌더링에 사용).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)

CREATE OR REPLACE FUNCTION public.send_rental_chat_notification_batch(
  p_reservation_ids bigint[],
  p_notify_type     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id        UUID;
  v_session_id     UUID;
  v_content        TEXT;
  v_items          JSONB := '[]'::jsonb;
  v_first_product  TEXT;
  v_first_code     TEXT;
  v_first_deadline DATE;
  v_count          INT;
  v_action_payload JSONB;
  rec              RECORD;
BEGIN
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약 ID가 필요합니다.');
  END IF;

  -- 예약 전체가 동일 사용자 소유인지 확인하며 항목 목록 구성 (id 오름차순 — 체크아웃 순서 근사)
  FOR rec IN
    SELECT rr.id, rr.user_id, p.name AS product_name, rr.end_date::DATE AS end_date,
           COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')) AS code
    FROM rental_reservations rr
    JOIN products p ON p.id = rr.product_id
    WHERE rr.id = ANY(p_reservation_ids)
    ORDER BY rr.id
  LOOP
    IF v_user_id IS NULL THEN
      v_user_id := rec.user_id;
    ELSIF v_user_id IS DISTINCT FROM rec.user_id THEN
      RETURN jsonb_build_object('ok', false, 'error', '서로 다른 사용자의 예약을 함께 처리할 수 없습니다.');
    END IF;

    v_items := v_items || jsonb_build_object(
      'reservation_no',  rec.code,
      'product_name',    rec.product_name,
      'return_deadline', rec.end_date::TEXT
    );

    IF v_first_product IS NULL THEN
      v_first_product  := rec.product_name;
      v_first_code     := rec.code;
      v_first_deadline := rec.end_date;
    END IF;
  END LOOP;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  v_count := jsonb_array_length(v_items);

  v_content := CASE
    WHEN p_notify_type = 'reservation_approval' AND v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 예약이 승인되었습니다'
    WHEN p_notify_type = 'reservation_approval'
      THEN v_first_product || ' 예약이 승인되었습니다'
    WHEN v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 알림'
    ELSE v_first_product || ' 알림'
  END;

  v_action_payload := jsonb_build_object(
    'type',            p_notify_type,
    'reservation_no',  v_first_code,
    'product_name',    v_first_product,
    'return_deadline', v_first_deadline::TEXT,
    'items',           v_items,
    'action_url',      '/account/rental'
  );

  -- 세션 탐색/생성 — send_rental_chat_notification(Migration 258)과 동일 3단계 로직
  SELECT id INTO v_session_id
  FROM chat_sessions
  WHERE user_id = v_user_id
    AND context_type = 'general'::chat_context_type_enum
    AND status IN ('open', 'pending')
  ORDER BY updated_at DESC LIMIT 1;

  IF v_session_id IS NULL THEN
    UPDATE chat_sessions
    SET status = 'open', updated_at = NOW()
    WHERE id = (
      SELECT id FROM chat_sessions
      WHERE user_id = v_user_id
        AND context_type = 'general'::chat_context_type_enum
        AND status = 'closed'
      ORDER BY updated_at DESC LIMIT 1
    )
    RETURNING id INTO v_session_id;
  END IF;

  IF v_session_id IS NULL THEN
    -- context_id는 uuid 컬럼 — 예약 id(bigint)를 담을 수 없어 NULL로 둔다(nullable 확인됨).
    -- 배치 알림은 여러 예약을 한 세션에 묶으므로 애초에 단일 reservation_id로 표현 불가.
    INSERT INTO chat_sessions (user_id, status, context_type, context_id)
    VALUES (v_user_id, 'open', 'general'::chat_context_type_enum, NULL)
    RETURNING id INTO v_session_id;
  END IF;

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'admin', 'action_card', v_content, v_action_payload, false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id, 'count', v_count);
END;
$$;

-- 기존 send_rental_chat_notification과 동일 보안 정책(Migration 263) — service_role(admin
-- 클라이언트)로만 호출되므로 authenticated·public 실행권한 회수
REVOKE EXECUTE ON FUNCTION public.send_rental_chat_notification_batch(bigint[], text) FROM PUBLIC, authenticated;

-- ============================================================
-- ROLLBACK: DROP FUNCTION public.send_rental_chat_notification_batch(bigint[], text);
-- ============================================================
