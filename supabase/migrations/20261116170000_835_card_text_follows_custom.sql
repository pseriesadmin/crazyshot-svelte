-- #835 채팅카드 문구가 푸시알림 설정의 커스텀 안내문장을 따른다 (2026-11-16, Stephen 지시)
--  · push_notification_config.extra_config.message(CMS /cms/set/push 에서 등록한 안내문장)가 있으면 채팅카드 본문도 그 문장(변수 치환)으로,
--    없으면 기존 고정 문구 그대로. 푸시·문자와 같은 정본을 쓴다(service-operations.md §15 개정).
--  · 변수 치환은 src/lib/utils/notifyTemplate.ts applyNotifyTemplate 와 같은 규칙(이중 구현 — 함께 바꿀 것):
--      값이 없는 {{변수}}는 빈 문자열, 택배사·운송장번호 값이 없으면 그 변수가 든 줄 삭제, 줄마다 연속 공백 1칸·앞뒤 공백 제거.
--  · 적용 대상 함수: send_rental_chat_notification(무인보관함 안내는 기존 조립 문장이 정본이라 제외) · send_rental_chat_notification_batch · notify_late_fee_payment_request.
--  · 서버 전용 보조 함수 2개는 private 스키마에 두고 anon·authenticated 실행 권한을 회수한다(SECURITY DEFINER 호출 함수만 쓴다).
-- 롤백: 세 함수를 #832 이전 정의(아래 CASE 고정 문구만 남기고 card_text_override 호출 제거)로 CREATE OR REPLACE 하고 private 보조 함수 2개를 DROP.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.apply_notify_template(p_template text, p_vars jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_line text;
  v_keep text[] := ARRAY[]::text[];
  v_lines text[];
  v_cleaned text[] := ARRAY[]::text[];
  v_text text;
  m record;
