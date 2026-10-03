import { describe, it, expect, vi } from 'vitest'
import { toDocPath, toDocPaths, isPdfPath, docExtension, signDocPath } from '../../lib/server/userDocs'

/**
 * userDocs 헬퍼 — 서류 경로 양쪽 형식 해석(공개 URL·경로) + 서명 URL 발급 (2026-10-03, 서류 비공개 전환 B1)
 * 완료기준: 전환 전(공개 URL)·후(경로) 값을 같은 경로로 해석, 타 사용자 폴더·경로 탈출·알 수 없는 URL은 거부, 서명은 짧은 만료+download 옵션 전달
 */
const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
const OTHER = '11111111-2222-3333-4444-555555555555'
const PATH = `${UID}/identity_9f1c0f1e-0000-4000-8000-000000000000.png`
const PUB_PROD = `https://vnbpmvxruyciuuaermyh.supabase.co/storage/v1/object/public/user-documents/${PATH}`
const PUB_STAGE = `https://ezyvffjvuwmtuhpxdjrw.supabase.co/storage/v1/object/public/user-documents/${PATH}`

describe('toDocPath', () => {
  it('공개 URL(Production·Stage 어느 호스트든)과 경로를 같은 경로로 해석', () => {
    expect(toDocPath(PUB_PROD, UID)).toBe(PATH)
    expect(toDocPath(PUB_STAGE, UID)).toBe(PATH)
    expect(toDocPath(PATH, UID)).toBe(PATH)
  })
  it('쿼리·해시가 붙은 URL은 제거', () => {
    expect(toDocPath(`${PUB_PROD}?download=a.png#x`, UID)).toBe(PATH)
  })
  it('다른 사용자 폴더는 ownerUid 지정 시 거부, 미지정 시 통과', () => {
    expect(toDocPath(PATH, OTHER)).toBeNull()
    expect(toDocPath(PATH)).toBe(PATH)
  })
  it('경로 탈출(..)·빈 세그먼트·빈 값·null은 거부', () => {
    expect(toDocPath(`${UID}/../${OTHER}/x.png`, UID)).toBeNull()
    expect(toDocPath(`${UID}//x.png`, UID)).toBeNull()
    expect(toDocPath('', UID)).toBeNull()
    expect(toDocPath(null, UID)).toBeNull()
    expect(toDocPath(undefined, UID)).toBeNull()
  })
  it('인코딩된 경로 탈출도 거부', () => {
    expect(toDocPath(`${UID}/%2e%2e/${OTHER}/x.png`, UID)).toBeNull()
  })
  it('NUL·제어문자·백슬래시가 디코딩 후 나타나면 거부', () => {
    expect(toDocPath(`${UID}/x.png%00.jpg`, UID)).toBeNull()
    expect(toDocPath(`${UID}/x\u0000.png`, UID)).toBeNull()
    expect(toDocPath(`${UID}/a\\b.png`, UID)).toBeNull()
    expect(toDocPath(`${UID}/..%5cx.png`, UID)).toBeNull()
    expect(toDocPath(`${UID}/x%0a.png`, UID)).toBeNull()
  })
  it('다른 버킷·알 수 없는 스킴의 URL은 경로로 취급하지 않는다', () => {
    expect(toDocPath(`https://x.supabase.co/storage/v1/object/public/product-images/${PATH}`, UID)).toBeNull()
    expect(toDocPath('javascript:alert(1)', UID)).toBeNull()
    expect(toDocPath('//evil.example/a.png', UID)).toBeNull()
  })
})

describe('toDocPaths', () => {
  it('두 형식을 섞어도 유효한 경로만 중복 없이 반환', () => {
    const other = `${UID}/identity_aaaa.pdf`
    expect(toDocPaths([PUB_PROD, PATH, other, `${OTHER}/x.png`, null], UID)).toEqual([PATH, other])
  })
})

describe('isPdfPath / docExtension', () => {
  it('확장자로 판정(서명 URL 꼬리에 의존하지 않음)', () => {
    expect(isPdfPath(`${UID}/identity_a.PDF`)).toBe(true)
    expect(isPdfPath(PATH)).toBe(false)
    expect(docExtension(PATH)).toBe('png')
    expect(docExtension(`${UID}/noext`)).toBe('')
  })
})

describe('signDocPath', () => {
  function adminWith(result: { data: { signedUrl: string } | null; error: { message: string } | null }) {
    const createSignedUrl = vi.fn().mockResolvedValue(result)
    const from = vi.fn().mockReturnValue({ createSignedUrl })
    return { admin: { storage: { from } } as never, from, createSignedUrl }
  }

  it('user-documents 버킷에 60초 기본 만료로 서명하고 download 옵션을 전달', async () => {
    const { admin, from, createSignedUrl } = adminWith({ data: { signedUrl: 'https://signed/x' }, error: null })
    const r = await signDocPath(admin, PATH, { download: 'm1_identity_1.png' })
    expect(from).toHaveBeenCalledWith('user-documents')
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, 60, { download: 'm1_identity_1.png' })
    expect(r).toEqual({ url: 'https://signed/x', isPdf: false, expiresIn: 60 })
  })

  it('download 미지정이면 옵션 없이 호출, PDF 여부는 경로로 판정', async () => {
    const { admin, createSignedUrl } = adminWith({ data: { signedUrl: 'https://signed/y' }, error: null })
    const r = await signDocPath(admin, `${UID}/identity_a.pdf`)
    expect(createSignedUrl).toHaveBeenCalledWith(`${UID}/identity_a.pdf`, 60, undefined)
    expect(r?.isPdf).toBe(true)
  })

  it('발급 실패 시 null(예외 없음)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = adminWith({ data: null, error: { message: 'not found' } })
    expect(await signDocPath(admin, PATH)).toBeNull()
    err.mockRestore()
  })
})
