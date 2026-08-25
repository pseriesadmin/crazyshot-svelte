-- Migration #350: CMS 관리자 메뉴별 세부 접근권한 오버라이드 테이블
--
-- .claude/harness/TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 1
-- (Q1~Q3 확정 반영) — GATE B Q2 기본안 채택: 별도 테이블 cms_menu_permissions.
--
-- 판정 원칙(Q3 확정, src/lib/constants/cmsMenus.ts hasMenuAccess() 참고):
--   블랙리스트 방식 — 레코드가 없으면 role 기준(hasRouteAccess/hasSettingsAccess) 결과를
--   그대로 따르는 기본 허용. 명시적 차단(allowed=false) 레코드가 있을 때만 해당 메뉴를
--   숨긴다. allowed=true 레코드는 role이 애초에 막은 메뉴를 열어주지 않는다(좁히기
--   전용, Q6 — Stage 3에서 CRUD RPC 레벨로 서버 강제 예정, 이번 마이그레이션은 스키마만).
--
-- menu_key는 src/lib/constants/cmsMenus.ts CMS_MENUS의 menu_key와 1:1 대응한다(SSOT).
-- CRUD RPC(cms_get_menu_permissions / cms_set_menu_permission)는 Stage 3에서 별도
-- 마이그레이션으로 추가 — 이번 파일은 스키마 + RLS만 다룬다.

CREATE TABLE IF NOT EXISTS public.cms_menu_permissions (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  menu_key   TEXT        NOT NULL,
  allowed    BOOLEAN     NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (user_id, menu_key)
);

-- RLS 활성화 (정책 없음 = service_role 전용, "CMS 브라우저 auth 패턴" —
-- cms_login_logs/contract_audit_log와 동일 설계 원칙)
ALTER TABLE public.cms_menu_permissions ENABLE ROW LEVEL SECURITY;

-- 계정 상세패널·GNB 오버레이 조회 인덱스
CREATE INDEX IF NOT EXISTS cms_menu_permissions_user_idx ON public.cms_menu_permissions(user_id);
