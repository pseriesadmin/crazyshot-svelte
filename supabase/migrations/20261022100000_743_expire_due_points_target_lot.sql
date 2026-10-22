-- Migration 743 — expire_due_points: 소멸 거래는 "소멸된 그 적립분"에서만 차감해 재생 (2026-10-22, CRITICAL — 포인트, sp3 BLOCKER-1)
--
-- 결함(Migration #540 재생 로직): 이력을 시간순으로 되짚을 때 type='expire' 거래를 use 등 다른 차감과 똑같이
--   "가장 오래된 적립분부터" 깎았다. 소멸 거래는 이미 ref_id 에 소멸된 적립분의 id 를 갖고 있는데도 이를 쓰지 않아,
--   만료 순서가 적립 순서와 엇갈리면(예: 만료가 먼 구독 적립 S 가 더 오래되고 나중 일반 적립 G 가 먼저 만료)
--   G 의 소멸 거래가 S 를 깎고 G 는 "아직 안 깎임"으로 보여 매일 다시 소멸됐다(Stage 재현: 같은 적립분 3회 소멸).
--   #742(일반 적립 소멸 기한)로 이 엇갈림이 일상적으로 생기므로 #742 를 Production 에 켜기 전에 반드시 먼저 고친다.
-- 수정: 재생 중 type='expire' AND ref_type='point_expiry' 거래는 ref_id 가 가리키는 적립분의 잔량에서만 차감한다.
--   (가리키는 적립분을 찾지 못하면 이전 동작(오래된 순 차감)으로 폴백.) 나머지 로직·권한은 #540 과 동일.
--
-- ROLLBACK(참고용): expire_due_points 를 Migration #540 정의로 CREATE OR REPLACE 복원.

CREATE OR REPLACE FUNCTION public.expire_due_points()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id        UUID;
  v_tx             RECORD;
  v_lot            RECORD;
  v_debit          INT;
  v_take           INT;
  v_total_expired  INT := 0;
  v_users_affected INT := 0;
  v_new_balance    INT;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS tmp_point_lots (
    tx_id UUID, remaining INT, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ
  ) ON COMMIT DROP;

  FOR v_user_id IN
    SELECT DISTINCT user_id FROM public.point_transactions
    WHERE type = 'earn' AND expires_at IS NOT NULL AND expires_at < now()
  LOOP
    TRUNCATE tmp_point_lots;

    FOR v_tx IN
      SELECT id, type, amount, expires_at, created_at, ref_type, ref_id
      FROM public.point_transactions
      WHERE user_id = v_user_id
      ORDER BY created_at ASC, id ASC
    LOOP
      IF v_tx.type = 'earn' AND v_tx.expires_at IS NOT NULL THEN
        INSERT INTO tmp_point_lots VALUES (v_tx.id, v_tx.amount, v_tx.expires_at, v_tx.created_at);
      ELSIF v_tx.amount < 0 THEN
        -- 소멸 거래는 소멸된 그 적립분에서만 차감(ref_id = 적립 거래 id). 찾지 못하면 아래 FIFO 로 폴백.
        IF v_tx.type = 'expire' AND v_tx.ref_type = 'point_expiry' AND v_tx.ref_id IS NOT NULL THEN
          UPDATE tmp_point_lots
             SET remaining = GREATEST(remaining + v_tx.amount, 0)
           WHERE tx_id::text = v_tx.ref_id;
          IF FOUND THEN
            CONTINUE;
          END IF;
        END IF;

        v_debit := -v_tx.amount;
        FOR v_lot IN SELECT * FROM tmp_point_lots WHERE remaining > 0 ORDER BY created_at ASC LOOP
          EXIT WHEN v_debit <= 0;
          v_take := LEAST(v_lot.remaining, v_debit);
          UPDATE tmp_point_lots SET remaining = remaining - v_take WHERE tx_id = v_lot.tx_id;
          v_debit := v_debit - v_take;
        END LOOP;
      END IF;
    END LOOP;

    FOR v_lot IN
      SELECT * FROM tmp_point_lots WHERE remaining > 0 AND expires_at < now() ORDER BY created_at ASC
    LOOP
      UPDATE public.user_profiles
      SET points = GREATEST(points - v_lot.remaining, 0)
      WHERE id = v_user_id
      RETURNING points INTO v_new_balance;

      INSERT INTO public.point_transactions(
        user_id, type, amount, balance_after, description, ref_type, ref_id
      ) VALUES (
        v_user_id, 'expire', -v_lot.remaining, v_new_balance,
        '포인트 유효기간 만료', 'point_expiry', v_lot.tx_id::text
      );

      v_total_expired := v_total_expired + v_lot.remaining;
    END LOOP;

    v_users_affected := v_users_affected + 1;
  END LOOP;

  RETURN jsonb_build_object('users_affected', v_users_affected, 'total_expired', v_total_expired);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_due_points() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_points() TO service_role;
