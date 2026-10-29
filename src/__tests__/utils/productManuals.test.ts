import { describe, it, expect } from 'vitest'
import {
  PRODUCT_MANUAL_BUCKET,
  MAX_PRODUCT_MANUALS,
  MAX_PRODUCT_MANUAL_BYTES,
  validateManualUpload,
  buildManualPath,
  isValidManualPath,
  normalizeManualFiles,
  parseManualFilesInput,
  removedManualPaths,
  manualPublicUrl,
  manualsToViewerItems,
  formatManualSize,
  type ProductManualFile,
} from '$lib/utils/productManuals'

const PID = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b'
const U1 = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb'
const U2 = 'cccccccc-1111-4222-8333-dddddddddddd'

function file(path: string, extra: Partial<ProductManualFile> = {}): ProductManualFile {
  return { path, name: '설명서.pdf', size: 1000, uploaded_at: '2026-10-29T03:00:00.000Z', ...extra }
}

describe('상품설명서 업로드 검증', () => {
  it('PDF 10MB 이하는 통과', () => {
    expect(validateManualUpload('application/pdf', 1024).ok).toBe(true)
    expect(validateManualUpload('application/pdf', MAX_PRODUCT_MANUAL_BYTES).ok).toBe(true)
  })
  it('PDF가 아니면 거절', () => {
    const r = validateManualUpload('image/png', 1024)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('PDF')
  })
  it('10MB 초과·0바이트·숫자 아님은 거절', () => {
    expect(validateManualUpload('application/pdf', MAX_PRODUCT_MANUAL_BYTES + 1).ok).toBe(false)
    expect(validateManualUpload('application/pdf', 0).ok).toBe(false)
    expect(validateManualUpload('application/pdf', Number.NaN).ok).toBe(false)
  })
  it('버킷 이름·상한 상수', () => {
    expect(PRODUCT_MANUAL_BUCKET).toBe('product-manuals')
    expect(MAX_PRODUCT_MANUALS).toBe(10)
    expect(MAX_PRODUCT_MANUAL_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('저장 경로', () => {
  it('상품 id 범위 경로는 {상품id}/{uuid}.pdf', () => {
    const p = buildManualPath(PID)
    expect(p.startsWith(`${PID}/`)).toBe(true)
    expect(p.endsWith('.pdf')).toBe(true)
    expect(isValidManualPath(p)).toBe(true)
  })
  it('등록 전 임시 범위 경로(temp/…)도 유효', () => {
    const p = buildManualPath('temp/abc123_xyz')
    expect(p.startsWith('temp/abc123_xyz/')).toBe(true)
    expect(isValidManualPath(p)).toBe(true)
  })
  it('경로 탈출·확장자 오류·형식 오류는 무효', () => {
    expect(isValidManualPath(`${PID}/../${U1}.pdf`)).toBe(false)
    expect(isValidManualPath(`${PID}/${U1}.exe`)).toBe(false)
    expect(isValidManualPath(`${PID}/${U1}.PDF`)).toBe(false)
    expect(isValidManualPath('../x/' + U1 + '.pdf')).toBe(false)
    expect(isValidManualPath('https://evil.test/a.pdf')).toBe(false)
    expect(isValidManualPath('')).toBe(false)
    expect(isValidManualPath(`temp/${U1}.pdf`)).toBe(false)
  })
})

describe('저장값 읽기(normalizeManualFiles) — 관대하게', () => {
  it('배열이 아니면 빈 목록', () => {
    expect(normalizeManualFiles(null)).toEqual([])
    expect(normalizeManualFiles('x')).toEqual([])
    expect(normalizeManualFiles({})).toEqual([])
  })
  it('잘못된 항목은 버리고 정상 항목만 남긴다', () => {
    const good = file(`${PID}/${U1}.pdf`)
    const out = normalizeManualFiles([good, { path: 'bad', name: 'x', size: 1 }, null, 7])
    expect(out).toEqual([good])
  })
})

describe('저장 입력 검증(parseManualFilesInput) — 엄격하게', () => {
  const ctx = { productId: PID, existing: [] as ProductManualFile[] }

  it('빈 값·빈 배열은 빈 목록으로 통과', () => {
    expect(parseManualFilesInput('', ctx)).toEqual({ ok: true, files: [] })
    expect(parseManualFilesInput('[]', ctx)).toEqual({ ok: true, files: [] })
    expect(parseManualFilesInput(null, ctx)).toEqual({ ok: true, files: [] })
  })
  it('JSON이 아니거나 배열이 아니면 거절', () => {
    expect(parseManualFilesInput('{oops', ctx).ok).toBe(false)
    expect(parseManualFilesInput('{"a":1}', ctx).ok).toBe(false)
  })
  it('자기 상품 폴더 파일은 통과, 이름은 다듬는다', () => {
    const r = parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`, { name: '  설명서.pdf  ' })]), ctx)
    expect(r.ok).toBe(true)
    expect(r.ok && r.files[0].name).toBe('설명서.pdf')
  })
  it('다른 상품 폴더의 파일은 거절(남의 파일 연결 방지)', () => {
    const other = '9a9a9a9a-1111-4222-8333-eeeeeeeeeeee'
    const r = parseManualFilesInput(JSON.stringify([file(`${other}/${U1}.pdf`)]), ctx)
    expect(r.ok).toBe(false)
  })
  it('이미 저장돼 있던 임시(temp/) 경로는 그 상품 목록에 있을 때만 허용', () => {
    const tempPath = `temp/abc123_xyz/${U1}.pdf`
    const existing = [file(tempPath)]
    expect(parseManualFilesInput(JSON.stringify([file(tempPath)]), { productId: PID, existing }).ok).toBe(true)
    expect(parseManualFilesInput(JSON.stringify([file(tempPath)]), ctx).ok).toBe(false)
  })
  it('상품 등록(상품 id 없음)은 temp/ 경로만 허용', () => {
    const tempPath = `temp/abc123_xyz/${U1}.pdf`
    expect(parseManualFilesInput(JSON.stringify([file(tempPath)]), { productId: null, existing: [] }).ok).toBe(true)
    expect(parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`)]), { productId: null, existing: [] }).ok).toBe(false)
  })
  it('최대 개수 초과·중복 경로·크기 이상은 거절', () => {
    const many = Array.from({ length: MAX_PRODUCT_MANUALS + 1 }, (_, i) =>
      file(`${PID}/${String(i).padStart(8, '0')}-1111-4222-8333-bbbbbbbbbbbb.pdf`),
    )
    expect(parseManualFilesInput(JSON.stringify(many), ctx).ok).toBe(false)
    expect(parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`), file(`${PID}/${U1}.pdf`)]), ctx).ok).toBe(false)
    expect(parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`, { size: MAX_PRODUCT_MANUAL_BYTES + 1 })]), ctx).ok).toBe(false)
    expect(parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`, { size: -1 })]), ctx).ok).toBe(false)
  })
  it('파일 이름이 비면 거절, 너무 길면 잘라낸다', () => {
    expect(parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`, { name: '   ' })]), ctx).ok).toBe(false)
    const r = parseManualFilesInput(JSON.stringify([file(`${PID}/${U1}.pdf`, { name: 'a'.repeat(500) })]), ctx)
    expect(r.ok && r.files[0].name.length).toBe(120)
  })
})

