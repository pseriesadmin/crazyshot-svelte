-- Migration #412: production DB에서 누락된 promote_draft_reservation 복구 + set_reservation_options draft 허용
--
-- 배경(2026-09-01, Stephen 실사용 보고 — "로컬(stage)에서는 재고 경고가 없는데 실서버는 왜 그렇지?"):
-- 장바구니에서 상품에 옵션을 담고 "예약신청"을 누르면 실서버(production)에서만 매 상품·매번
-- "해당 기간에 예약 가능한 재고가 없습니다." 토스트가 뜨며 다음 단계로 진행이 안 되는 결함.
--
-- 근본 원인(직접 SQL 조회로 확인):
--   Migration #179(20260731000179_draft_reservation_no_date.sql, "날짜 미정 임시예약")가
--   stage(ezyvffjvuwmtuhpxdjrw)에는 원본 그대로 적용돼 있으나, production(vnbpmvxruyciuuaermyh)의
--   마이그레이션 이력에는 애초에 존재하지 않는다 — Migration #315
--   (20260820040000_315_production_draft_reservation_schema_sync.sql)가 2026-08-20에
--   "Migration 179가 production에 부분 적용된 상태"를 발견하고 STEP 1(nullable)·STEP 3(EXCLUDE
--   제약 draft 제외)만 재적용했으나, STEP 5(promote_draft_reservation 함수 생성)는 그 조사 범위에
--   포함되지 않아 여전히 누락된 채로 남아 있었다.
--   (STEP 4의 create_draft_reservation과 STEP 2의 status CHECK는 그 이전에 이미 어떤 경로로든
--    production에 반영돼 있었음 — pg_proc·pg_constraint 직접 조회로 확인. 정확한 반영 경위는
--    마이그레이션 이력에 남아있지 않아 특정 불가하나, 결과적으로 STEP 5만 홀로 누락된 상태였음.)
--
-- 실패 메커니즘: `promote_draft_reservation` RPC 자체가 production에 없으므로 호출 시
-- PostgREST가 "함수를 찾을 수 없음" 에러를 반환한다. 클라이언트(src/routes/cart/+page.svelte)는
-- `const { data: promoteRows } = await supabase.rpc(...)`로 `error`를 구조분해 없이 버리고
-- `promoteRows`(null)만 사용하므로, `promoteRow = promoteRows?.[0]`가 undefined가 되고
-- `promoteRow?.success`도 undefined(falsy) → `csToast.error(promoteRow?.error_message ??
-- '해당 기간에 예약 가능한 재고가 없습니다.')`의 기본 안내문구가 표시된다. 즉 실제 재고 문제가
-- 아니라 RPC 미존재로 인한 항상-실패였다 — 어떤 상품을 담아도, 매번 재현되는 이유가 이것이다.
-- (rental_reservations에 status='draft', start_date/end_date=NULL로 멈춰있는 실제 행 3건
--  (id 86·87·88, 2026-09-01 생성)이 이 실패의 직접 증거로 남아있었다.)
--
-- 부수 발견: set_reservation_options도 production에서는 status='hold'만 허용하도록 남아있어
-- (Migration #179 STEP 6 미반영), draft 단계에서 옵션을 담아도 조용히 무시되는 2차 결함이
-- 함께 존재했다. promote 이전(draft 상태) 시점에 옵션을 저장하는 정상 흐름과 맞지 않으므로
-- 이 마이그레이션에서 함께 STEP 6도 반영한다.
--
-- calculate_cart_total은 production에서 이미 #179 이후로 더 발전한 버전
-- (compute_reservation_line_amount 위임)으로 교체돼 있고, start_date/end_date IS NOT NULL
-- 조건으로 draft 행을 이미 안전하게 제외하고 있어 — 이 마이그레이션에서 건드리지 않는다.
--
-- 이 파일은 #179 STEP 5·STEP 6과 완전히 동일한 함수 정의를 재적용한다(내용 변경 없음,
-- CREATE OR REPLACE). stage는 이미 동일 정의가 있어 no-op, production에서만 실질 반영된다.

-- STEP 5 (179 원본과 동일): promote_draft_reservation — 체크아웃에서 날짜 확정 시 draft → hold 승격
CREATE OR REPLACE FUNCTION public.promote_draft_reservation(
  p_reservation_id BIGINT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(success BOOLEAN, reservation_id BIGINT, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_parent_id UUID;
  v_unit_id   UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '로그인이 필요합니다.';
    RETURN;
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '대여 기간을 올바르게 입력해주세요.';
    RETURN;
  END IF;

  SELECT product_id INTO v_parent_id
  FROM rental_reservations
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft'
  FOR UPDATE;

  IF v_parent_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '예약 정보를 찾을 수 없습니다.';
    RETURN;
  END IF;

  SELECT p.id INTO v_unit_id
  FROM products p
  WHERE p.parent_product_id = v_parent_id
    AND p.deleted_at IS NULL
    AND p.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM rental_reservations rr
      WHERE rr.product_id = p.id
        AND rr.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr.start_date, rr.end_date, '[]') &&
            daterange(p_start_date, p_end_date, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_unit_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, '해당 기간에 예약 가능한 재고가 없습니다.';
    RETURN;
  END IF;

  UPDATE rental_reservations
  SET product_id = v_unit_id,
      start_date = p_start_date,
      end_date   = p_end_date,
      status     = 'hold'
  WHERE id = p_reservation_id AND user_id = v_user_id AND status = 'draft';

  RETURN QUERY SELECT true, p_reservation_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false, NULL::BIGINT, SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE) TO authenticated;
-- ⚠️ anon 미부여: Migration #262(global_anon_rpc_lockdown)가 이미 이 함수명을 anon 잠금
-- 대상 목록에 포함해뒀으므로(당시엔 함수 자체가 없어 no-op였음) 신규 생성 시점부터 동일하게
-- authenticated 전용으로 맞춘다 — stage의 실제 권한 상태와 일치.

-- STEP 6 (179 원본과 동일): set_reservation_options — draft 상태에서도 옵션+수량 저장 허용
CREATE OR REPLACE FUNCTION public.set_reservation_options(p_reservation_id bigint, p_options jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rental_reservations
    WHERE id = p_reservation_id AND user_id = auth.uid() AND status IN ('draft', 'hold')
  ) THEN
    RETURN;
  END IF;

  DELETE FROM reservation_options WHERE reservation_id = p_reservation_id;

  INSERT INTO reservation_options (reservation_id, option_product_id, option_name, qty, unit_price)
  SELECT
    p_reservation_id,
    NULLIF(elem->>'option_product_id', '')::UUID,
    elem->>'option_name',
    (elem->>'qty')::INTEGER,
    COALESCE((elem->>'unit_price')::NUMERIC, 0)
  FROM jsonb_array_elements(p_options) AS elem
  WHERE COALESCE((elem->>'qty')::INTEGER, 0) > 0;
END;
$function$;

-- ============================================================
-- ROLLBACK (역순 실행)
-- ============================================================
-- 1. set_reservation_options을 status = 'hold' 단독 조건으로 되돌림(#179 이전 정의)
-- 2. promote_draft_reservation을 DROP FUNCTION public.promote_draft_reservation(BIGINT, DATE, DATE)
-- ============================================================
