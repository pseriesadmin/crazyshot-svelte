-- doc-editor 001 롤백 — 이 번들이 만든 객체만 제거한다. ⚠️ 저장된 문서·자산 데이터가 삭제된다.
DROP TABLE IF EXISTS public.doc_signature_assets;
DROP TABLE IF EXISTS public.doc_templates;
DROP FUNCTION IF EXISTS public.doc_editor_touch_updated_at();
-- 버킷은 파일이 남아 있으면 삭제되지 않는다. 필요하면 Storage 화면에서 비운 뒤 삭제:
--   DELETE FROM storage.buckets WHERE id = 'doc-editor-assets';
