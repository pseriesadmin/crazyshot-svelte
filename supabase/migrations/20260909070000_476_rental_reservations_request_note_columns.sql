-- Migration 476: rental_reservations에 pickup_request_note/return_request_note 컬럼 추가
--
-- 배경(2026-09-09, Stephen 확정): 장바구니 "요청 사항"(공동현관 출입번호/경비실 호출 등,
-- 수령·반납 각 leg마다 독립 입력) 필드가 UI에는 존재하지만 어떤 RPC에도 파라미터가 없어
-- rental_reservations 어디에도 저장되지 않던 실제 결함(실사용 조사 중 발견). 이름/이메일/
-- 휴대번호는 회원가입 정보에서 가져오는 값이라 별도 저장 불필요(Stephen 확인), 방문지점은
-- 방문 시 목록에서 선택해 값을 가져오는 구조라 마찬가지로 별도 저장 불필요(Stephen 확인) —
-- 이 두 건은 문제 없음으로 확정. "요청 사항"만 실제 오류이므로 이번 마이그레이션으로 해소.
--
-- set_reservation_shipment_method(7-param, Migration 443)에 신규 trailing 파라미터 2개를
-- 기본값 NULL로 추가.
--
-- ⚠️ 실제 적용 중 발견·수정한 함정: "입력 파라미터에 trailing default 추가는 CREATE OR
-- REPLACE만으로 충분하다"는 최초 가정이 틀렸다 — PostgreSQL은 파라미터 목록이 늘어나면
-- 동일 함수를 교체하는 게 아니라 별도 오버로드를 새로 만든다(RETURNS TABLE 컬럼 변경
-- 케이스만 이 문제가 있는 게 아니었음). 그 결과 3-param(레거시)·7-param(구버전)·9-param
-- (신규) 오버로드 3개가 동시에 존재하게 됐고, 5개 파라미터만 넘기는 기존 호출부
-- (products/[id]/+page.svelte, api/chat/return-method/[id]/+server.ts, cart의 구버전
-- 호출)가 7-param과 9-param 양쪽에 모두 매칭돼 PGRST203(모호성) 에러가 날 위험이 즉시
-- 발생했다(Stage에서 curl로 직접 재현·확인). Migration #434가 5-param→7-param으로 확장할
-- 때도 동일한 이유로 DROP FUNCTION을 먼저 실행했던 선례(위 파일 참고)를 그대로 따라
-- 7-param 오버로드를 명시적으로 DROP한 뒤에야 3-param + 9-param 2개로 정리되고,
-- PostgREST curl 테스트(5-param 호출 204, 9-param 호출 204)로 모호성 해소를 재확인했다.
-- 3-param(레거시, Migration 171)은 정확히 3개 파라미터만 넘기는 호출과는 여전히 모호성
-- 여지가 있으나(9-param과 겹침), 현재 코드베이스의 모든 실제 호출부가 5개 또는 9개를
-- 넘기므로 즉각적인 영향은 없음 — 이 3-param 오버로드에 의존하는 새 호출을 추가할 때는
-- 반드시 5개 이상의 파라미터를 명시해 모호성을 피할 것(기존 return-method 엔드포인트
-- 주석과 동일 원칙).

DROP FUNCTION IF EXISTS public.set_reservation_shipment_method(
  bigint, text, text, text, text, text, text
);

ALTER TABLE public.rental_reservations
  ADD COLUMN IF NOT EXISTS pickup_request_note TEXT,
  ADD COLUMN IF NOT EXISTS return_request_note TEXT;

COMMENT ON COLUMN public.rental_reservations.pickup_request_note IS
  '수령(방문) 시 요청사항 — 공동현관 출입번호/경비실 호출/세대호출 등, 장바구니 "요청 사항" 입력값.';
COMMENT ON COLUMN public.rental_reservations.return_request_note IS
  '반납(방문) 시 요청사항 — pickup_request_note와 동일 원칙, 반납 leg 전용 별도 값.';

CREATE OR REPLACE FUNCTION public.set_reservation_shipment_method(
  p_reservation_id bigint,
  p_pickup_method text,
  p_return_method text DEFAULT NULL::text,
  p_pickup_time text DEFAULT NULL::text,
  p_return_time text DEFAULT NULL::text,
  p_pickup_address_road text DEFAULT NULL::text,
  p_pickup_address_detail text DEFAULT NULL::text,
  p_pickup_request_note text DEFAULT NULL::text,
  p_return_request_note text DEFAULT NULL::text
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
    pickup_address_detail  = COALESCE(p_pickup_address_detail, pickup_address_detail),
    pickup_request_note    = COALESCE(p_pickup_request_note, pickup_request_note),
    return_request_note    = COALESCE(p_return_request_note, return_request_note)
  WHERE id = p_reservation_id
    AND user_id = auth.uid();
END;
$function$;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Migration 443의 정의(pickup_request_note/return_request_note 파라미터 없음)로
-- CREATE OR REPLACE 복원 + 아래 컬럼 제거:
-- ALTER TABLE public.rental_reservations
--   DROP COLUMN IF EXISTS pickup_request_note,
--   DROP COLUMN IF EXISTS return_request_note;
-- ============================================================
