-- Migration #366: request_account_withdrawal RPC 신설
--
-- .claude/harness/TASK.md "마이페이지 회원 탈퇴('탈회') 기능 신설" T2
-- 상세설계: /Users/stevenmac/.claude/plans/dazzling-sauteeing-aurora.md §2-①
-- 의존: Migration #365(withdrawal_columns) 적용 완료 필수
--
-- 목적: 로그인한 회원이 스스로 탈퇴를 신청하는 RPC.
--   - 진행중 대여(hold/confirmed/shipped/in_use/return_requested) 존재 시 차단.
--   - 이미 requested 상태이면 중복 신청 차단(idempotent safe).
--   - 통과 시 withdrawal_status='requested', purge_at=now()+30일 세팅.
--
-- 보안 패턴(이 프로젝트 재발사고 방지 — 신규 함수 전부 예외 없이 준수):
--   SECURITY DEFINER SET search_path='public'
--   같은 파일 내 REVOKE ALL FROM PUBLIC, anon, authenticated
--   이후 GRANT EXECUTE TO authenticated (anon 절대 포함 금지)
--
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot production(vnbpmvxruyciuuaermyh)
-- 2026-08-28

CREATE OR REPLACE FUNCTION public.request_account_withdrawal(
  p_reasons     TEXT[],
  p_reason_etc  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid                 UUID;
  v_withdrawal_status   TEXT;
  v_has_active_rental   BOOLEAN;
  v_reason_etc_trimmed  TEXT;
  v_purge_at            TIMESTAMPTZ;
BEGIN
  -- ① 로그인 필수 체크 ─────────────────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', '로그인이 필요합니다.'
    );
  END IF;

  -- ② p_reasons 유효성 검증 ────────────────────────────────────────────────────
  -- 2a. 비어있지 않아야 함
  IF p_reasons IS NULL
     OR array_length(p_reasons, 1) IS NULL
     OR array_length(p_reasons, 1) = 0
  THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '탈퇴 사유를 하나 이상 선택해 주세요.',
      'error_code', 'invalid_reasons'
    );
  END IF;

  -- 2b. 각 항목이 허용된 5개 코드의 부분집합인지 확인
  IF EXISTS (
    SELECT 1 FROM unnest(p_reasons) AS r(code)
    WHERE r.code NOT IN (
      'no_longer_use', 'lack_of_options', 'complex_process',
      'using_other_service', 'etc'
    )
  ) THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '올바르지 않은 탈퇴 사유 코드입니다.',
      'error_code', 'invalid_reasons'
    );
  END IF;

  -- 2c. 'etc' 포함 시 p_reason_etc 필수 (트림 후 1~300자)
  IF 'etc' = ANY(p_reasons) THEN
    v_reason_etc_trimmed := trim(p_reason_etc);
    IF v_reason_etc_trimmed IS NULL OR length(v_reason_etc_trimmed) = 0 THEN
      RETURN jsonb_build_object(
        'ok',         false,
        'error',      '기타 사유를 입력해 주세요.',
        'error_code', 'etc_required'
      );
    END IF;
    IF length(v_reason_etc_trimmed) > 300 THEN
      RETURN jsonb_build_object(
        'ok',         false,
        'error',      '기타 사유는 300자 이내로 입력해 주세요.',
        'error_code', 'etc_too_long'
      );
    END IF;
  ELSE
    v_reason_etc_trimmed := NULL;
  END IF;

  -- ③ 이미 탈퇴 신청 상태인지 확인 ────────────────────────────────────────────
  SELECT withdrawal_status
    INTO v_withdrawal_status
    FROM user_profiles
   WHERE id = v_uid;

  IF v_withdrawal_status = 'requested' THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '이미 탈퇴가 신청된 계정입니다.',
      'error_code', 'already_requested'
    );
  END IF;

  -- ④ 진행중 대여 체크 (rental-lifecycle.md 상태머신 기준) ───────────────────
  --    hold/confirmed/shipped/in_use/return_requested → 재고·계약·배송 진행 중
  --    returned/completed/cancelled/expired → 종결 상태, 차단 대상 아님
  SELECT EXISTS (
    SELECT 1
      FROM rental_reservations
     WHERE user_id = v_uid
       AND status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested')
  ) INTO v_has_active_rental;

  IF v_has_active_rental THEN
    RETURN jsonb_build_object(
      'ok',         false,
      'error',      '진행 중인 대여를 먼저 완료해 주세요.',
      'error_code', 'active_rental_exists'
    );
  END IF;

  -- ⑤ 탈퇴 신청 처리 ──────────────────────────────────────────────────────────
  v_purge_at := now() + INTERVAL '30 days';

  UPDATE user_profiles
     SET withdrawal_status       = 'requested',
         withdrawal_requested_at = now(),
         withdrawal_purge_at     = v_purge_at,
         withdrawal_reasons      = p_reasons,
         withdrawal_reason_etc   = v_reason_etc_trimmed,
         updated_at              = now()
   WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok',      true,
    'purge_at', v_purge_at
  );
END;
$$;

-- ── 권한 설정 (REVOKE → GRANT 순서 고정, 이 프로젝트 재발사고 방지 필수) ──────
-- Migration #364 get_customer_list_revoke_fix.sql 재발사고 클래스:
--   같은 파일 안에서 REVOKE 후 GRANT 순서를 항상 지킨다.
REVOKE ALL ON FUNCTION public.request_account_withdrawal(TEXT[], TEXT)
  FROM PUBLIC, anon, authenticated;

-- anon은 포함하지 않음 — 로그인 필요 기능이므로 authenticated만 허용
GRANT EXECUTE ON FUNCTION public.request_account_withdrawal(TEXT[], TEXT)
  TO authenticated;
