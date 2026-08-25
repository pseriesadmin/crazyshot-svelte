-- Migration #353: cms_admin_audit_log 신설 — CMS 관리자 계정 민감 액션 감사로그
--
-- .claude/harness/TASK.md "CMS 관리자 계정 목록 → 계정 정보설정 상세패널" Stage 7
-- (Q8 확정 (i) 감사로그 항목) — contract_audit_log(Migration 218) 패턴 재사용.
--
-- 설계 원칙(contract_audit_log와 동일):
--   - append-only — UPDATE/DELETE 없음, 행이 추가되기만 하는 구조
--   - RLS 활성화 + 정책 없음 = service_role 전용("CMS 브라우저 auth 패턴")
--   - action_type: role_change(등급변경) | create(마스터 계정 생성 등) | delete(계정 삭제) |
--     suspend(사용중지 토글) | menu_permission_change(메뉴별 세부 접근권한 변경) |
--     concurrent_login_change(중복로그인 허용 토글) | session_limit_change(세션제한 토글) |
--     name_change(이름 수정)
--   - user_id: 액션을 실행한 관리자(actor). target_user_id: 그 액션의 대상 계정.
--   - before_value/after_value: 변경 전/후 상태를 JSONB로 최소한만 기록(과잉설계 금지 —
--     민감 필드 원문 전체 덤프가 아니라 감사에 필요한 필드만).

CREATE TABLE IF NOT EXISTS public.cms_admin_audit_log (
  id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type     text        NOT NULL CHECK (action_type IN (
                                'role_change',
                                'create',
                                'delete',
                                'suspend',
                                'menu_permission_change',
                                'concurrent_login_change',
                                'session_limit_change',
                                'name_change'
                              )),
  target_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  before_value    jsonb,
  after_value     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 계정 상세패널에서 특정 대상 계정의 이력을 조회할 인덱스
CREATE INDEX IF NOT EXISTS cms_admin_audit_log_target_idx
  ON public.cms_admin_audit_log(target_user_id, created_at DESC);

-- 특정 관리자가 실행한 액션 이력 조회 인덱스
CREATE INDEX IF NOT EXISTS cms_admin_audit_log_actor_idx
  ON public.cms_admin_audit_log(user_id, created_at DESC);

-- RLS: service_role만 접근 (고객·일반 관리자 브라우저 세션 직접 조회 금지)
ALTER TABLE public.cms_admin_audit_log ENABLE ROW LEVEL SECURITY;

-- 정책 없음 = anon/authenticated 전부 차단, service_role(서버 API)만 접근 가능
-- ("CMS 브라우저 auth 패턴" — cms_login_logs/contract_audit_log와 동일 원칙)

COMMENT ON TABLE public.cms_admin_audit_log IS
  'append-only CMS 관리자 계정 민감 액션 감사로그 — Stage 7(Q8 확정). UPDATE/DELETE 금지.';
COMMENT ON COLUMN public.cms_admin_audit_log.user_id IS
  '액션을 실행한 관리자(actor)의 auth.users.id.';
COMMENT ON COLUMN public.cms_admin_audit_log.target_user_id IS
  '그 액션의 대상이 된 계정의 auth.users.id.';

-- rollback:
-- DROP TABLE IF EXISTS public.cms_admin_audit_log;
