-- Migration #659: rental_shipping_settings — 무인보관함 안내문(locker_guide_text) 컬럼 + 전용 저장 RPC
--
-- 배경(Stephen 요청, 2026-10-06): /cart 방문대여·방문반납에서 영업외시간(무인보관함 시간대)을 고르면
-- 노출되는 빨간 안내문이 cart/+page.svelte에 하드코딩돼 있었다. CMS '배송설정'에서 관리하도록 이관.
--
-- 안내문의 "방문대여/방문반납" 구분은 {방식} 토큰으로 치환한다(앱 코드가 대여=방문대여, 반납=방문반납으로 교체).
-- 기본값·백필 문구는 기존 하드코딩 문장과 동일 → 적용 직후에도 /cart 화면 문구가 바뀌지 않는다.
--
-- 기존 upsert_rental_shipping_settings(8-param)는 건드리지 않고 전용 RPC를 신설한다
-- (시그니처 변경 시 DROP/오버로드 모호성 위험 회피). UPDATE는 safeupdate 확장 때문에 WHERE절 필수(#567 교훈).

ALTER TABLE rental_shipping_settings
  ADD COLUMN IF NOT EXISTS locker_guide_text TEXT NOT NULL
  DEFAULT '선택한 {방식} 시간은 고객센터 ''무인보관함'' 이용만 가능하며 1시간 전 비밀번호를 채팅서비스로 발송해 드립니다.';

CREATE OR REPLACE FUNCTION public.upsert_rental_locker_guide_text(
  p_locker_guide_text TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  IF p_locker_guide_text IS NOT NULL AND char_length(p_locker_guide_text) > 200 THEN
    RAISE EXCEPTION '무인보관함 안내문은 최대 200자까지 입력 가능합니다.';
  END IF;

  UPDATE rental_shipping_settings SET
    locker_guide_text = COALESCE(p_locker_guide_text, ''),
    updated_at        = now()
  WHERE true;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rental_locker_guide_text(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_rental_locker_guide_text(TEXT) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.upsert_rental_locker_guide_text(TEXT);
-- ALTER TABLE rental_shipping_settings DROP COLUMN IF EXISTS locker_guide_text;
-- ============================================================