describe('삭제된 파일 찾기 · 공개 주소 · 뷰어 항목', () => {
  it('이전 목록에는 있고 새 목록에는 없는 경로만 돌려준다', () => {
    const a = file(`${PID}/${U1}.pdf`)
    const b = file(`${PID}/${U2}.pdf`)
    expect(removedManualPaths([a, b], [b])).toEqual([a.path])
    expect(removedManualPaths([a], [a])).toEqual([])
    expect(removedManualPaths([], [a])).toEqual([])
  })
  it('공개 주소는 저장소 공개 경로 규칙', () => {
    const a = file(`${PID}/${U1}.pdf`)
    expect(manualPublicUrl(a.path, 'https://x.supabase.co')).toBe(
      `https://x.supabase.co/storage/v1/object/public/product-manuals/${PID}/${U1}.pdf`,
    )
    expect(manualPublicUrl(a.path, 'https://x.supabase.co/')).toBe(
      `https://x.supabase.co/storage/v1/object/public/product-manuals/${PID}/${U1}.pdf`,
    )
  })
  it('뷰어 항목은 PDF 종류 + 파일 이름', () => {
    const a = file(`${PID}/${U1}.pdf`, { name: '사용설명서.pdf' })
    const items = manualsToViewerItems([a], 'https://x.supabase.co')
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('pdf')
    expect(items[0].name).toBe('사용설명서.pdf')
    expect(items[0].url).toContain('/product-manuals/')
  })
  it('크기 표기', () => {
    expect(formatManualSize(512)).toBe('512B')
    expect(formatManualSize(2048)).toBe('2.0KB')
    expect(formatManualSize(5 * 1024 * 1024)).toBe('5.0MB')
  })
})

describe('파일명 제어문자 제거 (sp5 SEC-C, 2026-10-29)', () => {
  const PID2 = '3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b'
  const path = `${PID2}/aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb.pdf`
  const parse = (name: string) =>
    parseManualFilesInput(JSON.stringify([{ path, name, size: 1000, uploaded_at: '2026-10-29T00:00:00.000Z' }]), { productId: PID2, existing: [] })

  it('방향 전환(RTL)·제로폭·줄바꿈 등 보이지 않는 제어문자를 지운다', () => {
    const r = parse('설명\u202Etxt.fdp\u200B\u200E\uFEFF\n서.pdf')
    expect(r.ok).toBe(true)
    expect(r.ok && r.files[0].name).toBe('설명txt.fdp서.pdf')
  })

  it('제어문자만으로 된 이름은 빈 이름으로 보고 거절한다', () => {
    expect(parse('\u202E\u200B\u0007').ok).toBe(false)
  })

  it('일반 한글·영문·공백·괄호는 그대로 둔다', () => {
    const r = parse('사용 설명서 (2) v1.0.pdf')
    expect(r.ok && r.files[0].name).toBe('사용 설명서 (2) v1.0.pdf')
  })

  it('저장값을 읽을 때(normalizeManualFiles)도 같은 규칙으로 정리한다', () => {
    const out = normalizeManualFiles([{ path, name: 'a\u202Eb.pdf', size: 1, uploaded_at: '' }])
    expect(out[0].name).toBe('ab.pdf')
  })
})
