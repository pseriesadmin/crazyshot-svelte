-- Migration #660: 실물 풀(부모 상품) 단위 advisory lock — 메인·결합·옵션 배정이 같은 실물을 동시에 잡는 경합 차단
-- 2026-10-06 | sp3-qa-agent 3차 검수 MINOR-1 후속(Stephen 지시 "MINOR-1 경합 상품 단위 잠금 진행") |
-- TDD: src/__tests__/services/unitPoolLockRace.test.ts (L1~L3 부하 + 구조)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 원인: 배정 경로들은 후보 상품 행을 FOR UPDATE SKIP LOCKED로 잠그지만, 상대 트랜잭션이 이미 커밋을 끝낸 뒤 늦게 도착한 쪽은
--       "자기 문장 시작 시점의 스냅샷"으로 점유를 판정해 방금 커밋된 상대 배정을 못 볼 수 있다(READ COMMITTED).
--       적용 전 부하 테스트에서 메인↔옵션(L1)·패키지↔단독 메인(L3) 이중 점유가 실제로 재현됐다.
-- 수정: private.lock_unit_pools(uuid[]) — 부모 상품(실물 풀) 단위 pg_try_advisory_xact_lock을 "정렬·중복 제거 순서"로 잡는다.
--       같은 풀을 만지는 배정 경로가 직렬화되어 뒤에 온 쪽은 잠금을 얻은 뒤의 새 문장에서 상대의 커밋된 점유를 본다.
--       · 교착 방지: 한 호출에서 여러 풀을 잡을 땐 항상 uuid 오름차순. 각 경로는 필요한 풀을 "한 번에 미리" 잡는다.
--       · 무한 대기 방지: 풀당 최대 약 5초(50ms × 100회) 재시도 후 예외 — 호출 함수가 오류 문구로 반환(옵션 배정은 best-effort라 저장은 유지).
-- 적용 경로(6개, 라이브 정의에서 정확히 1곳만 치환 — 일치≠1이면 롤백, 이미 lock_unit_pools가 있으면 건너뜀=멱등):
--   ① create_hold_reservation   — {패키지 풀, 결합 구성품 풀들}   ② promote_draft_reservation — 동일
--   ③ cms_reassign_reservation_product_code(#653·#657) — {새 메인의 풀, 이 예약의 결합 구성품 풀들}
--   ④ cms_reassign_bundle_asset(#652) — {결합 풀}   ⑤ cms_reassign_option_asset(#654) — {옵션 풀}
--   ⑥ private.assign_option_assets(#654) — {이 예약 옵션들의 풀} (set_reservation_options 끝 배정·관리자 보정 공통)
--   assign_bundle_assets는 ①②에서만 호출되고 두 경로가 결합 풀을 이미 잡으므로 별도 잠금 불필요.
-- 락 순서 원칙: 예약 행 FOR UPDATE → 풀 잠금 → 후보 상품 행. (create_hold는 새 예약 행을 만들기 전에 풀을 잡는다.)
-- ROLLBACK: 6개 함수에서 추가한 `PERFORM private.lock_unit_pools(...)` 문장을 제거하고 private.lock_unit_pools를 DROP.

CREATE OR REPLACE FUNCTION private.lock_unit_pools(p_pools uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_id  uuid;
  v_try integer;
BEGIN
  FOR v_id IN
    SELECT DISTINCT u FROM unnest(p_pools) AS u WHERE u IS NOT NULL ORDER BY u
  LOOP
    v_try := 0;
    WHILE NOT pg_try_advisory_xact_lock(hashtextextended('unit_pool:' || v_id::text, 0)) LOOP
      v_try := v_try + 1;
      IF v_try >= 100 THEN
        RAISE EXCEPTION '같은 상품의 재고를 다른 요청이 처리 중입니다. 잠시 후 다시 시도해주세요.';
      END IF;
      PERFORM pg_sleep(0.05);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.lock_unit_pools(uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pg_temp.patch_fn(p_sig regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text;
  v_cnt int;
BEGIN
  v_def := pg_get_functiondef(p_sig);
  IF position('lock_unit_pools' in v_def) > 0 THEN
    RETURN;  -- 멱등: 이미 반영됨
  END IF;
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'patch_fn(%): 치환 대상이 %회 일치(1회여야 함) — 정의가 예상과 다름', p_sig::text, v_cnt;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ① create_hold_reservation — 패키지 풀 + 결합 구성품 풀들을 미리 한 번에
SELECT pg_temp.patch_fn(
  'public.create_hold_reservation(uuid, date, date, text, text)'::regprocedure,
  $o$  SELECT COALESCE(sale_only, false) INTO v_parent_sale FROM products WHERE id = p_product_id;$o$,
  $n$  PERFORM private.lock_unit_pools(
    ARRAY[p_product_id] || COALESCE(
      (SELECT array_agg(pbl.bundle_product_id) FROM product_bundle_links pbl
        WHERE pbl.product_id = p_product_id AND pbl.deleted_at IS NULL),
      ARRAY[]::uuid[])
  );

  SELECT COALESCE(sale_only, false) INTO v_parent_sale FROM products WHERE id = p_product_id;$n$
);

-- ② promote_draft_reservation
SELECT pg_temp.patch_fn(
  'public.promote_draft_reservation(bigint, date, date, text, text)'::regprocedure,
  $o$  SELECT COALESCE(sale_only, false) INTO v_parent_sale FROM products WHERE id = v_parent_id;$o$,
  $n$  PERFORM private.lock_unit_pools(
    ARRAY[v_parent_id] || COALESCE(
      (SELECT array_agg(pbl.bundle_product_id) FROM product_bundle_links pbl
        WHERE pbl.product_id = v_parent_id AND pbl.deleted_at IS NULL),
      ARRAY[]::uuid[])
  );

  SELECT COALESCE(sale_only, false) INTO v_parent_sale FROM products WHERE id = v_parent_id;$n$
);

-- ③ cms_reassign_reservation_product_code — 새 메인의 풀 + 이 예약의 결합 구성품 풀들(#653 자동 재배정이 만지는 풀)
SELECT pg_temp.patch_fn(
  'public.cms_reassign_reservation_product_code(bigint, uuid)'::regprocedure,
  $o$  SELECT p.id INTO v_available
$o$,
  $n$  PERFORM private.lock_unit_pools(
    ARRAY[v_new_parent] || COALESCE(
      (SELECT array_agg(a.bundle_product_id) FROM reservation_bundle_assets a WHERE a.reservation_id = p_reservation_id),
      ARRAY[]::uuid[])
  );

  SELECT p.id INTO v_available
$n$
);

-- ④ cms_reassign_bundle_asset — 결합 풀
SELECT pg_temp.patch_fn(
  'public.cms_reassign_bundle_asset(bigint, uuid, uuid)'::regprocedure,
  $o$  SELECT COALESCE(bp.sale_only, false) INTO v_sale FROM products bp WHERE bp.id = p_bundle_product_id;$o$,
  $n$  PERFORM private.lock_unit_pools(ARRAY[p_bundle_product_id]);

  SELECT COALESCE(bp.sale_only, false) INTO v_sale FROM products bp WHERE bp.id = p_bundle_product_id;$n$
);

-- ⑤ cms_reassign_option_asset — 옵션 풀
SELECT pg_temp.patch_fn(
  'public.cms_reassign_option_asset(bigint, bigint, uuid)'::regprocedure,
  $o$  IF v_cur_asset = p_new_asset_id THEN$o$,
  $n$  PERFORM private.lock_unit_pools(ARRAY[v_parent]);

  IF v_cur_asset = p_new_asset_id THEN$n$
);

-- ⑥ private.assign_option_assets — 이 예약 옵션들의 풀(정렬은 lock_unit_pools가 담당)
SELECT pg_temp.patch_fn(
  'private.assign_option_assets(bigint)'::regprocedure,
  $o$    RETURN;
  END IF;

  FOR v_opt IN$o$,
  $n$    RETURN;
  END IF;

  PERFORM private.lock_unit_pools(ARRAY(
    SELECT DISTINCT COALESCE(p0.parent_product_id, p0.id)
      FROM reservation_options ro0
      JOIN products p0 ON p0.id = ro0.option_product_id
     WHERE ro0.reservation_id = p_reservation_id
  ));

  FOR v_opt IN$n$
);
