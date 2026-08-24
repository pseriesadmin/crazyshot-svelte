-- Migration #334: delivery_cutoff_settings 테이블 신규 생성 (싱글톤)
--
-- 택배(delivery/crazydelivery) 수령·반납 캘린더의 휴무일 기반 선택 제한을 제어하는 3개
-- 독립 ON/OFF 토글. rental_shipping_settings(#152)와 동일한 싱글톤 패턴(1행 고정).
--
-- enable_prev_day_check  : 마스터 스위치 — 전날/당일 휴무 체크 로직 자체를 켜고 끔
-- enable_fixed_holidays  : 일요일 + public_holidays(holiday_type='national') 반영 여부
-- enable_manual_holidays : public_holidays(holiday_type='manual') 반영 여부
--
-- 전부 기본값 false로 배포 — 배포 직후에는 기존 캘린더 동작(과거 날짜만 비활성)과 100% 동일.

CREATE TABLE IF NOT EXISTS delivery_cutoff_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enable_prev_day_check   BOOLEAN NOT NULL DEFAULT false,
  enable_fixed_holidays   BOOLEAN NOT NULL DEFAULT false,
  enable_manual_holidays  BOOLEAN NOT NULL DEFAULT false,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- singleton seed (1행 고정)
INSERT INTO delivery_cutoff_settings (enable_prev_day_check, enable_fixed_holidays, enable_manual_holidays)
VALUES (false, false, false);

ALTER TABLE delivery_cutoff_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_cutoff_settings_cms_all" ON delivery_cutoff_settings
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());
