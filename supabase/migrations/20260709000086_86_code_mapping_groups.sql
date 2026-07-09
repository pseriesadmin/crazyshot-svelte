-- 86: 매핑그룹 테이블
-- 분류코드를 자유롭게 조합한 묶음(그룹)을 관리.
-- 상품등록 시 매핑그룹 → 포함 코드 선택으로 상품코드 발행 간소화.

-- ── 매핑그룹 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.code_mapping_groups (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  keywords    TEXT[]      DEFAULT '{}',
  is_active   BOOLEAN     DEFAULT true,
  sort_order  INT         DEFAULT 99,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 그룹 내 포함 코드 (N:M) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.code_mapping_items (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id         UUID        NOT NULL
                   REFERENCES public.code_mapping_groups(id) ON DELETE CASCADE,
  taxonomy_code_id UUID        NOT NULL
                   REFERENCES public.product_category_codes(id) ON DELETE CASCADE,
  sort_order       INT         DEFAULT 99,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(group_id, taxonomy_code_id)
);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.code_mapping_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_mapping_items  ENABLE ROW LEVEL SECURITY;

-- CMS 관리자: 전체 CRUD
CREATE POLICY "cms_manage_mapping_groups"
  ON public.code_mapping_groups FOR ALL
  USING  (public.is_cms_user())
  WITH CHECK (public.is_cms_user());

-- 인증 사용자: 활성 그룹 읽기 (상품등록 화면용)
CREATE POLICY "auth_read_active_mapping_groups"
  ON public.code_mapping_groups FOR SELECT
  USING (is_active = true OR public.is_cms_user());

-- CMS 관리자: items 전체 CRUD
CREATE POLICY "cms_manage_mapping_items"
  ON public.code_mapping_items FOR ALL
  USING  (public.is_cms_user())
  WITH CHECK (public.is_cms_user());

-- 인증 사용자: 활성 그룹의 items 읽기
CREATE POLICY "auth_read_mapping_items"
  ON public.code_mapping_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.code_mapping_groups g
      WHERE g.id = group_id AND (g.is_active = true OR public.is_cms_user())
    )
  );
