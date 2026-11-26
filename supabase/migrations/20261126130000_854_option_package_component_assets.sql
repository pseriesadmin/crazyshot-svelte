-- Migration #854: 패키지 옵션의 구성품 재고 점유 (Stephen 지시, 2026-11-26)
--
-- 배경: 패키지형 상품을 옵션으로 담으면 옵션 재고 검사·실물 배정(#654)은 패키지 본체의 하위 재고만 본다.
--       메인상품이 패키지일 때는 구성품마다 실물 1개를 배정·점유(#547)하지만, 옵션 패키지는 구성품이 점유되지 않아
--       같은 기간 구성품이 다른 예약과 이중 예약될 수 있었다.
--
-- 설계: 구성품 점유 행을 reservation_option_assets 에 저장한다.
--   · via_package_product_id (신규, NULL 허용) = 이 행이 어느 패키지 옵션의 구성품인지. NULL = 기존 옵션 본체 실물 행.
--   · option_product_id = 구성품 부모 상품(재배정 후보 풀), reservation_option_id = 패키지 옵션 행.
--   기존 점유 판정(메인 신규 배정·승격·결합 자동 배정·본체 재배정·옵션 배정·가용재고·화면 후보)이 이 표를 이미 보므로(#657)
--   구성품 재고가 모든 경로에서 자동으로 차감된다. 옵션 본체 전용 로직(assign_option_assets)은 via IS NULL 행만 센다.
-- 규칙:
--   1) 패키지 옵션 1행 × qty = 구성품마다 qty건 점유(비판매 구성품만 — 판매전용 구성품은 대상 아님).
--   2) hold 상태에서 옵션 저장(set_reservation_options) 시 구성품이 모자라면 OPTION_STOCK_EXCEEDED 로 저장 전체 거부(패키지 본체 배정은 기존대로 best-effort).
--   3) draft→hold 승격(promote_draft_reservation) 시 구성품이 모자라면 승격 실패(메인 결합 구성품 부족과 같은 방식).
--   4) 관리자 보정(cms_ensure_reservation_option_assets)은 best-effort(모자라도 오류 없음). hold·confirmed 만, 반출 이후 예약은 배정하지 않음.
--   5) 점유 판정은 private.option_unit_is_free(다른 비종결 예약의 메인·결합·옵션 배정과 기간 겹침 '[]') + 같은 예약에서 이미 쓰인 실물 제외(한 실물 한 역할).
--   6) 풀 잠금(private.lock_unit_pools)을 구성품 배정 시작에서 구성품 부모 전체에 대해 오름차순으로 한 번에 잡는다(#660).
--      ※ 호출 경로 전체의 전역 정렬은 아니다 — 옵션 저장은 옵션 풀 → 구성품 풀, 승격은 메인·결합 풀 → 구성품 풀 순이라 교차 요청에서 순서가
--        뒤집힐 수 있다. lock_unit_pools 가 try-lock 으로 약 5초 재시도 후 예외를 던지므로 교착은 없고 오류("같은 상품의 재고를 다른 요청이
--        처리 중입니다")로 끝난다(fail-closed).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
-- TDD: src/__tests__/services/optionPackageComponentAssets.test.ts
--
-- ROLLBACK: 구성품 점유 행 삭제(DELETE FROM reservation_option_assets WHERE via_package_product_id IS NOT NULL) 후
--           각 함수에서 이 마이그레이션이 추가한 부분만 제거한다(이후 마이그레이션 #586·#611·#769 등 변경은 되돌리지 않는다):
--           private.assign_option_assets 의 'via_package_product_id IS NULL AND ' 조건 2곳,
--           set_reservation_options 끝의 PERFORM private.assign_option_component_assets(…, true),
--           promote_draft_reservation 의 구성품 점유 BEGIN…END 블록, cms_ensure_reservation_option_assets 의 구성품 호출 블록.
--           그 뒤 컬럼·인덱스 DROP, private.assign_option_component_assets DROP.
--           (#855 적용 뒤라면 assign_option_assets 끝의 구성품 호출 블록도 함께 제거)

-- ============================================================
-- 1. 컬럼
-- ============================================================
ALTER TABLE public.reservation_option_assets
  ADD COLUMN IF NOT EXISTS via_package_product_id UUID REFERENCES public.products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reservation_option_assets_via
  ON public.reservation_option_assets (via_package_product_id) WHERE via_package_product_id IS NOT NULL;

-- ============================================================
-- 2. 구성품 점유 배정
-- ============================================================
CREATE OR REPLACE FUNCTION private.assign_option_component_assets(p_reservation_id bigint, p_strict boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_status TEXT;
  v_start  DATE;
  v_end    DATE;
  v_opt    RECORD;
  v_comp   RECORD;
  v_have   INTEGER;
  v_need   INTEGER;
  v_cand   UUID;
BEGIN
  SELECT status, start_date, end_date INTO v_status, v_start, v_end
    FROM rental_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF v_status IS NULL OR v_status NOT IN ('hold', 'confirmed') OR v_start IS NULL OR v_end IS NULL THEN
    RETURN;
  END IF;

  -- 구성품 부모 풀 전체를 오름차순으로 한 번에 잡는다(교착 방지, #660)
  PERFORM private.lock_unit_pools(ARRAY(
    SELECT DISTINCT pbl.bundle_product_id
      FROM reservation_options ro0
      JOIN products p0 ON p0.id = ro0.option_product_id
      JOIN product_bundle_links pbl ON pbl.product_id = COALESCE(p0.parent_product_id, p0.id) AND pbl.deleted_at IS NULL
     WHERE ro0.reservation_id = p_reservation_id
  ));

  FOR v_opt IN
    SELECT ro.id AS option_id, ro.qty, COALESCE(p.parent_product_id, p.id) AS pkg_id
      FROM reservation_options ro
      JOIN products p ON p.id = ro.option_product_id
      LEFT JOIN products par ON par.id = p.parent_product_id
     WHERE ro.reservation_id = p_reservation_id
       AND ro.qty > 0
       AND NOT COALESCE(par.sale_only, p.sale_only, false)
       AND EXISTS (SELECT 1 FROM product_bundle_links b WHERE b.product_id = COALESCE(p.parent_product_id, p.id) AND b.deleted_at IS NULL)
     ORDER BY ro.id
  LOOP
    FOR v_comp IN
      SELECT pbl.bundle_product_id AS comp_id
        FROM product_bundle_links pbl
        JOIN products bp ON bp.id = pbl.bundle_product_id AND bp.deleted_at IS NULL
       WHERE pbl.product_id = v_opt.pkg_id
         AND pbl.deleted_at IS NULL
         AND NOT COALESCE(bp.sale_only, false)
       ORDER BY pbl.display_order, pbl.bundle_product_id
    LOOP
      SELECT COUNT(*) INTO v_have
        FROM reservation_option_assets
       WHERE reservation_option_id = v_opt.option_id
         AND via_package_product_id = v_opt.pkg_id
         AND option_product_id = v_comp.comp_id;

      IF v_have > v_opt.qty THEN
        DELETE FROM reservation_option_assets
         WHERE id IN (SELECT id FROM reservation_option_assets
                       WHERE reservation_option_id = v_opt.option_id
                         AND via_package_product_id = v_opt.pkg_id
                         AND option_product_id = v_comp.comp_id
                       ORDER BY id DESC LIMIT (v_have - v_opt.qty));
        v_have := v_opt.qty;
      END IF;

      v_need := v_opt.qty - v_have;
      CONTINUE WHEN v_need <= 0;

      FOR v_cand IN
        SELECT c.id
          FROM products c
         WHERE c.parent_product_id = v_comp.comp_id
           AND c.deleted_at IS NULL
           AND c.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM reservation_option_assets x
              WHERE x.reservation_id = p_reservation_id AND x.asset_product_id = c.id
           )
         ORDER BY c.created_at, c.id
         FOR UPDATE SKIP LOCKED
      LOOP
        IF private.option_unit_is_free(v_cand, v_start, v_end, p_reservation_id) THEN
          INSERT INTO reservation_option_assets (reservation_id, reservation_option_id, option_product_id, asset_product_id, via_package_product_id)
          VALUES (p_reservation_id, v_opt.option_id, v_comp.comp_id, v_cand, v_opt.pkg_id);
          v_need := v_need - 1;
          EXIT WHEN v_need = 0;
        END IF;
      END LOOP;

      IF v_need > 0 AND p_strict THEN
        RAISE EXCEPTION 'OPTION_STOCK_EXCEEDED:%', v_opt.pkg_id;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION private.assign_option_component_assets(bigint, boolean) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. 기존 함수 보정 — 라이브 정의에서 정확히 1곳(또는 명시한 횟수)만 치환(불일치 시 롤백, 멱등)
-- ============================================================
DO $do$
DECLARE
  v_def  TEXT;
  v_new  TEXT;
  v_cnt  INTEGER;
BEGIN
  -- (a) private.assign_option_assets — 옵션 본체 실물만 센다(구성품 점유 행 제외)
  v_def := pg_get_functiondef('private.assign_option_assets(bigint)'::regprocedure);
  IF position('via_package_product_id IS NULL' IN v_def) = 0 THEN
    v_cnt := (length(v_def) - length(replace(v_def, 'WHERE reservation_option_id = v_opt.option_id', ''))) / length('WHERE reservation_option_id = v_opt.option_id');
    IF v_cnt <> 2 THEN
      RAISE EXCEPTION '854: assign_option_assets 치환 대상 % 곳(기대 2곳) — 정의가 달라졌습니다', v_cnt;
    END IF;
    v_new := replace(v_def, 'WHERE reservation_option_id = v_opt.option_id', 'WHERE via_package_product_id IS NULL AND reservation_option_id = v_opt.option_id');
    EXECUTE v_new;
  END IF;

  -- (b) set_reservation_options — 옵션 저장 끝에서 구성품 점유(엄격). 부족하면 OPTION_STOCK_EXCEEDED 로 저장 전체 롤백
  v_def := pg_get_functiondef('public.set_reservation_options(bigint,jsonb)'::regprocedure);
  IF position('assign_option_component_assets' IN v_def) = 0 THEN
    v_cnt := (length(v_def) - length(replace(v_def, 'PERFORM private.assign_option_assets(p_reservation_id);', ''))) / length('PERFORM private.assign_option_assets(p_reservation_id);');
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '854: set_reservation_options 치환 대상 % 곳(기대 1곳) — 정의가 달라졌습니다', v_cnt;
    END IF;
    v_new := regexp_replace(
      v_def,
      '(PERFORM private\.assign_option_assets\(p_reservation_id\);\s*EXCEPTION WHEN OTHERS THEN\s*NULL;\s*END;)',
      E'\\1\n\n  PERFORM private.assign_option_component_assets(p_reservation_id, true);'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION '854: set_reservation_options 본문 패턴을 찾지 못했습니다';
    END IF;
    EXECUTE v_new;
  END IF;

  -- (c) promote_draft_reservation — 승격 직후(메인 결합 구성품 배정 다음) 구성품 점유. 부족하면 승격 실패
  v_def := pg_get_functiondef('public.promote_draft_reservation(bigint,date,date,text,text)'::regprocedure);
  IF position('assign_option_component_assets' IN v_def) = 0 THEN
    v_cnt := (length(v_def) - length(replace(v_def, 'PERFORM assign_bundle_assets(p_reservation_id, v_parent_id, v_effective_start, v_effective_end);', ''))) / length('PERFORM assign_bundle_assets(p_reservation_id, v_parent_id, v_effective_start, v_effective_end);');
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '854: promote_draft_reservation 치환 대상 % 곳(기대 1곳) — 정의가 달라졌습니다', v_cnt;
    END IF;
    v_new := replace(
      v_def,
      'PERFORM assign_bundle_assets(p_reservation_id, v_parent_id, v_effective_start, v_effective_end);',
      E'PERFORM assign_bundle_assets(p_reservation_id, v_parent_id, v_effective_start, v_effective_end);\n\n'
      || E'  BEGIN\n'
      || E'    PERFORM private.assign_option_component_assets(p_reservation_id, true);\n'
      || E'  EXCEPTION WHEN OTHERS THEN\n'
      || E'    IF SQLERRM LIKE ''OPTION_STOCK_EXCEEDED%'' THEN\n'
      || E'      RAISE EXCEPTION ''옵션 패키지의 구성품 재고가 부족해 예약할 수 없습니다.'';\n'
      || E'    END IF;\n'
      || E'    RAISE;\n'
      || E'  END;'
    );
    EXECUTE v_new;
  END IF;
END
$do$;

-- (d) 관리자 보정 — 본체 배정 뒤 구성품 점유도 best-effort 로 채운다
CREATE OR REPLACE FUNCTION public.cms_ensure_reservation_option_assets(p_reservation_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM private.assign_option_assets(p_reservation_id);
  BEGIN
    PERFORM private.assign_option_component_assets(p_reservation_id, false);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;