BEGIN
  IF p_template IS NULL THEN RETURN NULL; END IF;

  -- 택배사·운송장번호 값이 없으면 그 변수가 든 줄을 통째로 뺀다(빈 "택배사:" 줄 방지)
  FOREACH v_line IN ARRAY string_to_array(p_template, E'\n') LOOP
    IF (position('{{택배사}}' IN v_line) > 0 AND COALESCE(p_vars->>'택배사', '') = '')
       OR (position('{{운송장번호}}' IN v_line) > 0 AND COALESCE(p_vars->>'운송장번호', '') = '') THEN
      CONTINUE;
    END IF;
    v_keep := v_keep || v_line;
  END LOOP;
  v_text := array_to_string(v_keep, E'\n');

  -- {{변수}} 치환 — 값이 없거나 알 수 없는 변수는 빈 문자열
  FOR m IN
    SELECT DISTINCT btrim((x)[1]) AS k
    FROM regexp_matches(v_text, '\{\{\s*([^{}]+?)\s*\}\}', 'g') AS x
  LOOP
    v_text := regexp_replace(
      v_text,
      '\{\{\s*' || regexp_replace(m.k, '([\\^$.|?*+()\[\]{}])', '\\\1', 'g') || '\s*\}\}',
      replace(COALESCE(p_vars->>m.k, ''), '\', '\\'),  -- 치환문에서 특수한 것은 백슬래시뿐(& 는 그대로, \& 는 '일치 전체'라 쓰지 않는다)
      'g'
    );
  END LOOP;

  -- 줄마다 연속 공백 1칸 + 앞뒤 공백 제거, 전체 앞뒤 공백 제거
  v_lines := string_to_array(v_text, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_cleaned := v_cleaned || btrim(regexp_replace(v_line, '[ \t]{2,}', ' ', 'g'), E' \t\r');
  END LOOP;
  RETURN btrim(array_to_string(v_cleaned, E'\n'), E' \t\r\n');
END;
$function$;

CREATE OR REPLACE FUNCTION private.card_text_override(
  p_notify_type text,
  p_reservation_id bigint,
  p_product text DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $function$
DECLARE
  v_msg  text;
  v_vars jsonb := '{}'::jsonb;
  v_out  text;
  r      record;
BEGIN
  SELECT NULLIF(btrim(extra_config->>'message'), '')
    INTO v_msg
    FROM public.push_notification_config
   WHERE notify_type = p_notify_type;
  IF v_msg IS NULL THEN RETURN NULL; END IF;

  IF p_reservation_id IS NOT NULL THEN
    SELECT rr.reservation_code, rr.start_date, rr.pickup_time, rr.end_date, rr.return_time,
           up.full_name, COALESCE(ppar.name, p.name) AS pname
      INTO r
      FROM public.rental_reservations rr
      JOIN public.products p ON p.id = rr.product_id
      LEFT JOIN public.products ppar ON ppar.id = p.parent_product_id
      LEFT JOIN public.user_profiles up ON up.id = rr.user_id
     WHERE rr.id = p_reservation_id;
    IF FOUND THEN
      v_vars := jsonb_strip_nulls(jsonb_build_object(
        '상품명',   r.pname,
        '고객이름', NULLIF(r.full_name, ''),
        '예약코드', NULLIF(r.reservation_code, ''),
        '수령일시', CASE WHEN r.start_date IS NOT NULL THEN btrim(r.start_date::text || ' ' || COALESCE(r.pickup_time, '')) END,
        '반납일시', CASE WHEN r.end_date   IS NOT NULL THEN btrim(r.end_date::text   || ' ' || COALESCE(r.return_time, '')) END
      ));
    END IF;
  END IF;

  IF NULLIF(btrim(COALESCE(p_product, '')), '') IS NOT NULL THEN
    v_vars := v_vars || jsonb_build_object('상품명', btrim(p_product));
  END IF;
  v_vars := v_vars || COALESCE(p_extra, '{}'::jsonb);

  v_out := private.apply_notify_template(v_msg, v_vars);
  IF v_out IS NULL OR v_out = '' THEN RETURN NULL; END IF;
  RETURN left(v_out, 2000);
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_notify_template(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.card_text_override(text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ① 예약 알림 카드 — 무인보관함 안내(조립 문장이 정본)를 뺀 모든 유형에서 커스텀 문장이 있으면 본문 교체
CREATE OR REPLACE FUNCTION public.send_rental_chat_notification(p_reservation_id bigint, p_notify_type text, p_action_url text DEFAULT NULL::text, p_product_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_product        TEXT;
  v_end_date       DATE;
  v_code           TEXT;
  v_locker_password TEXT;
  v_locker_number  TEXT;
  v_return_time    TEXT;
  v_entrance       TEXT;
  -- locker-guide-card-694
  v_content_override TEXT;
  -- locker-guide-content-695
  v_session_id     UUID;
  v_content        TEXT;
  v_card_type      TEXT;
  v_action_payload JSONB;
  v_options        JSONB;
  -- tracking-payload-771
  v_tracking       TEXT;
  v_courier        TEXT;
  -- card-custom-835
  v_custom         TEXT;
BEGIN
  SELECT
    rr.user_id,
    COALESCE(ppar.name, p.name),
    rr.end_date::DATE,
    COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')),
    rr.locker_password,
    rr.locker_number,
    rr.return_time
  INTO v_user_id, v_product, v_end_date, v_code, v_locker_password, v_locker_number, v_return_time
  FROM rental_reservations rr
  JOIN products p ON p.id = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id
  WHERE rr.id = p_reservation_id;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  -- 묶음 안내 표기(#819): 호출부가 '대표 상품명 외 N개 상품' 을 넘기면 카드 본문·payload 상품명에 그대로 쓴다
  v_product := COALESCE(NULLIF(btrim(COALESCE(p_product_label, '')), ''), v_product);

  IF p_notify_type = 'locker_guide' THEN
    SELECT NULLIF(btrim(value->>'password'), '') INTO v_entrance FROM cms_settings WHERE key = 'locker_entrance_password';
  END IF;

  v_content := CASE p_notify_type
    WHEN 'reservation_hold'          THEN v_product || ' 예약 신청이 접수되었습니다'
    WHEN 'reservation_approval'      THEN v_product || ' 예약이 승인되었습니다'
    WHEN 'shipment_notify'           THEN v_product || ' 반출 안내'
    WHEN 'rental_confirm'            THEN v_product || ' 수령이 확인되었습니다'
    WHEN 'return_remind'             THEN v_product || ' 반납 예정 알림'
    WHEN 'return_registration'       THEN v_product || ' 반납 정보 등록 요청'
    WHEN 'rental_complete'           THEN v_product || ' 대여가 완료되었습니다'
    WHEN 'reservation_cancelled'     THEN v_product || ' 예약이 취소되었습니다'
    WHEN 'damage_claimed'            THEN v_product || ' 파손 신고가 접수되었습니다. 담당자가 확인 후 안내드리겠습니다'
    WHEN 'hold_expired'              THEN v_product || ' 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN 'locker_guide'              THEN v_product || ' 무인보관함 이용 ' || CASE WHEN NULLIF(btrim(COALESCE(v_locker_number, '')), '') IS NOT NULL THEN btrim(v_locker_number) || '번함 ' ELSE '' END || '비밀번호는 ''' || COALESCE(v_locker_password, '') || '''입니다.' || CASE WHEN v_entrance IS NOT NULL THEN E'\\n중앙현관 비밀번호: ' || v_entrance ELSE '' END
    WHEN 'dhero_place_guide'         THEN v_product || ' 두발히어로 배송 수령 위치를 등록해 주세요'
    WHEN 'tracking_notify'           THEN v_product || ' 운송장 번호가 등록되었습니다. 채팅에서 배송 정보를 확인해주세요'
    WHEN 'payment_cancelled_reissue' THEN v_product || ' 예약변경이 진행중입니다. 기존 결제가 취소되어 예약 신청 상태로 변경되었습니다. 잠시 후 새 계약서가 발송됩니다'
    ELSE v_product || ' 알림'
  END;

  IF p_notify_type = 'locker_guide' THEN
    v_content_override := NULLIF(btrim(COALESCE(current_setting('app.locker_guide_content', true), '')), '');
    IF v_content_override IS NOT NULL THEN
      v_content := left(v_content_override, 2000);
    END IF;
  END IF;

  v_card_type := CASE p_notify_type
    WHEN 'reservation_hold'          THEN 'reservation_hold'
    WHEN 'reservation_approval'      THEN 'reservation_approval'
    WHEN 'shipment_notify'           THEN 'shipment_notify'
    WHEN 'rental_confirm'            THEN 'rental_confirm'
    WHEN 'return_remind'             THEN 'return_remind'
    WHEN 'return_registration'       THEN 'RETURN_REGISTRATION_CARD'
    WHEN 'rental_complete'           THEN 'RESERVATION_STATUS_CARD'
    WHEN 'reservation_cancelled'     THEN 'RESERVATION_STATUS_CARD'
    WHEN 'damage_claimed'            THEN 'RESERVATION_STATUS_CARD'
    WHEN 'hold_expired'              THEN 'RESERVATION_STATUS_CARD'
    WHEN 'locker_guide'              THEN 'RESERVATION_STATUS_CARD'
    WHEN 'dhero_place_guide'         THEN 'RESERVATION_STATUS_CARD'
    WHEN 'tracking_notify'           THEN 'tracking_notify'
    WHEN 'payment_cancelled_reissue' THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_id',  p_reservation_id::TEXT,
    'reservation_no',  v_code,
    'product_name',    v_product,
    'return_deadline', CASE WHEN p_notify_type = 'locker_guide' AND NULLIF(btrim(COALESCE(v_return_time, '')), '') IS NOT NULL THEN v_end_date::TEXT || ' ' || btrim(v_return_time) ELSE v_end_date::TEXT END
  );

  v_action_payload := v_action_payload ||
    jsonb_build_object(
      'action_url',
      CASE
        WHEN p_action_url IS NOT NULL THEN p_action_url
        WHEN p_notify_type = 'return_remind' THEN '/account/rental/' || p_reservation_id::TEXT || '/history'
        WHEN p_notify_type = 'return_registration' THEN '/account/rental/' || p_reservation_id::TEXT || '/return-submit'
        ELSE '/account/rental'
      END
    );

  -- tracking-payload-771: 반출·운송장 알림 카드에 택배사·운송장 번호(ActionCard 가 `{carrier} · {tracking_number}` 로 표시)
  IF p_notify_type IN ('shipment_notify', 'tracking_notify') THEN
    SELECT NULLIF(btrim(rr2.tracking_number), ''), NULLIF(btrim(COALESCE(rr2.courier_code, '')), '')
      INTO v_tracking, v_courier
    FROM rental_reservations rr2
    WHERE NULLIF(btrim(COALESCE(rr2.tracking_number, '')), '') IS NOT NULL
      -- tracking-live-775: 두발히어로에서 취소된 접수번호(dhero_meta.canceledAt)는 싣지 않는다 — 같은 접수번호를 쓰는 예약 중 하나라도 취소 기록이 있으면 접수 전체가 취소
      AND NOT (
        rr2.courier_code = '두발히어로'
        AND EXISTS (
          SELECT 1 FROM rental_reservations rr3
          WHERE rr3.tracking_number = rr2.tracking_number
            AND rr3.courier_code = '두발히어로'
            AND NULLIF(btrim(COALESCE(rr3.dhero_meta->>'canceledAt', '')), '') IS NOT NULL
        )
      )
      AND (
        rr2.id = p_reservation_id
        OR rr2.id IN (
          SELECT oi2.reservation_id FROM order_items oi2
          WHERE oi2.order_id = (SELECT oi.order_id FROM order_items oi WHERE oi.reservation_id = p_reservation_id LIMIT 1)
        )
      )
    ORDER BY (rr2.id = p_reservation_id) DESC, rr2.id
    LIMIT 1;

    IF v_tracking IS NOT NULL THEN
      v_action_payload := v_action_payload || jsonb_build_object('tracking_number', v_tracking);
      IF v_courier IS NOT NULL THEN
        v_action_payload := v_action_payload || jsonb_build_object('carrier', v_courier);
      END IF;
    END IF;
  END IF;

  IF p_notify_type IN (
    'rental_complete', 'reservation_cancelled', 'damage_claimed', 'hold_expired',
    'locker_guide', 'dhero_place_guide', 'tracking_notify',
    'payment_cancelled_reissue'
  ) THEN
    v_action_payload := v_action_payload ||
      jsonb_build_object(
        'button_label',
        CASE p_notify_type
          WHEN 'rental_complete'           THEN '대여 완료 확인'
          WHEN 'reservation_cancelled'     THEN '예약 취소 확인'
          WHEN 'damage_claimed'            THEN '파손 신고 확인'
          WHEN 'hold_expired'              THEN '예약 신청 취소'
          WHEN 'locker_guide'              THEN '무인보관함 안내 확인'
          WHEN 'dhero_place_guide'         THEN '수령 위치 등록하기'
          WHEN 'tracking_notify'           THEN '배송 정보 확인'
          WHEN 'payment_cancelled_reissue' THEN '예약변경 확인'
        END
      );
  END IF;

  IF p_notify_type = 'reservation_hold' THEN
    SELECT jsonb_agg(
             jsonb_build_object('name', ro.option_name, 'qty', ro.qty)
             ORDER BY ro.created_at
           )
    INTO v_options
    FROM reservation_options ro
    WHERE ro.reservation_id = p_reservation_id;

    IF v_options IS NOT NULL THEN
      v_action_payload := v_action_payload || jsonb_build_object('options', v_options);
    END IF;
  END IF;

  -- card-custom-835: CMS 푸시알림 설정에 등록한 안내문장이 있으면 카드 본문을 그 문장으로(없으면 위 고정 문구 유지). 무인보관함 안내는 조립 문장이 정본이라 제외.
  IF p_notify_type <> 'locker_guide' THEN
    v_custom := private.card_text_override(
      p_notify_type,
      p_reservation_id,
      v_product,
      CASE WHEN v_tracking IS NOT NULL
           THEN jsonb_strip_nulls(jsonb_build_object('택배사', v_courier, '운송장번호', v_tracking))
           ELSE '{}'::jsonb END
    );
    IF v_custom IS NOT NULL THEN
      v_content := v_custom;
    END IF;
  END IF;

  v_session_id := public.find_or_create_general_chat_session(v_user_id, p_reservation_id);

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'admin', 'action_card', v_content,
    v_action_payload,
    false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id);
END;
$function$;

-- ② 묶음 카드(예약 승인 등) — 대표 상품명(+ 외 N건)을 상품명 변수로 쓴다
CREATE OR REPLACE FUNCTION public.send_rental_chat_notification_batch(p_reservation_ids bigint[], p_notify_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_session_id     UUID;
  v_content        TEXT;
  v_card_type      TEXT;
  v_items          JSONB := '[]'::jsonb;
  v_first_product  TEXT;
  v_first_code     TEXT;
  v_first_deadline DATE;
  v_first_id       BIGINT;
  v_count          INT;
  v_action_payload JSONB;
  rec              RECORD;
  -- card-custom-835
  v_custom         TEXT;
BEGIN
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약 ID가 필요합니다.');
  END IF;

  FOR rec IN
    SELECT rr.id, rr.user_id, COALESCE(ppar.name, p.name) AS product_name, rr.end_date::DATE AS end_date,
           COALESCE(rr.reservation_code, 'CZ-' || LPAD(rr.id::TEXT, 5, '0')) AS code
    FROM rental_reservations rr
    JOIN products p ON p.id = rr.product_id LEFT JOIN products ppar ON ppar.id = p.parent_product_id
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
      v_first_id       := rec.id;
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
    WHEN p_notify_type = 'hold_expired' AND v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN p_notify_type = 'hold_expired'
      THEN v_first_product || ' 예약 신청이 시간 초과로 취소되었습니다. 다시 예약해 주세요'
    WHEN v_count > 1
      THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건 알림'
    ELSE v_first_product || ' 알림'
  END;

  -- card-custom-835: 등록한 안내문장이 있으면 본문 교체(상품명 = 대표 상품명 [외 N건])
  v_custom := private.card_text_override(
    p_notify_type,
    v_first_id,
    CASE WHEN v_count > 1 THEN v_first_product || ' 외 ' || (v_count - 1)::TEXT || '건' ELSE v_first_product END,
    '{}'::jsonb
  );
  IF v_custom IS NOT NULL THEN
    v_content := v_custom;
  END IF;

  v_card_type := CASE
    WHEN p_notify_type = 'hold_expired' THEN 'RESERVATION_STATUS_CARD'
    ELSE p_notify_type
  END;

  v_action_payload := jsonb_build_object(
    'type',            v_card_type,
    'reservation_no',  v_first_code,
    'product_name',    v_first_product,
    'return_deadline', v_first_deadline::TEXT,
    'items',           v_items,
    'action_url',      '/account/rental'
  );

  IF p_notify_type = 'hold_expired' THEN
    v_action_payload := v_action_payload || jsonb_build_object('button_label', '예약 신청 취소');
  END IF;

  v_session_id := public.find_or_create_general_chat_session(v_user_id, v_first_id);

  INSERT INTO chat_messages (
    session_id, sender_type, message_type, content, action_payload, is_read
  ) VALUES (
    v_session_id, 'admin', 'action_card', v_content, v_action_payload, false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id, 'count', v_count);
END;
$function$;

-- ③ 연체료 결제 요청 카드 — 연체료 변수 지원
CREATE OR REPLACE FUNCTION public.notify_late_fee_payment_request(p_late_fee_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fee         RECORD;
  v_user_id     UUID;
  v_session_id  UUID;
  v_content     TEXT;
BEGIN
  SELECT lf.id, lf.reservation_id, lf.fee_amount, lf.hours_late
  INTO   v_fee
  FROM   late_fees lf
  WHERE  lf.id = p_late_fee_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT rr.user_id INTO v_user_id
  FROM   rental_reservations rr
  WHERE  rr.id = v_fee.reservation_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  v_session_id := public.find_or_create_general_chat_session(v_user_id, v_fee.reservation_id);

  -- card-custom-835: 등록한 안내문장이 있으면 그 문장(변수: 고객이름·상품명·예약코드·연체료), 없으면 기존 '연체료 결제 요청'
  v_content := COALESCE(
    private.card_text_override(
      'late_fee_request',
      v_fee.reservation_id,
      NULL,
      jsonb_build_object('연체료', to_char(v_fee.fee_amount, 'FM999,999,999,990') || '원')
    ),
    '연체료 결제 요청'
  );

  INSERT INTO chat_messages (
    session_id,
    sender_type,
    content,
    message_type,
    action_payload,
    is_read
  ) VALUES (
    v_session_id,
    'admin',
    v_content,
    'action_card',
    jsonb_build_object(
      'type',         'PAYMENT_REQUEST_CARD',
      'late_fee_id',  p_late_fee_id::TEXT,
      'fee_amount',   v_fee.fee_amount,
      'hours_late',   v_fee.hours_late,
      'action_url',   '/pay/late-fee/' || p_late_fee_id::TEXT
    ),
    false
  );

  UPDATE chat_sessions SET updated_at = NOW() WHERE id = v_session_id;
END;
$function$;
