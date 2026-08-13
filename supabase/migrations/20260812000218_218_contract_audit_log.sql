-- Migration 218: contract_audit_log 신규 테이블 (Phase 8-A-3)
--
-- append-only 감사로그 — 전자계약 주요 이벤트(열람/서명/발송/발행자서명)를 기록.
-- 분쟁 발생 시 "누가, 언제, 어떤 이벤트를 발생시켰는가"를 증빙하는 용도.
--
-- 설계:
--   - UPDATE/DELETE 없음 — 행이 추가되기만 하는 append-only 구조
--   - contract_signings의 viewed_at/signed_at 단일 컬럼(최초 1회)에서 이력으로 확장
--   - event_type: viewed | signed | sent | issuer_signed
--   - actor_type: customer | admin | system
--   - ip_address: NULL 허용 (시스템 자동 이벤트, 또는 IP 획득 불가 케이스)

CREATE TABLE IF NOT EXISTS contract_audit_log (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id uuid        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  event_type  text        NOT NULL CHECK (event_type IN ('viewed', 'signed', 'sent', 'issuer_signed')),
  actor_type  text        NOT NULL CHECK (actor_type IN ('customer', 'admin', 'system')),
  actor_id    text,          -- user_id(uuid) 또는 admin_id(uuid) 문자열, system 이벤트는 NULL
  ip_address  text,          -- IPv4/IPv6, NULL 허용
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 계약별 이력 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_contract_audit_log_contract_id
  ON contract_audit_log(contract_id, created_at DESC);

-- RLS: service_role만 접근 (고객·파트너 직접 조회 금지 — 분쟁 증빙 자료)
ALTER TABLE contract_audit_log ENABLE ROW LEVEL SECURITY;

-- 고객/anon은 접근 불가 (RLS 정책 없음 = 모두 차단)
-- 관리자는 service_role 키로만 접근 (API 서버 사이드에서만 호출)

COMMENT ON TABLE contract_audit_log IS
  'append-only 전자계약 감사로그 — Phase 8-A-3. UPDATE/DELETE 금지.';
COMMENT ON COLUMN contract_audit_log.event_type IS
  'viewed: 고객 열람 | signed: 고객 서명 | sent: 관리자 발송 | issuer_signed: 발행자 서명';
COMMENT ON COLUMN contract_audit_log.actor_id IS
  'event 발생 주체 ID (user_id 또는 admin_id). system 이벤트는 NULL.';

-- rollback:
-- DROP TABLE IF EXISTS contract_audit_log;
