-- Migration 518: mark_coupons_first_viewed RPC — 카트 진입 시 "첫 확인" 마킹
--
-- 배경: relative_days 쿠폰 유효기간 카운트다운 시작 지점.
--   고객이 카트 화면(/cart)에 진입할 때 이 RPC를 1회 호출해,
--   해당 사용자의 아직 확인되지 않은 미사용 쿠폰 전부에 first_viewed_at을 기록한다.
--   이미 first_viewed_at이 있는 쿠폰은 갱신하지 않는다(멱등성 보장).
--
-- 호출 위치: src/routes/cart/+page.server.ts load() — Promise.all 시작 전
-- 권한: SECURITY DEFINER + REVOKE anon + GRANT authenticated
--
-- 롤백: DROP FUNCTION IF EXISTS public.mark_coupons_first_viewed(uuid);

CREATE OR REPLACE FUNCTION public.mark_coupons_first_viewed(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 보안: 호출자 자신의 쿠폰에만 마킹 허용(SECURITY DEFINER이므로 auth.uid() 명시 검증 필수)
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  -- 아직 확인하지 않은 미사용 쿠폰에만 first_viewed_at 기록 (멱등 — 이미 있으면 무시)
  UPDATE public.user_coupons
  SET first_viewed_at = now()
  WHERE user_id = p_user_id
    AND first_viewed_at IS NULL
    AND used_at IS NULL;
END;
$function$;

-- 공개 접근 차단: anon/PUBLIC은 이 함수를 직접 호출할 수 없음
REVOKE ALL ON FUNCTION public.mark_coupons_first_viewed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_coupons_first_viewed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_coupons_first_viewed(uuid) TO authenticated;
