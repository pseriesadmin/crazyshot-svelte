-- Migration #789: 연체료 — ① 관리자 결제 확인 감사로그 허용값 ② 연체 감지 함수의 재감지 충돌 수정
--
-- ① cms_admin_audit_log.action_type 에 'late_fee_confirm' 추가(기존 값 전부 유지). 금액이 걸린 수동 결제 확인을 감사로그에 남긴다.
--
-- ② auto_detect_late_fees()(#269) 결함 수정 — late_fees 에는 reservation_id UNIQUE 인덱스(late_fees_reservation_id_key)가 있어 예약당 1건만 가능한데,
--    함수는 "미납(is_paid=false) 연체료가 없는 예약"만 제외했다. 이미 결제된 연체료가 있고 아직 반납 전인 예약은 다음 pg_cron 실행 때 다시 대상이 되어
--    INSERT 가 고유 제약 위반을 일으키고, 함수에 예외 처리가 없어 그날 연체 감지 전체가 롤백됐다(관리자 [결제 확인]이 생기면 더 자주 발생).
--    수정: "연체료 행이 한 번이라도 있는 예약"은 제외(예약당 1건 정책과 일치). 나머지 본문(KST 기준일·요금 조회·즉시 요청카드)은 #269 그대로다.
--    ※ 결제 후에도 연체가 계속되는 추가 연체료는 만들지 않는다(기존 구조도 예약당 1건이라 만들 수 없었다).
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.

ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check CHECK (action_type = ANY (ARRAY[
  'role_change','create','delete','suspend','menu_permission_change','concurrent_login_change','session_limit_change','name_change',
  'password_recovery_issued','password_recovery_completed','doc_view','crazychat_setting_change','push_message_change','nlsearch_setting_change',
  'login_new_environment','late_fee_confirm'
]::text[]));

CREATE OR REPLACE FUNCTION public.auto_detect_late_fees()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation   RECORD;
  v_late_fee_rate NUMERIC;
  v_hours_late    INT;
  v_fee_amount    NUMERIC;
  v_new_fee_id    UUID;
BEGIN
  FOR v_reservation IN
    SELECT
      rr.id,
      rr.end_date,
      rr.product_id
    FROM rental_reservations rr
    WHERE rr.end_date < (NOW() AT TIME ZONE 'Asia/Seoul')::DATE
      AND rr.status NOT IN ('returned', 'completed', 'cancelled', 'damage_claimed')
      -- 중복방지: 연체료가 한 번이라도 있는 예약 제외(예약당 최대 1건 — late_fees.reservation_id UNIQUE 와 일치, 결제 완료 건 재감지 충돌 방지)
      AND NOT EXISTS (
        SELECT 1
        FROM   late_fees lf
        WHERE  lf.reservation_id = rr.id
      )
  LOOP
    v_hours_late := FLOOR(
      EXTRACT(EPOCH FROM (NOW() - (v_reservation.end_date::TIMESTAMP))) / 3600
    )::INT;

    SELECT pr.late_fee_per_hour
    INTO   v_late_fee_rate
    FROM   price_rules pr
    JOIN   products p ON p.id = pr.product_id
    WHERE  (
      pr.product_id = COALESCE(
        (SELECT parent_product_id FROM products WHERE id = v_reservation.product_id),
        v_reservation.product_id
      )
    )
      AND pr.duration_type  = '24h'
      AND pr.is_active      = true
      AND pr.deleted_at     IS NULL
    LIMIT 1;

    IF v_late_fee_rate IS NULL OR v_late_fee_rate = 0 THEN
      CONTINUE;
    END IF;

    v_fee_amount := v_hours_late * v_late_fee_rate;

    INSERT INTO late_fees (
      reservation_id,
      hours_late,
      fee_amount,
      is_paid
    ) VALUES (
      v_reservation.id,
      v_hours_late,
      v_fee_amount,
      false
    )
    RETURNING id INTO v_new_fee_id;

    PERFORM public.notify_late_fee_payment_request(v_new_fee_id);
  END LOOP;
END;
$$;

-- pg_cron 전용 — #269 와 같은 권한(PUBLIC·anon·authenticated 회수)을 다시 명시한다(CREATE OR REPLACE 는 권한을 유지하지만 확인용으로 재선언)
REVOKE ALL ON FUNCTION public.auto_detect_late_fees() FROM PUBLIC, anon, authenticated;

-- rollback(late_fee_confirm 기록이 없을 때만 CHECK 를 되돌릴 수 있다):
--   감사로그 CHECK: #762 정의로 재생성 / 함수: #269 의 auto_detect_late_fees 본문으로 복원
