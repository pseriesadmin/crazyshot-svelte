/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 상품설명서(PDF) — 서버 연결 지점 소스 스캔(2026-10-29)
 * 저장 경로가 한 곳이라도 검증(경로 소유·개수·크기)을 건너뛰거나 재고(자식) 상품 차단에서 빠지면 안 된다.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8')

describe('상품목록 패널 저장(updateSection manuals)', () => {
  const src = read('src/routes/cms/products/+page.server.ts')
  it('재고(자식) 상품은 manuals 저장 차단 목록에 포함', () => {
    const m = src.match(/const childBlockedSections = \[([^\]]+)\]/)
    expect(m?.[1]).toContain("'manuals'")
  })
  it('서버가 경로 소유·개수·크기를 다시 검사하고, 빠진 파일은 저장소에서 지운다', () => {
    const at = src.indexOf("if (sectionType === 'manuals') {")
    expect(at).toBeGreaterThan(-1)
    const body = src.slice(at, at + 1600)
    expect(body).toContain('parseManualFilesInput(')
    expect(body).toContain('removedManualPaths(')
    expect(body).toContain('PRODUCT_MANUAL_BUCKET')
    expect(body).toContain(".update({ manual_files: parsed.files })")
  })
})

describe('상품 등록 저장', () => {
  const src = read('src/routes/cms/products/new/+page.server.ts')
  it('등록 화면에서 올린 임시(temp/) 경로만 허용하고 검증 결과를 INSERT 에 넣는다', () => {
    expect(src).toContain("parseManualFilesInput(form.get('manual_files') as string | null, { productId: null, existing: [] })")
    expect(src).toMatch(/\.insert\(\{[\s\S]*?manual_files,/)
  })
})

describe('상품 등록 — 이관 후 저장 실패 처리', () => {
  it('이관 결과 저장은 재시도·되돌리기를 하는 공용 함수(persistAdoptedManualFiles)로 한다', () => {
    const src = read('src/routes/cms/products/new/+page.server.ts')
    expect(src).toContain('persistAdoptedManualFiles(')
    expect(/adopted\.changed\)\s*\{[\s\S]{0,400}\.update\(\{ manual_files: adopted\.files \}\)/.test(src)).toBe(false)
  })
})

describe('패널 조회·고객 상세', () => {
  it('상품목록 상세 로더가 부모 기준 manual_files 를 내려준다(자식 선택 시에도 부모 값)', () => {
    const src = read('src/lib/server/products/loadSelectedProductDetail.ts')
    expect(src).toContain('specifications, manual_files')
    expect(src).toContain('manual_files:        src.manual_files')
  })
  it('고객 상품상세는 저장값을 normalizeManualFiles 로 걸러(잘못된 경로 제외) 공개 주소로만 연다', () => {
    const src = read('src/routes/products/[id]/+page.svelte')
    expect(src).toContain('normalizeManualFiles(')
    expect(src).toContain('manualPublicUrl(manualViewerFile.path, getSupabaseUrl())')
    expect(src).toContain('<PdfModal')
  })
})

describe('마이그레이션 #781', () => {
  const sql = read('supabase/migrations/20261029100000_781_product_manual_files.sql')
  it('컬럼·개수 제약·공개 PDF 버킷(10MB)을 만든다', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS manual_files jsonb NOT NULL DEFAULT')
    expect(sql).toContain('jsonb_array_length(manual_files) <= 10')
    expect(sql).toContain("'product-manuals', 'product-manuals', true, 10485760, ARRAY['application/pdf']")
  })
  it('storage.objects 정책(익명 직접 업로드 경로)을 만들지 않는다', () => {
    expect(/CREATE\s+POLICY/i.test(sql)).toBe(false)
  })
})
