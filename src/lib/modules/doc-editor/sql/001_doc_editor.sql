-- ============================================================================
-- doc-editor 001 — 문서 & 양식 통합 편집기 저장소 (이식용 SQL 번들)
--
-- 만드는 것:
--   · doc_templates          문서·양식 본문(TipTap 문서 JSON) + 부가 데이터
--   · doc_signature_assets   서명/직인 이미지 목록
--   · storage 버킷 'doc-editor-assets' (이미지 공개 읽기)
--   · updated_at 자동 갱신 트리거
--   · RLS: 켜고 정책은 만들지 않는다 → service_role(서버) 전용. 브라우저 직접 접근이 필요하면 아래 [선택] 정책을 참고해 직접 추가.
--
-- 실행: Supabase SQL Editor 또는 마이그레이션 도구로 1회. 되돌리기: 001_doc_editor.rollback.sql
-- 이 파일은 멱등(IF NOT EXISTS)이라 여러 번 실행해도 안전하다.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION public.doc_editor_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── 문서·양식 ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doc_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL CHECK (length(btrim(title)) > 0),
  kind        text        NOT NULL DEFAULT 'doc',
  -- 통합 편집기 저장 포맷: [{ "type": "tiptap-doc", "doc": { ...TipTap JSON... } }] (원소 정확히 1개)
  content     jsonb       NOT NULL
              CHECK (
                jsonb_typeof(content) = 'array'
                AND jsonb_array_length(content) = 1
                AND content -> 0 ->> 'type' = 'tiptap-doc'
                AND (content -> 0) ? 'doc'
              ),
  meta        jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS doc_templates_kind_updated_idx
  ON public.doc_templates (kind, updated_at DESC)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS doc_templates_touch_updated_at ON public.doc_templates;
CREATE TRIGGER doc_templates_touch_updated_at
  BEFORE UPDATE ON public.doc_templates
  FOR EACH ROW EXECUTE FUNCTION public.doc_editor_touch_updated_at();

-- ── 서명/직인 자산 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.doc_signature_assets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type    text        NOT NULL CHECK (asset_type IN ('signature', 'seal')),
  label         text,
  image_url     text        NOT NULL CHECK (length(btrim(image_url)) > 0),
  storage_path  text,
  is_default    boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- 종류별 기본 자산은 최대 1개(삭제되지 않은 것 기준)
CREATE UNIQUE INDEX IF NOT EXISTS doc_signature_assets_default_per_type_idx
  ON public.doc_signature_assets (asset_type)
  WHERE is_default AND deleted_at IS NULL;

-- ── RLS: 켜고 정책 없음 = service_role 전용 ────────────────────────────────
ALTER TABLE public.doc_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doc_signature_assets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.doc_templates        FROM anon, authenticated;
REVOKE ALL ON public.doc_signature_assets FROM anon, authenticated;
-- 트리거 함수는 내부용 — 외부 호출 차단
REVOKE ALL ON FUNCTION public.doc_editor_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- [선택] 로그인한 사용자가 브라우저에서 직접 읽게 하려면(읽기 전용 예):
--   GRANT SELECT ON public.doc_templates TO authenticated;
--   CREATE POLICY doc_templates_read ON public.doc_templates
--     FOR SELECT TO authenticated USING (deleted_at IS NULL AND status = 'active');

-- ── Storage 버킷(이미지, 공개 읽기) ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'doc-editor-assets', 'doc-editor-assets', true, 10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/heif', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;
-- 업로드는 서버(service_role)가 하거나, 브라우저 업로드가 필요하면 storage.objects 에 INSERT 정책을 직접 추가한다.
