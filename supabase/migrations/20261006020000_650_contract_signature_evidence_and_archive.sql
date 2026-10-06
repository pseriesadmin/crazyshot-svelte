-- Migration #650: 전자계약 법적 증빙 강화 — 서명 증적(동의·UA·해시·약관 스냅샷) + 최종본 PDF 불변 보관 기반 (2026-10-06, Stephen 승인 플랜)
--
-- 배경: 실서버 계약서 점검에서 확인된 증빙 공백 —
--   · 동의 체크가 서버에 기록되지 않음(클라이언트 상태일 뿐), User-Agent 미저장
--   · 해시(content_hash)가 서명 이미지 합성 "전" 스냅샷만 대상, 합성된 최종본 해시 없음
--   · 약관(서비스이용정책·환불규정·개인정보처리방침)은 "참조"만 하고 서명 당시 사본 기록 없음
--   · contracts.document_url(PDF 주소) 25건 전부 NULL — 최종본 PDF를 만드는 코드 없음
--
-- 설계 보정(플랜 대비): 플랜은 contract_signings에 증거 컬럼 추가 + 불변 트리거를 두려 했으나,
--   cancel_issued_contract(Migration #457, "서명완료건 발행취소")가 같은 contract_signings 행의
--   sent_at/signed_at/expires_at/token을 되돌려 재서명하게 하는 기존 기능이라 그 행을 잠그면 기능이 깨진다.
--   → contract_signings는 건드리지 않고, 서명 "시점의 복사본"을 별도 추가 전용(append-only) 테이블에 남긴다.
--   발행취소·재서명이 일어나도 첫 서명의 증거는 이 테이블에 그대로 남는다(서명 이벤트 = (signing_id, signed_at) 단위).
--
-- 이 마이그레이션이 하는 일:
--   1) contract_audit_log.metadata jsonb 추가(감사 이벤트에 해시·건수 등 부가정보 기록용, 기존 호출 무영향)
--   2) contract_signature_evidence — 서명 이벤트 1건당 1행: IP·UA·동의 기록·해시·약관 3종 스냅샷(원문+SHA-256)
--   3) contract_final_documents — 최종본 PDF 1건당 1행: 저장 경로·PDF/HTML 해시·원본/재생성 구분
--   4) 두 테이블 UPDATE·DELETE·TRUNCATE 차단 트리거(서비스 롤도 일반 SQL로는 변경 불가), RLS 활성+정책 0건
--   5) 비공개 버킷 contract-archives(PDF 전용 20MB). storage.objects 정책은 만들지 않는다(서비스 롤 전용)
--
-- FK를 두지 않는 이유: 증거는 계약·예약 행이 정리되더라도 남아야 하고, 반대로 증거가 계약·예약 삭제를 막아서도 안 된다.
-- 롤백(Stage 검증용 — Production에서는 증거가 쌓인 뒤 사용 금지):
--   DROP TABLE public.contract_final_documents; DROP TABLE public.contract_signature_evidence;
--   DROP FUNCTION public.contract_evidence_block_mutation();
--   ALTER TABLE public.contract_audit_log DROP COLUMN metadata;
--   DELETE FROM storage.buckets WHERE id = 'contract-archives';  -- 버킷이 비어 있을 때만

-- 1) 감사로그 메타데이터
ALTER TABLE public.contract_audit_log ADD COLUMN IF NOT EXISTS metadata jsonb;

-- 2) 서명 증적(서명 이벤트 단위, 추가 전용)
CREATE TABLE IF NOT EXISTS public.contract_signature_evidence (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id            uuid        NOT NULL,
  signing_id             uuid        NOT NULL,
  reservation_id         bigint,
  signed_at              timestamptz NOT NULL,
  ip_address             text,
  user_agent             text,
  consent_log            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  content_hash           text,       -- 서명 직전 스냅샷 해시(contract_signings.content_hash 사본)
  final_html_sha256      text,       -- 서명 이미지가 합성된 최종 HTML의 SHA-256(합성 실패 시 NULL)
  signature_image_sha256 text,       -- 서명 이미지(data URI 문자열)의 SHA-256
  terms_text             text,       -- 서명 당시 서비스이용정책 원문(rental_policy_settings.terms_text)
  refund_text            text,       -- 서명 당시 환불규정 원문
  privacy_text           text,       -- 서명 당시 개인정보처리방침 원문
  terms_sha256           text,
  refund_sha256          text,
  privacy_sha256         text,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_signature_evidence_event_unique UNIQUE (signing_id, signed_at)
);

CREATE INDEX IF NOT EXISTS idx_contract_signature_evidence_contract
  ON public.contract_signature_evidence (contract_id);

-- 3) 최종본 PDF 보관 기록(추가 전용)
CREATE TABLE IF NOT EXISTS public.contract_final_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id       uuid        NOT NULL UNIQUE REFERENCES public.contract_signature_evidence(id) ON DELETE RESTRICT,
  contract_id       uuid        NOT NULL,
  signing_id        uuid        NOT NULL,
  pdf_path          text        NOT NULL,   -- contract-archives 버킷 내부 경로
  pdf_sha256        text        NOT NULL,
  html_sha256       text,
  size_bytes        integer     NOT NULL CHECK (size_bytes > 0),
  source            text        NOT NULL CHECK (source IN ('original', 'regenerated')),
  generator_version text        NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_final_documents_contract
  ON public.contract_final_documents (contract_id);

-- 4) 변경 차단 + 접근 잠금
CREATE OR REPLACE FUNCTION public.contract_evidence_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION '전자계약 증거 기록(%)은 수정·삭제할 수 없습니다 (추가 전용).', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$function$;

REVOKE ALL ON FUNCTION public.contract_evidence_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contract_signature_evidence_immutable ON public.contract_signature_evidence;
CREATE TRIGGER trg_contract_signature_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.contract_signature_evidence
  FOR EACH ROW EXECUTE FUNCTION public.contract_evidence_block_mutation();
DROP TRIGGER IF EXISTS trg_contract_signature_evidence_no_truncate ON public.contract_signature_evidence;
CREATE TRIGGER trg_contract_signature_evidence_no_truncate
  BEFORE TRUNCATE ON public.contract_signature_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION public.contract_evidence_block_mutation();

DROP TRIGGER IF EXISTS trg_contract_final_documents_immutable ON public.contract_final_documents;
CREATE TRIGGER trg_contract_final_documents_immutable
  BEFORE UPDATE OR DELETE ON public.contract_final_documents
  FOR EACH ROW EXECUTE FUNCTION public.contract_evidence_block_mutation();
DROP TRIGGER IF EXISTS trg_contract_final_documents_no_truncate ON public.contract_final_documents;
CREATE TRIGGER trg_contract_final_documents_no_truncate
  BEFORE TRUNCATE ON public.contract_final_documents
  FOR EACH STATEMENT EXECUTE FUNCTION public.contract_evidence_block_mutation();

ALTER TABLE public.contract_signature_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_final_documents    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_signature_evidence FROM anon, authenticated;
REVOKE ALL ON public.contract_final_documents    FROM anon, authenticated;

-- 5) 비공개 보관 버킷 (storage.objects 정책 없음 = 서비스 롤 전용, 열람은 서버가 발급하는 서명 URL)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contract-archives', 'contract-archives', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
