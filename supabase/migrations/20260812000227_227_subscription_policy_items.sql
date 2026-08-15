-- Migration #227: 구독 정책항목(subscription_policy_items) — Phase 4 정책설정 복원
--
-- 배경: Excel 체크리스트 Phase 4(정책 설정)를 Stephen이 재정의한 형태로 복원 —
--       원안(등급별 가입일 기준 체크박스 + 월 초기화일)이 아니라, CMS에서 등록·수정·삭제하는
--       공통 정책 안내 문구 리스트(최대 20개, 항목당 200자 이내)를 /cms/subscriptions/new
--       '⑤ 정책설정' 섹션에서 관리하고, /members 'Plans & features' 아래 '정기구독 이용안내'로
--       고객에게 공통 노출.
--
-- 범위: 플랜별이 아닌 사이트 전역(공통) 데이터 — subscription_plans와 FK 관계 없음.
--
-- stage(ezyvffjvuwmtuhpxdjrw) 먼저 적용·검증 → production(vnbpmvxruyciuuaermyh)은 Stephen 승인 후.

CREATE TABLE subscription_policy_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL CHECK (char_length(content) <= 200 AND char_length(content) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE subscription_policy_items IS
  '정기구독 공통 정책 안내 문구 — CMS /cms/subscriptions/new §5에서 등록·수정·삭제(최대 20개,
  항목당 200자), /members Plans&features 하단 "정기구독 이용안내"에 공통 노출';

ALTER TABLE subscription_policy_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_policy_items_public_read" ON subscription_policy_items
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "subscription_policy_items_admin_write" ON subscription_policy_items
  FOR ALL USING (is_cms_user()) WITH CHECK (is_cms_user());
