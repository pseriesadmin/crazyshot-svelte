-- Migration #855: 옵션 실물 배정 함수가 구성품 점유도 함께 맞추도록 보정 (sp3 검수 MAJOR-1, 2026-11-26)
--
-- 결함: 수량 본상품 연동(qty_follows_main) 보정(create_reservation_order, #769)은 옵션 수량을 바꾼 뒤 private.assign_option_assets 만 호출한다.
--       #854 의 구성품 점유(private.assign_option_component_assets)가 호출되지 않아, 패키지 옵션 수량이 늘면 구성품이 이전 수량만큼만
--       점유된 채로 남아 이중 예약에 노출되고(줄면 과다 점유), 관리자가 상세를 열어 보정이 돌 때까지 맞춰지지 않았다.
-- 수정: private.assign_option_assets 끝에서 구성품 점유를 best-effort(비엄격, 예외 삼킴)로 함께 호출한다.
--   · assign_option_assets 를 부르는 모든 경로(옵션 저장·수량 연동 보정·관리자 보정)가 구성품도 맞춘다.
--   · 옵션 저장(set_reservation_options)은 그 뒤에 엄격 호출을 한 번 더 하므로 부족 시 OPTION_STOCK_EXCEEDED 거부는 그대로다.
--   · 수량 연동 보정 경로는 기존처럼 best-effort(주문 생성을 막지 않음).
-- 방식: 라이브 정의의 끝부분(마지막 END; 직전)에 한 번만 삽입(이미 있으면 건너뜀·형태가 다르면 중단).
-- 적용 순서: crazyshot-stage(ezyvffjvuwmtuhpxdjrw) 검증 → crazyshot(vnbpmvxruyciuuaermyh) — #854 다음에 적용
-- TDD: src/__tests__/services/optionPackageComponentAssets.test.ts (PC-11)
--
-- ROLLBACK: private.assign_option_assets 에서 아래 삽입한 BEGIN … assign_option_component_assets … END; 블록만 제거한다.

DO $do$
DECLARE
  v_def TEXT;
  v_new TEXT;
BEGIN
  v_def := pg_get_functiondef('private.assign_option_assets(bigint)'::regprocedure);
  IF position('assign_option_component_assets' IN v_def) = 0 THEN
    v_new := regexp_replace(
      v_def,
      '\n\s*END;\s*\$function\$\s*$',
      E'\n\n  BEGIN\n    PERFORM private.assign_option_component_assets(p_reservation_id, false);\n  EXCEPTION WHEN OTHERS THEN\n    NULL;\n  END;\nEND;\n$function$\n'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION '855: assign_option_assets 끝부분 패턴을 찾지 못했습니다';
    END IF;
    EXECUTE v_new;
  END IF;
END
$do$;
