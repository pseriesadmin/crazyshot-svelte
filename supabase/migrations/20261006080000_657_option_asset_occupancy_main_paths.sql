-- Migration #657: 옵션 배정(reservation_option_assets) 점유를 메인 신규 배정·승격·결합 자동 배정·본체 재배정·가용재고 집계도 보게 한다
-- 2026-10-06 | sp3-qa-agent 2차 검수 MAJOR-1 후속(Stephen 지시 "MAJOR-1 후속 마이그레이션 진행") |
-- TDD: src/__tests__/services/optionAssetOccupancyMainPaths.test.ts (O1~O10)
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh)
--
-- 배경: #654가 옵션 실물 배정을 도입했지만, 아래 경로는 옵션 배정을 점유로 보지 않아 같은 기간에 같은 실물이 옵션과 메인/결합으로
--       이중 배정될 수 있었다("옵션이 먼저 배정 → 메인/결합이 나중에 배정" 방향. 반대 방향은 option_unit_is_free가 이미 막음).
-- 대상 5개 함수(Stage·Production 현행 정의 해시 동일 확인 후 작성):
--   ① create_hold_reservation   ② promote_draft_reservation   — 메인 실물 선택 쿼리에 옵션 배정 NOT EXISTS 추가
--   ③ assign_bundle_assets      — 결합 구성품(비판매) 후보 판정에 옵션 배정 NOT EXISTS 추가(판매전용 결합상품은 옵션 배정 대상이 아니라 무변경)
--   ④ get_available_stock_counts — 가용재고 집계에서 옵션 배정으로 나간 실물 제외(결합 점유와 같은 상태 집합)
--   ⑤ cms_reassign_reservation_product_code(#653) — 새 메인 실물이 다른 예약의 결합·옵션 배정과 겹치면 거부(QA MINOR-2 함께 처리)
-- 방식: 통째 재작성 대신 "라이브 정의에서 정확히 1곳만 치환"한다 — 일치 횟수가 1이 아니면 예외로 롤백, 이미 옵션 배정 조건이 있으면 건너뛰어 멱등.
--       시그니처·반환형·SECURITY·search_path·권한(ACL)은 CREATE OR REPLACE로 그대로 보존된다.
-- 의미 변화: 옵션 배정이 있는 실물만 새로 제외된다(옵션을 쓰지 않는 상품·옵션 배정이 없는 기간/상태는 동작 동일).
--
-- ROLLBACK: 5개 함수를 직전 정의(각 함수의 마지막 마이그레이션 파일: 547/611·588 계열, 421→547, 653)로 되돌린다.

CREATE OR REPLACE FUNCTION pg_temp.patch_fn(p_sig regprocedure, p_old text, p_new text)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text;
  v_cnt int;
BEGIN
  v_def := pg_get_functiondef(p_sig);
  IF position('reservation_option_assets' in v_def) > 0 THEN
    RETURN;  -- 멱등: 이미 반영됨
  END IF;
  v_cnt := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'patch_fn(%): 치환 대상이 %회 일치(1회여야 함) — 정의가 예상과 다름', p_sig::text, v_cnt;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ① ② 메인 실물 선택 쿼리 — create_hold_reservation / promote_draft_reservation 공통 구조
SELECT pg_temp.patch_fn(
  'public.create_hold_reservation(uuid, date, date, text, text)'::regprocedure,
  $o$  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;$o$,
  $n$    AND NOT EXISTS (
      SELECT 1
      FROM reservation_option_assets roa
      JOIN rental_reservations rr3 ON rr3.id = roa.reservation_id
      WHERE roa.asset_product_id = p.id
        AND rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr3.start_date, rr3.end_date, '[]') && daterange(v_effective_start, v_effective_end, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;$n$
);

SELECT pg_temp.patch_fn(
  'public.promote_draft_reservation(bigint, date, date, text, text)'::regprocedure,
  $o$  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;$o$,
  $n$    AND NOT EXISTS (
      SELECT 1
      FROM reservation_option_assets roa
      JOIN rental_reservations rr3 ON rr3.id = roa.reservation_id
      WHERE roa.asset_product_id = p.id
        AND rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND daterange(rr3.start_date, rr3.end_date, '[]') && daterange(v_effective_start, v_effective_end, '[]')
    )
  ORDER BY p.created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;$n$
);

-- ③ 결합 구성품 자동 배정(비판매 분기) — 판매전용 분기는 옵션 배정 대상이 아니라 무변경
SELECT pg_temp.patch_fn(
  'public.assign_bundle_assets(bigint, uuid, date, date)'::regprocedure,
  $o$      ) THEN
        v_asset_id := v_cand;
        EXIT;
      END IF;
    END LOOP;$o$,
  $n$      ) AND NOT EXISTS (
        SELECT 1
        FROM reservation_option_assets oa
        JOIN rental_reservations rr3 ON rr3.id = oa.reservation_id
        WHERE oa.asset_product_id = v_cand
          AND rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
          AND daterange(rr3.start_date, rr3.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
      ) THEN
        v_asset_id := v_cand;
        EXIT;
      END IF;
    END LOOP;$n$
);

-- ④ 가용재고 집계 — 결합 점유와 같은 상태 집합(live 상태)
SELECT pg_temp.patch_fn(
  'public.get_available_stock_counts(uuid[])'::regprocedure,
  $o$          )
      )::INT - CASE WHEN COALESCE((SELECT pp.sale_only FROM products pp WHERE pp.id = n.id), false)$o$,
  $n$          )
          AND NOT EXISTS (
            SELECT 1 FROM reservation_option_assets oa
            JOIN rental_reservations rr4 ON rr4.id = oa.reservation_id
            WHERE oa.asset_product_id = c.id
              AND rr4.status IN ('hold', 'confirmed', 'shipped', 'in_use', 'return_requested')
          )
      )::INT - CASE WHEN COALESCE((SELECT pp.sale_only FROM products pp WHERE pp.id = n.id), false)$n$
);

-- ⑤ 본체 재배정(#653) — 새 메인 실물이 다른 예약의 결합·옵션 배정과 기간이 겹치면 거부
SELECT pg_temp.patch_fn(
  'public.cms_reassign_reservation_product_code(bigint, uuid)'::regprocedure,
  $o$             daterange(v_start_date, v_end_date, '[]')
    )
  FOR UPDATE SKIP LOCKED;$o$,
  $n$             daterange(v_start_date, v_end_date, '[]')
    )
    AND  NOT EXISTS (
      SELECT 1
      FROM   reservation_bundle_assets rba
      JOIN   rental_reservations rr2 ON rr2.id = rba.reservation_id
      WHERE  rba.asset_product_id = p.id
        AND  rr2.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND  daterange(rr2.start_date, rr2.end_date, '[]') &&
             daterange(v_start_date, v_end_date, '[]')
    )
    AND  NOT EXISTS (
      SELECT 1
      FROM   reservation_option_assets roa
      JOIN   rental_reservations rr3 ON rr3.id = roa.reservation_id
      WHERE  roa.asset_product_id = p.id
        AND  rr3.status NOT IN ('cancelled', 'returned', 'completed', 'expired', 'draft')
        AND  daterange(rr3.start_date, rr3.end_date, '[]') &&
             daterange(v_start_date, v_end_date, '[]')
    )
  FOR UPDATE SKIP LOCKED;$n$
);
