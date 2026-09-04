-- 443_return_delivery_restriction_simplify.sql
-- (원래 442로 작성됐으나, 같은 타임스탬프대에 다른 병렬 세션이 이미 #442
-- create_draft_reservation_no_default_method.sql을 선점해 번호 충돌 — QA 지적으로 443 재명명.
-- Stage에는 442라는 이름으로 이미 적용된 적 있으나 본 파일 재적용으로 동일 SQL을 443 이름
-- 아래 다시 기록·확인함, CREATE OR REPLACE/DROP IF EXISTS라 재적용 안전)
--
-- ⛔ 적용 순서 필수: #440 → #441 → 본 파일(#443) 순서로 반드시 함께 적용할 것. 본 파일의
-- set_reservation_shipment_method 본문이 #440에서 신설한 rental_method_options.is_delivery_type
-- 컬럼을 직접 참조한다 — #440 없이 본 파일만 적용하면 함수 생성 자체는 성공하지만(PL/pgSQL은
-- CREATE 시점에 컬럼 존재를 검증하지 않음) 실제 체크아웃 시 "column is_delivery_type does not
-- exist" 런타임 에러로 전체 예약 저장이 깨진다(QA 지적, 2026-09-04).
--
-- Stephen UX 지적(2026-09-04): "대여옵션 제한 → 반납 배송선택 제한" 전역 마스터 토글이
-- "배송 반납 허용 지정"(is_delivery_type, Migration #440) 개별 칩과 별도로 존재해 혼란스럽다 —
-- "ON 체크된 콤보만 반납 시 배송 감춤 동작하게 하면 간단하다", "기존 대여옵션 제한 영역도
-- 그냥 제거해"라는 명확한 지시. 전역 토글을 완전히 제거하고, is_delivery_type=true로 지정된
-- 방식이 하나라도 있으면(수령이 배송이 아닐 때) 그 방식이 반납에서 자동으로 제외되도록
-- 단순화한다 — 별도 on/off 스위치 없이 칩 지정 자체가 곧 활성화 조건이다.
--
-- ⛔ 이번 조사로 발견한 별개 결함: 서버 최종방어선 set_reservation_shipment_method(7-param,
-- Migration 147)가 클라이언트(cart/+page.svelte)와 별개로 자체적으로 restrict_return_delivery
-- + is_bulk_delivery 조합을 검사하고 있었다 — Migration #440/#441(클라이언트 판정기준을
-- is_delivery_type으로 분리)이 이 RPC까지는 반영하지 못해, 서버 최종방어선이 계속 구식
-- is_bulk_delivery 기준으로 남아있는 상태였다(현재 is_bulk_delivery가 전부 false라 아직
-- 실제 트리거된 적은 없음). 이번 마이그레이션으로 서버도 is_delivery_type 기준으로 통일한다.
--
-- 추가로 기존 로직은 "수령 방식 자체가 배송이면 차단"까지 검사했는데, 이는 클라이언트
-- pickupVisibleTabs(수령은 이 제한과 무관하게 항상 전체 노출, 2026-09-01 leg-aware 설계)와
-- 불일치하는 잠재 버그였다(is_bulk_delivery가 항상 false였어서 실제로 트리거된 적은 없음) —
-- 이번에 "반납 방식만" 검사하도록 정정해 클라이언트·서버 판정을 완전히 일치시킨다.

CREATE OR REPLACE FUNCTION public.set_reservation_shipment_method(
  p_reservation_id bigint,
  p_pickup_method text,
  p_return_method text DEFAULT NULL::text,
  p_pickup_time text DEFAULT NULL::text,
  p_return_time text DEFAULT NULL::text,
  p_pickup_address_road text DEFAULT NULL::text,
  p_pickup_address_detail text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_return_method IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM rental_method_options
       WHERE method_key = p_pickup_method AND is_delivery_type = true AND deleted_at IS NULL
     )
     AND EXISTS (
       SELECT 1 FROM rental_method_options
       WHERE method_key = p_return_method AND is_delivery_type = true AND deleted_at IS NULL
     )
  THEN
    RAISE EXCEPTION 'return_delivery_restricted: 반납 방식으로 배송을 선택할 수 없습니다.';
  END IF;

  UPDATE rental_reservations SET
    pickup_method          = p_pickup_method,
    return_method          = COALESCE(p_return_method, return_method),
    pickup_time            = p_pickup_time,
    return_time            = p_return_time,
    pickup_address_road    = COALESCE(p_pickup_address_road, pickup_address_road),
    pickup_address_detail  = COALESCE(p_pickup_address_detail, pickup_address_detail)
  WHERE id = p_reservation_id
    AND user_id = auth.uid();
END;
$function$;

-- 전역 마스터 토글 완전 제거 — CMS "대여옵션 제한" UI에서 유일하게 호출하던 RPC였음
DROP FUNCTION IF EXISTS public.toggle_return_delivery_restriction();

-- rental_shipping_settings.restrict_return_delivery는 위 두 곳(RPC 판정, RPC 토글) 외
-- 다른 어떤 함수도 참조하지 않음을 사전 조회로 확인(pg_proc.prosrc ILIKE 검색) — 안전하게 제거
ALTER TABLE rental_shipping_settings DROP COLUMN IF EXISTS restrict_return_delivery;

-- ═══════════════════════════════════════════════════════════════════════
-- ROLLBACK (QA 지적으로 추가, 2026-09-04 — CRITICAL 등급 변경이라 명문화)
-- ═══════════════════════════════════════════════════════════════════════
-- 1) ALTER TABLE rental_shipping_settings ADD COLUMN restrict_return_delivery BOOLEAN NOT NULL DEFAULT false;
-- 2) CREATE OR REPLACE FUNCTION public.toggle_return_delivery_restriction()
--    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
--    DECLARE v_row rental_shipping_settings;
--    BEGIN
--      IF NOT public.is_cms_user() THEN RAISE EXCEPTION 'unauthorized: cms role required'; END IF;
--      UPDATE rental_shipping_settings SET restrict_return_delivery = NOT restrict_return_delivery
--      WHERE true RETURNING * INTO v_row;
--      IF v_row.id IS NULL THEN RAISE EXCEPTION 'not_found: rental_shipping_settings singleton row missing'; END IF;
--      RETURN to_jsonb(v_row);
--    END; $$;
-- 3) set_reservation_shipment_method(7-param)를 Migration 147 원본(is_bulk_delivery +
--    restrict_return_delivery 조합, "수령 자체가 배송이면 차단" 조건 포함)으로 CREATE OR REPLACE 복원.
-- ═══════════════════════════════════════════════════════════════════════
