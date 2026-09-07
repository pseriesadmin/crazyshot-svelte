-- Migration #457: contract_audit_log에 'cancelled' 이벤트 타입 추가
--
-- 배경(2026-09-07, sp3-qa-agent 검수 지적): Migration #456(cancel_issued_contract)이
-- 신설한 "전자계약 발행취소" 기능은 이미 서명 완료된 고객의 법적 서명 데이터를 관리자
-- 클릭 한 번으로 영구·비가역적으로 완전 삭제한다. contract_audit_log(Migration #218,
-- "분쟁 발생 시 누가/언제/어떤 이벤트를 발생시켰는가 증빙" 용도)에 이 이벤트를 기록할
-- 수단이 없어, 취소 행위 자체가 시스템 어디에도 남지 않는 공백이 있었다.
--
-- event_type CHECK 제약에 'cancelled' 1개 값만 추가 — 기존 'viewed'/'signed'/'sent'/
-- 'issuer_signed' 4종은 그대로 유지.

ALTER TABLE public.contract_audit_log
  DROP CONSTRAINT contract_audit_log_event_type_check;

ALTER TABLE public.contract_audit_log
  ADD CONSTRAINT contract_audit_log_event_type_check
  CHECK (event_type = ANY (ARRAY['viewed'::text, 'signed'::text, 'sent'::text, 'issuer_signed'::text, 'cancelled'::text]));

-- ============================================================
-- ROLLBACK
-- ============================================================
-- ALTER TABLE public.contract_audit_log DROP CONSTRAINT contract_audit_log_event_type_check;
-- ALTER TABLE public.contract_audit_log ADD CONSTRAINT contract_audit_log_event_type_check
--   CHECK (event_type = ANY (ARRAY['viewed'::text, 'signed'::text, 'sent'::text, 'issuer_signed'::text]));
-- ============================================================
