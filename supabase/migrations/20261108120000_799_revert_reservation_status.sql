-- Migration #799: 대여현황 단계 되돌리기 — 반납중→대여중 / 대여중→반출중(배송형) / 대여중→계약완료(방문 수령) (2026-11-08, Stephen 확정 'A안')
--
-- 배경: update_reservation_status 는 "다음 한 단계 + 취소·파손"만 허용해 잘못 넘긴 단계를 되돌릴 길이 없다. 그 함수는 건드리지 않고 되돌리기 전용 함수를 새로 둔다.
-- 범위: 반출중→계약완료 되돌리기는 제외(Stephen 지시). 반납완료 이후(returned·completed)와 취소·만료·파손 건은 대상 아님.
-- 허용표(한 번에 한 단계):
--   return_requested → in_use
--   in_use           → confirmed (pickup_method='visit' — 방문 수령은 반출중 단계가 없다) / shipped (그 외 수령 방식)
-- 차단 조건(A안):
--   ① 요청 화면이 보던 상태(p_expected_status)와 실제 상태가 다르면 거절(다른 관리자가 먼저 바꾼 경우)
--   ② 연체료(late_fees) 행이 있는 예약 — 금액이 걸린 기록과 단계가 어긋나지 않게
--   ③ 반납 검수 이슈(reservation_inspection_issues) 행이 있는 예약
--   ④ 두발히어로 반품 접수번호(dhero_return_book_id)가 있는 반납중 예약 — 외부 접수를 먼저 정리해야 한다(자동 취소는 하지 않는다)
-- 고객 알림은 보내지 않고, 고객이 낸 반납 사진·무인함 정보는 지우지 않는다. 사유는 필수이며 대여 액션 로그(rental_action_logs)에 같은 트랜잭션으로 남긴다.
-- 감사로그(cms_admin_audit_log)에는 앱 서버가 'status_revert' 로 기록하므로 CHECK 허용값에 추가한다(기존 값 전부 유지).
-- 권한: 서버 전용(service_role). 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh). 기존 마이그레이션 파일은 수정하지 않는다.
-- ROLLBACK: DROP FUNCTION public.revert_reservation_status(bigint, text, uuid, text); 감사로그 CHECK 는 #789 정의로 복원('status_revert' 제외).

ALTER TABLE public.cms_admin_audit_log DROP CONSTRAINT IF EXISTS cms_admin_audit_log_action_type_check;
ALTER TABLE public.cms_admin_audit_log ADD CONSTRAINT cms_admin_audit_log_action_type_check CHECK (action_type = ANY (ARRAY[
  'role_change','create','delete','suspend','menu_permission_change','concurrent_login_change','session_limit_change','name_change',
  'password_recovery_issued','password_recovery_completed','doc_view','crazychat_setting_change','push_message_change','nlsearch_setting_change',
  'login_new_environment','late_fee_confirm','status_revert'
]::text[]));

CREATE OR REPLACE FUNCTION public.revert_reservation_status(
  p_reservation_id  bigint,
  p_expected_status text,
  p_admin_id        uuid,
  p_reason          text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status        TEXT;
  v_pickup_method TEXT;
  v_return_book   TEXT;
  v_user_id       UUID;
  v_target        TEXT;
  v_reason        TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF char_length(v_reason) < 2 OR char_length(v_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', '되돌리는 사유를 2자 이상 200자 이하로 입력해 주세요.');
  END IF;

  SELECT status, pickup_method, dhero_return_book_id, user_id
    INTO v_status, v_pickup_method, v_return_book, v_user_id
  FROM rental_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약을 찾을 수 없습니다.');
  END IF;

  IF v_status IS DISTINCT FROM p_expected_status THEN
    RETURN jsonb_build_object('ok', false, 'error', '예약 단계가 그 사이에 바뀌었어요. 화면을 새로고침해 현재 단계를 확인해 주세요.');
  END IF;

  v_target := CASE v_status
    WHEN 'return_requested' THEN 'in_use'
    WHEN 'in_use'           THEN CASE WHEN v_pickup_method = 'visit' THEN 'confirmed' ELSE 'shipped' END
    ELSE NULL
  END;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '이 단계는 되돌릴 수 없습니다. (반납접수·대여중 단계만 가능)');
  END IF;

  IF EXISTS (SELECT 1 FROM late_fees WHERE reservation_id = p_reservation_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', '연체료가 발생한 예약은 단계를 되돌릴 수 없습니다.');
  END IF;

  IF EXISTS (SELECT 1 FROM reservation_inspection_issues WHERE reservation_id = p_reservation_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', '검수 이슈가 등록된 예약은 단계를 되돌릴 수 없습니다.');
  END IF;

  IF v_status = 'return_requested' AND v_return_book IS NOT NULL AND btrim(v_return_book) <> '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '두발히어로 반품 접수가 되어 있습니다. 두발히어로에서 반품 접수를 먼저 정리한 뒤 되돌려 주세요.');
  END IF;

  UPDATE rental_reservations SET status = v_target, updated_at = NOW()
  WHERE id = p_reservation_id;

  INSERT INTO rental_action_logs (reservation_id, action_type, performed_by, note)
  VALUES (p_reservation_id, 'status_revert', p_admin_id, format('%s → %s | %s', v_status, v_target, v_reason));

  RETURN jsonb_build_object('ok', true, 'from', v_status, 'to', v_target, 'user_id', v_user_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.revert_reservation_status(bigint, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revert_reservation_status(bigint, text, uuid, text) TO service_role;
