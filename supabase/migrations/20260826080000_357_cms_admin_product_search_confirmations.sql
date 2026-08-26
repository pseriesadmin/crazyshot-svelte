-- Migration #357: CMS 관리자 상품 검색 확인 신호 테이블 + RPC
-- 관리자가 CMS 관리 모달에서 상품 검색→선택하는 행위를 학습 신호로 캡처
-- product_search_stats(고객 CTR 신호)와 완전히 분리된 별도 테이블
-- SYNONYM_PROMOTE_THRESHOLD = 3 (synonymLearning.ts와 동일 값으로 하드코딩 — 신규 설정 테이블 없음)

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. 신호 테이블
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cms_admin_product_search_confirmations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  search_term         TEXT NOT NULL,
  admin_id            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  context             TEXT NOT NULL,   -- 모달 식별자: home_category_products 등
  occurrence_count    INT  NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate', 'confirmed')),
  first_confirmed_at  TIMESTAMPTZ,
  last_confirmed_at   TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, search_term)
);

-- RLS: 활성화 + 정책 없음 → service_role 전용 (cms_login_logs / cms_admin_audit_log 동일 패턴)
ALTER TABLE public.cms_admin_product_search_confirmations ENABLE ROW LEVEL SECURITY;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_cms_admin_psc_product_id
  ON public.cms_admin_product_search_confirmations (product_id);
CREATE INDEX IF NOT EXISTS idx_cms_admin_psc_status
  ON public.cms_admin_product_search_confirmations (status);
CREATE INDEX IF NOT EXISTS idx_cms_admin_psc_confirmed_status
  ON public.cms_admin_product_search_confirmations (product_id, status)
  WHERE status = 'confirmed';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. record_admin_search_confirmation RPC
-- UPSERT: 동일 (product_id, search_term)이면 occurrence_count+1.
-- count >= p_threshold 시 즉시 status='confirmed' 전환 (별도 배치 잡 불필요).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_admin_search_confirmation(
  p_product_id  UUID,
  p_search_term TEXT,
  p_admin_id    UUID,
  p_context     TEXT,
  p_threshold   INT DEFAULT 3   -- SYNONYM_PROMOTE_THRESHOLD와 동일 값
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INT;
BEGIN
  -- 빈 검색어는 무시
  IF p_search_term IS NULL OR trim(p_search_term) = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.cms_admin_product_search_confirmations
    (product_id, search_term, admin_id, context,
     occurrence_count, status, first_confirmed_at, last_confirmed_at)
  VALUES
    (p_product_id, trim(p_search_term), p_admin_id, p_context,
     1, 'candidate', NULL, NOW())
  ON CONFLICT (product_id, search_term) DO UPDATE
    SET occurrence_count  = cms_admin_product_search_confirmations.occurrence_count + 1,
        last_confirmed_at = NOW(),
        context           = EXCLUDED.context,
        admin_id          = COALESCE(EXCLUDED.admin_id,
                                     cms_admin_product_search_confirmations.admin_id)
  RETURNING occurrence_count INTO v_new_count;

  -- 임계값 도달 시 candidate → confirmed 즉시 전환
  IF v_new_count >= p_threshold THEN
    UPDATE public.cms_admin_product_search_confirmations
      SET status             = 'confirmed',
          first_confirmed_at = COALESCE(first_confirmed_at, NOW())
    WHERE product_id  = p_product_id
      AND search_term = trim(p_search_term)
      AND status      = 'candidate';
  END IF;
END;
$$;

-- service_role 전용 (브라우저 직접 호출 금지)
-- ⚠️ 이 프로젝트 public 스키마는 ALTER DEFAULT PRIVILEGES로 신규 함수 생성 시 anon·authenticated에
-- EXECUTE를 자동 부여한다(Migration 251b/260/262/263/338 반복 사고 원인) — FROM PUBLIC만으로는
-- 이 자동부여를 걷어내지 못하므로 anon·authenticated를 반드시 명시한다.
REVOKE ALL ON FUNCTION public.record_admin_search_confirmation(UUID, TEXT, UUID, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_admin_search_confirmation(UUID, TEXT, UUID, TEXT, INT)
  TO service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 주석
-- ──────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.cms_admin_product_search_confirmations IS
  '관리자 CMS 모달에서 상품 검색→선택 확인 신호. '
  'product_search_stats(고객 CTR 신호)와 완전히 분리. '
  'occurrence_count >= 3(SYNONYM_PROMOTE_THRESHOLD) 시 status=confirmed 자동 전환. '
  'productSearchIndex.ts에서 loadAdminConfirmedSearchTerms()로 소비.';

COMMENT ON FUNCTION public.record_admin_search_confirmation IS
  '(product_id, search_term) UPSERT — count >= threshold 시 즉시 confirmed 전환. '
  'SYNONYM_PROMOTE_THRESHOLD(3)와 동일 하드코딩 값, 별도 설정 테이블 없음.';
