-- Migration #505: delivery_cutoff_settings — "배송 휴무일 안내 스크립트" 텍스트 컬럼 신설
--
-- 배경: 수령일~반납일 선택이 배송 휴무일을 포함해 자동 연장될 때(rental-fee-policy.md §5)
-- /cart 달력 하단에 노출할 CMS 편집 가능 안내문. rental_shipping_settings.shipping_guide
-- (Migration #152)와 완전히 동일한 패턴 — VARCHAR(200) NOT NULL DEFAULT ''.

-- ============================================================
-- 1. 컬럼 추가 (싱글톤 테이블, 기존 1개 행에 기본값 '' 자동 적용 — 별도 백필 불필요)
-- ============================================================
ALTER TABLE delivery_cutoff_settings
  ADD COLUMN IF NOT EXISTS holiday_guide_text VARCHAR(200) NOT NULL DEFAULT '';

COMMENT ON COLUMN delivery_cutoff_settings.holiday_guide_text IS
  '배송 휴무일이 포함된 예약(자동연장) 발생 시 /cart 달력 하단에 노출되는 안내 문구 — CMS
   /cms/set/rental "휴무일 제어 옵션" 섹션에서 관리자가 직접 입력. 200자 제한
   (rental_shipping_settings.shipping_guide와 동일 패턴).';

-- ============================================================
-- 2. RPC 재정의 — 4번째 파라미터(DEFAULT 포함) 추가
--    ⛔ 인자 개수가 바뀌므로 CREATE OR REPLACE는 "교체"가 아니라 "새 오버로드 생성"이다.
--    구 3-param 버전은 그대로 살아남아 죽은 오버로드가 되므로 아래 3번에서 명시적으로 DROP.
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_delivery_cutoff_settings(
  p_enable_prev_day_check  BOOLEAN,
  p_enable_fixed_holidays  BOOLEAN,
  p_enable_manual_holidays BOOLEAN,
  p_holiday_guide_text     VARCHAR(200) DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row delivery_cutoff_settings;
BEGIN
  IF NOT is_cms_user() THEN
    RAISE EXCEPTION 'CMS 권한이 필요합니다.';
  END IF;

  UPDATE delivery_cutoff_settings SET
    enable_prev_day_check  = p_enable_prev_day_check,
    enable_fixed_holidays  = p_enable_fixed_holidays,
    enable_manual_holidays = p_enable_manual_holidays,
    holiday_guide_text     = p_holiday_guide_text,
    updated_at = now()
  WHERE true
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ============================================================
-- 3. 구 3-param 오버로드 정리 (죽은 함수 + 죽은 권한 잔존 방지)
-- ============================================================
DROP FUNCTION IF EXISTS public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN);

-- ============================================================
-- 4. ⛔⛔⛔ 권한 재하드닝 — 절대 생략 금지 ⛔⛔⛔
--
-- 지난 세션(2026-09-15) CRITICAL 실사고 재발 방지: compute_reservation_line_amount를
-- DROP+CREATE했을 때 기존에 걸려있던 REVOKE 하드닝이 사라지고 이 프로젝트 스키마 기본
-- 권한(PUBLIC+anon+authenticated 자동 EXECUTE)을 그대로 물려받아, 인증 없이 누구나 호출
-- 가능한 상태가 됐던 사고가 있었다(sp3-qa-agent가 실제 anon key로 재현·발견).
--
-- 이 함수도 동일 클래스 위험 — 새로 생성된 4-param 함수 객체는 신규 객체이므로 구 버전의
-- 하드닝 이력(#337 REVOKE ALL FROM PUBLIC + GRANT TO authenticated, #338 REVOKE FROM anon)을
-- 전혀 물려받지 못한다. 반드시 명시적으로 재적용:
-- ============================================================
REVOKE ALL ON FUNCTION public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN, VARCHAR) TO authenticated;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP FUNCTION IF EXISTS public.upsert_delivery_cutoff_settings(BOOLEAN, BOOLEAN, BOOLEAN, VARCHAR);
-- (구 3-param 버전을 되살리려면 #335/#337/#338의 CREATE+REVOKE+GRANT 블록을 그대로 재실행)
-- ALTER TABLE delivery_cutoff_settings DROP COLUMN IF EXISTS holiday_guide_text;
-- ============================================================
