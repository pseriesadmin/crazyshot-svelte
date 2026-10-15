/**
 * sqlBundle.test.ts — 이식용 SQL 번들 구조 점검 (정적)
 *
 * 실제 실행 검증은 Stage에서 롤백 트랜잭션으로 수행했다(제약·트리거·RLS·권한·버킷 — TASK.md P5 기록).
 * 여기서는 번들이 어댑터가 쓰는 테이블·컬럼과 어긋나지 않는지, 안전 장치가 빠지지 않았는지만 지킨다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'src/lib/modules/doc-editor')
const up = readFileSync(join(dir, 'sql/001_doc_editor.sql'), 'utf-8')
const down = readFileSync(join(dir, 'sql/001_doc_editor.rollback.sql'), 'utf-8')
const docStore = readFileSync(join(dir, 'adapters/supabase/docStore.ts'), 'utf-8')
const sigStore = readFileSync(join(dir, 'adapters/supabase/signatureStore.ts'), 'utf-8')

describe('doc-editor SQL 번들', () => {
  it('어댑터가 쓰는 컬럼이 모두 테이블 정의에 있다', () => {
    for (const col of ['id', 'title', 'kind', 'content', 'meta', 'status', 'created_at', 'updated_at', 'deleted_at']) {
      expect(up, `doc_templates.${col}`).toMatch(new RegExp(`\\b${col}\\b\\s+(uuid|text|jsonb|timestamptz)`))
      expect(docStore).toContain(col)
    }
    for (const col of ['asset_type', 'label', 'image_url', 'storage_path', 'is_default', 'created_at', 'deleted_at']) {
      expect(up, `doc_signature_assets.${col}`).toMatch(new RegExp(`\\b${col}\\b\\s+(text|boolean|timestamptz)`))
      expect(sigStore).toContain(col)
    }
  })

  it('저장 포맷 CHECK: content는 tiptap-doc 원소 1개 배열', () => {
    expect(up).toContain("jsonb_array_length(content) = 1")
    expect(up).toContain("content -> 0 ->> 'type' = 'tiptap-doc'")
  })

  it('RLS를 켜고 anon·authenticated 권한을 회수한다(서버 전용 기본값)', () => {
    expect(up).toContain('ALTER TABLE public.doc_templates        ENABLE ROW LEVEL SECURITY')
    expect(up).toContain('ALTER TABLE public.doc_signature_assets ENABLE ROW LEVEL SECURITY')
    expect(up).toMatch(/REVOKE ALL ON public\.doc_templates\s+FROM anon, authenticated/)
    expect(up).toContain('REVOKE ALL ON FUNCTION public.doc_editor_touch_updated_at() FROM PUBLIC, anon, authenticated')
  })

  it('트리거 함수는 search_path를 고정한다', () => {
    expect(up).toMatch(/doc_editor_touch_updated_at\(\)[\s\S]*SET search_path = public/)
  })

  it('멱등: 생성문은 IF NOT EXISTS / OR REPLACE / ON CONFLICT 를 쓴다', () => {
    for (const m of up.match(/CREATE TABLE[^\n]*/g) ?? []) expect(m).toContain('IF NOT EXISTS')
    for (const m of up.match(/CREATE (UNIQUE )?INDEX[^\n]*/g) ?? []) expect(m).toContain('IF NOT EXISTS')
    expect(up).toContain('CREATE OR REPLACE FUNCTION')
    expect(up).toContain('ON CONFLICT (id) DO NOTHING')
  })

  it('롤백 파일은 번들이 만든 테이블·함수를 모두 제거한다', () => {
    expect(down).toContain('DROP TABLE IF EXISTS public.doc_signature_assets')
    expect(down).toContain('DROP TABLE IF EXISTS public.doc_templates')
    expect(down).toContain('DROP FUNCTION IF EXISTS public.doc_editor_touch_updated_at()')
  })

  it('프로젝트 고유 객체(cms_*·contract_*·user_profiles 등)를 참조하지 않는다', () => {
    expect(up).not.toMatch(/\b(cms_|contract_|user_profiles|rental_|is_cms_user)/)
  })
})
