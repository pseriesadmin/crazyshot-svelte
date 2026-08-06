-- Migration #196: products RLS — 부모/자식 구분 + 관리자 정책 is_cms_user() 정합 (DB-CRIT-3)
--
-- 배경(2026-08-06 실제 조회로 확인 — 파일 기반 감사와 실제 라이브 상태가 크게 다름):
--   stage(ezyvffjvuwmtuhpxdjrw): 정책이 "products: active status read" 단 1개뿐(anon+authenticated,
--     SELECT, 조건 status='active'). 실제 데이터 확인 결과 모든 행(소프트삭제 18건 포함)이
--     status='active'라서 이 조건은 사실상 "전부 통과"와 동일 — is_active/deleted_at/parent_product_id
--     전부 무시되고 자식(재고단위)·비활성·삭제 상품까지 전부 anon 키로 조회 가능한 상태였음.
--     관리자 전체 접근 정책은 아예 존재하지 않음.
--   production(vnbpmvxruyciuuaermyh): "products_select"(public 롤, 조건 그냥 true — 완전 무제한 공개),
--     "products_insert/update/delete"(전부 false — service_role만 우회 가능, 이 부분은 문제없음).
--
-- 조치: 두 환경의 서로 다른 기존 정책명을 전부 안전하게 제거(IF EXISTS)한 뒤,
--   동일한 목표 정책 2개로 통일:
--     ① 공개 조회: is_active=true AND deleted_at IS NULL AND parent_product_id IS NULL
--        (자식/비활성/삭제 상품은 anon·authenticated에게 노출 안 됨 — products.md §1 원칙과 일치)
--     ② 관리자 전체: is_cms_user() 기반(CMS 직원 권한 체계와 일치 — DB-CRIT-5로 등록된 정의 사용)
--
-- stage 먼저 적용·검증 → production은 별도 Stephen 승인 후 진행(DB-CRIT-345-PROD).

-- ── 기존 정책 전부 제거 (두 환경에서 관찰된 모든 정책명 — 없는 이름은 안전하게 무시됨) ──
DROP POLICY IF EXISTS "products: active status read" ON public.products;
DROP POLICY IF EXISTS "products: 전체 조회 허용" ON public.products;
DROP POLICY IF EXISTS "products: 관리자 전체" ON public.products;
DROP POLICY IF EXISTS "products_select" ON public.products;
DROP POLICY IF EXISTS "products_insert" ON public.products;
DROP POLICY IF EXISTS "products_update" ON public.products;
DROP POLICY IF EXISTS "products_delete" ON public.products;

-- ── 신규 통일 정책 ──
CREATE POLICY "products_public_read" ON public.products
  FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND deleted_at IS NULL
    AND parent_product_id IS NULL
  );

CREATE POLICY "products_admin_all" ON public.products
  FOR ALL
  USING (is_cms_user())
  WITH CHECK (is_cms_user());

-- ── ROLLBACK (참고용) ──
-- DROP POLICY IF EXISTS "products_public_read" ON public.products;
-- DROP POLICY IF EXISTS "products_admin_all" ON public.products;
-- (기존 정책 복원이 필요하면 위 DROP 목록의 정책명으로 각 환경의 원래 정의를 재생성)
