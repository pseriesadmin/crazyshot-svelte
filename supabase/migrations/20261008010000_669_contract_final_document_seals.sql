-- Migration #669: 전자계약 최종본 PDF "서명 봉인"(Ed25519) + 쪽별 지문 지도 (2026-10-08, Stephen 승인 — 위·변조 대비 1단계)
--
-- 배경: contract_final_documents.pdf_sha256은 같은 DB/저장소를 함께 바꾸는 내부자가 지문까지 새로 쓰면 막을 수 없다
--   (추가 전용 트리거는 서비스 롤의 일반 SQL만 막는다). 서버 비밀키(Vercel 환경변수 ARCHIVE_SEAL_KEY, DB에 없음)로
--   "이 계약·이 서명·이 PDF 지문·이 쪽별 지문 지도"에 전자서명을 만들어 보관하면, DB와 저장소를 모두 바꿔도 새 서명을
--   만들 수 없어 대조 시 즉시 드러난다. 공개키는 누구에게나 공개되어 DB 없이도 검증할 수 있다.
--
-- 이 마이그레이션이 하는 일:
--   contract_final_document_seals — 최종본 PDF 1건당 1행(봉인 메시지·서명·키 식별자·쪽별 지문 지도)
--   · 추가 전용(UPDATE·DELETE·TRUNCATE 차단 — #650의 contract_evidence_block_mutation 재사용), RLS 활성 + 정책 0건(서비스 롤 전용)
--   · page_map은 본문 텍스트가 아니라 쪽·줄별 해시만 담는다(개인정보 없음). 변경 위치 표시는 관리자 화면 전용.
--
-- 롤백(Stage 검증용 — Production에서는 봉인이 쌓인 뒤 사용 금지): DROP TABLE public.contract_final_document_seals;

CREATE TABLE IF NOT EXISTS public.contract_final_document_seals (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  final_document_id uuid        NOT NULL UNIQUE REFERENCES public.contract_final_documents(id) ON DELETE RESTRICT,
  contract_id       uuid        NOT NULL,
  seal_version      smallint    NOT NULL DEFAULT 1,
  algorithm         text        NOT NULL CHECK (algorithm = 'ed25519'),
  key_id            text        NOT NULL,   -- 서명 공개키 지문(앞 16자) — 키 교체 후에도 어떤 키로 봉인했는지 식별
  message           text        NOT NULL,   -- 서명 대상 원문(계약·증적·최종본 id, 서명일시, PDF 지문, 지도 지문)
  signature         text        NOT NULL,   -- base64
  page_map          jsonb       NOT NULL,   -- 쪽별 텍스트 지문 지도 {v:1, pages:[{n, compactSha, lines[], chars}]}
  page_map_sha256   text        NOT NULL,   -- 정규화 직렬화한 page_map의 SHA-256(message에 포함되어 지도 변조도 막는다)
  sealed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_final_document_seals_contract
  ON public.contract_final_document_seals (contract_id);

DROP TRIGGER IF EXISTS trg_contract_final_document_seals_immutable ON public.contract_final_document_seals;
CREATE TRIGGER trg_contract_final_document_seals_immutable
  BEFORE UPDATE OR DELETE ON public.contract_final_document_seals
  FOR EACH ROW EXECUTE FUNCTION public.contract_evidence_block_mutation();
DROP TRIGGER IF EXISTS trg_contract_final_document_seals_no_truncate ON public.contract_final_document_seals;
CREATE TRIGGER trg_contract_final_document_seals_no_truncate
  BEFORE TRUNCATE ON public.contract_final_document_seals
  FOR EACH STATEMENT EXECUTE FUNCTION public.contract_evidence_block_mutation();

ALTER TABLE public.contract_final_document_seals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contract_final_document_seals FROM anon, authenticated;
