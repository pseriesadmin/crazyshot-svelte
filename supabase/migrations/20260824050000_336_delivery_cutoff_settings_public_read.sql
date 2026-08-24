-- Migration #336: delivery_cutoff_settings 공개 조회 정책 추가
--
-- /cart 화면이 세션 클라이언트(locals.supabase)로 이 싱글톤 설정을 읽어야 하는데, 기존
-- FOR ALL(is_cms_user()) 정책만으로는 고객 세션이 조회할 수 없다. rental_shipping_settings
-- (#152)의 "shipping_settings_public_select" 정책과 동일한 패턴 — 이 설정 자체가 민감정보가
-- 아니므로(단순 ON/OFF 플래그 3개) 전체 공개 조회 허용.

CREATE POLICY "delivery_cutoff_settings_public_select" ON delivery_cutoff_settings
  FOR SELECT USING (true);
