-- Migration #651: contract_audit_log.event_type 허용 목록 확장 — 서명 증적·PDF 보관·사본 교부 이벤트 (2026-10-06)
--
-- 배경: #650으로 서명 증적(contract_signature_evidence)·최종본 PDF(contract_final_documents) 기록이 생겼고,
--   recordAuditLog는 DB 오류를 의도적으로 삼키는(silent fail) 구조라 허용 목록에 없는 event_type을 보내면
--   감사 기록이 아무 흔적 없이 사라진다. 새 이벤트를 쓰기 전에 CHECK 제약을 먼저 넓힌다.
--
-- 추가 이벤트:
--   consented        — 고객이 필수 동의 3종(계약 내용·개인정보·약관 사본 수령)을 모두 체크하고 서명 제출
--   evidence_saved   — 서명 증적 행(contract_signature_evidence) 저장 성공
--   evidence_failed  — 증적 저장 실패(서명 자체는 성공 — 사후 조치 대상)
--   archive_created  — 최종본 PDF 보관 완료
--   copy_sent        — 계약서·약관 사본 교부(채팅 카드 발송)
--   copy_downloaded  — 고객이 사본(PDF)을 내려받음
-- 기존 값(viewed·signed·sent·issuer_signed·cancelled)은 그대로 유지한다(기존 행 무영향).
--
-- 롤백: ALTER TABLE public.contract_audit_log DROP CONSTRAINT contract_audit_log_event_type_check;
--       ALTER TABLE public.contract_audit_log ADD CONSTRAINT contract_audit_log_event_type_check
--         CHECK (event_type = ANY (ARRAY['viewed','signed','sent','issuer_signed','cancelled']));
--       (새 이벤트 행이 이미 있으면 그 행을 먼저 지워야 하므로 Production에서는 사용 금지)

ALTER TABLE public.contract_audit_log DROP CONSTRAINT IF EXISTS contract_audit_log_event_type_check;
ALTER TABLE public.contract_audit_log ADD CONSTRAINT contract_audit_log_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'viewed', 'signed', 'sent', 'issuer_signed', 'cancelled',
    'consented', 'evidence_saved', 'evidence_failed', 'archive_created', 'copy_sent', 'copy_downloaded'
  ]));
