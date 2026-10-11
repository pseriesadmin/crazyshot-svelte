-- 691_nlsearch_vector_models.sql
-- B-3(2026-10-10): 자체 마이크로 엔진 v0 — 의미 벡터 모델 메타 테이블 + 비공개 저장 버킷.
--  · nlsearch_vector_models: 모델 파일 1개당 1행. 파일 업로드가 끝난 "뒤에" 행을 넣는다(행이 있으면 파일이 완성돼 있다는 보장).
--    corpus_hash=말뭉치 입력 해시(같으면 재빌드 생략), file_hash=저장 파일 SHA-256(로드 시 검증), corpus_stats=숫자만(개인정보·원문 없음).
--  · 버킷 nlsearch-models: 비공개, storage.objects 정책 없음 = service_role 전용.
-- 권한: RLS ON·정책 0건·anon/authenticated 권한 없음.
-- 롤백: DROP TABLE public.nlsearch_vector_models; DELETE FROM storage.buckets WHERE id='nlsearch-models'; (버킷이 비어 있을 때만)

CREATE TABLE IF NOT EXISTS public.nlsearch_vector_models (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version       integer     NOT NULL UNIQUE,
  dim           integer     NOT NULL CHECK (dim > 0),
  vocab_size    integer     NOT NULL CHECK (vocab_size >= 0),
  corpus_hash   text        NOT NULL,
  file_hash     text        NOT NULL,
  storage_path  text        NOT NULL,
  status        text        NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'retired')),
  corpus_stats  jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(corpus_stats) = 'object'),
  built_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nlsearch_vector_models_ready_idx
  ON public.nlsearch_vector_models (version DESC) WHERE status = 'ready';

ALTER TABLE public.nlsearch_vector_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nlsearch_vector_models FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.nlsearch_vector_models TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nlsearch-models', 'nlsearch-models', false, 20971520, ARRAY['application/octet-stream'])
ON CONFLICT (id) DO NOTHING;
