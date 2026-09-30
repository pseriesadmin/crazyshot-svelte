-- Migration 531: order_coupons 다중쿠폰 연결 테이블
--   (쿠폰 다중중첩 체크아웃 구조 전환 — Phase 1 of 6, 마스터플랜
--    ancient-pondering-salamander.md 참고)
--
-- 배경: 기존 orders.selected_coupon_id(단일, nullable)로는 한 주문에 쿠폰 1장만
-- 연결 가능하다. Stephen 확정 정책 — "한 주문에 자격되는 쿠폰 전부를 동시 중첩
-- 선택해 사용 허용"을 지원하기 위해 order_id × user_coupon_id 다대다 연결
-- 테이블을 신설한다.
--
-- orders.selected_coupon_id 컬럼은 이번 마이그레이션에서 삭제하지 않는다 —
-- 하위호환 병행(단일값 경로) 유지가 필요한 참조처가 남아있어(계약서명 미리보기 등,
-- 이번 세션 범위 밖) 완전 제거는 후속 세션에서 별도 검토한다.
--
-- 이 테이블 자체는 앱 코드가 아직 참조하지 않는 상태로도 안전하게 선배포 가능
-- (신규 테이블 추가만, 기존 로직 무영향).

CREATE TABLE IF NOT EXISTS public.order_coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_coupon_id  UUID NOT NULL REFERENCES public.user_coupons(id),
  coupon_id       UUID NOT NULL REFERENCES public.coupons(id),
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, user_coupon_id)
);

CREATE INDEX IF NOT EXISTS idx_order_coupons_order_id       ON public.order_coupons(order_id);
CREATE INDEX IF NOT EXISTS idx_order_coupons_user_coupon_id ON public.order_coupons(user_coupon_id);
CREATE INDEX IF NOT EXISTS idx_order_coupons_coupon_id      ON public.order_coupons(coupon_id);

ALTER TABLE public.order_coupons ENABLE ROW LEVEL SECURITY;

-- 본인 소유 user_coupon과 연결된 행만 SELECT 허용 — 쓰기는 SECURITY DEFINER RPC 경유만
-- (user_coupons.md 기존 정책 "본인 조회"와 동일한 조인 패턴, coupons.md RLS 스타일 참고)
CREATE POLICY "order_coupons: 본인 조회" ON public.order_coupons
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_coupons uc
      WHERE uc.id = order_coupons.user_coupon_id
        AND uc.user_id = auth.uid()
    )
  );

-- ⚠️ 2026-09-23 정정 — is_admin()은 user_profiles.membership_grade='admin' 기준의 레거시
-- "고객 등급" 개념으로 CMS 직원 권한과 무관하다(products.md §2-8 기존 확정 사항). CMS 관리자
-- 전체 접근은 is_cms_user()(user_profiles.cms_role IS NOT NULL 기준)로 통일한다.
CREATE POLICY "order_coupons: 관리자 전체" ON public.order_coupons
  FOR ALL USING (public.is_cms_user());

-- ============================================================
-- ROLLBACK
-- ============================================================
-- DROP TABLE IF EXISTS public.order_coupons;
-- ============================================================
