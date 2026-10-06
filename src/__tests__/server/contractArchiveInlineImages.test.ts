import { describe, it, expect } from 'vitest'
import { inlineStorageImages, type ImageFetcher } from '$lib/server/contractArchive/inlineImages'

const BASE = 'https://proj.supabase.co/storage/v1/object/public/'
const SEAL = `${BASE}product-images/signature-assets/u1/seal.png`
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const okFetcher: ImageFetcher = async () => ({ bytes: PNG_BYTES, contentType: 'image/png' })

describe('inlineStorageImages — PDF 생성 시점에 직인 등 Storage 이미지를 데이터로 내장', () => {
  it('허용된 Storage 공개 URL 이미지를 data URI로 바꾸고 SHA-256·크기를 기록한다', async () => {
    const html = `<td><img src="${SEAL}" alt="발행자 직인" class="issuer-sig-overlay" style="width:80px" /></td>`
    const r = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: okFetcher })
    expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(r.html).not.toContain(SEAL)
    expect(r.html).toContain('class="issuer-sig-overlay"')
    expect(r.html).toContain('style="width:80px"')
    expect(r.inlined).toHaveLength(1)
    expect(r.inlined[0].url).toBe(SEAL)
    expect(r.inlined[0].bytes).toBe(8)
    expect(r.inlined[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.failed).toEqual([])
  })

  it('같은 URL이 여러 번 나와도 한 번만 가져온다', async () => {
    let calls = 0
    const html = `<img src="${SEAL}"><img src="${SEAL}">`
    const r = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: async (u) => { calls++; return okFetcher(u) } })
    expect(calls).toBe(1)
    expect(r.html.match(/data:image\/png;base64/g)?.length).toBe(2)
  })

  it('허용 주소가 아닌 http(s) 이미지는 건드리지 않고(가져오지 않고) 그대로 둔다 — SSRF 방지', async () => {
    let calls = 0
    const html = '<img src="https://evil.example.com/x.png"><img src="http://169.254.169.254/latest/meta-data">'
    const r = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: async (u) => { calls++; return okFetcher(u) } })
    expect(calls).toBe(0)
    expect(r.html).toBe(html)
    expect(r.inlined).toEqual([])
  })

  it('이미 data URI인 서명 이미지는 그대로 둔다', async () => {
    const html = '<img src="data:image/png;base64,AAAA" alt="예약자 서명">'
    const r = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: okFetcher })
    expect(r.html).toBe(html)
  })

  it('가져오기 실패는 원본을 유지하고 failed에 남긴다(PDF 생성을 막지 않음)', async () => {
    const html = `<img src="${SEAL}">`
    const r = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: async () => { throw new Error('404') } })
    expect(r.html).toBe(html)
    expect(r.failed).toEqual([{ url: SEAL, reason: '404' }])
    expect(r.inlined).toEqual([])
  })

  it('이미지가 아닌 응답·허용 크기 초과는 실패로 처리한다', async () => {
    const html = `<img src="${SEAL}">`
    const notImage = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: async () => ({ bytes: PNG_BYTES, contentType: 'text/html' }) })
    expect(notImage.failed[0].reason).toContain('content-type')
    const tooBig = await inlineStorageImages(html, { allowedBase: BASE, maxBytes: 4, fetchImage: okFetcher })
    expect(tooBig.failed[0].reason).toContain('크기')
  })

  it('src 따옴표가 작은따옴표여도 처리한다', async () => {
    const r = await inlineStorageImages(`<img src='${SEAL}'>`, { allowedBase: BASE, fetchImage: okFetcher })
    expect(r.html).toContain("src='data:image/png;base64,")
  })
})

describe('inlineStorageImages — URL 파싱 기반 허용 검사(문자열 접두사 비교 우회 방지, sp3 MINOR-2)', () => {
  const cases: [string, string][] = [
    ['호스트 뒤에 도메인을 이어붙인 스푸핑', 'https://proj.supabase.co.evil.com/storage/v1/object/public/x.png'],
    ['userinfo(@)로 호스트 위장', 'https://proj.supabase.co@evil.com/storage/v1/object/public/x.png'],
    ['점 세그먼트로 허용 경로 밖으로 탈출', `${BASE}../../../auth/v1/admin/users`],
    ['퍼센트 인코딩된 점 세그먼트', `${BASE}%2e%2e/%2e%2e/rest/v1/secret`],
    ['인코딩된 슬래시로 경로 우회', `${BASE}a%2f..%2f..%2fx.png`],
    ['다른 포트', 'https://proj.supabase.co:8443/storage/v1/object/public/x.png'],
    ['스킴 다운그레이드(http)', 'http://proj.supabase.co/storage/v1/object/public/x.png'],
    ['백슬래시 경로 혼용', 'https://proj.supabase.co/storage/v1/object/public\\..\\x.png'],
  ]
  for (const [name, url] of cases) {
    it(`가져오지 않고 그대로 둔다: ${name}`, async () => {
      let calls = 0
      const html = `<img src="${url}">`
      const r = await inlineStorageImages(html, { allowedBase: BASE, fetchImage: async (u) => { calls++; return okFetcher(u) } })
      expect(calls).toBe(0)
      expect(r.html).toBe(html)
    })
  }

  it('대소문자만 다른 호스트·스킴은 정규화되어 허용 주소로 인식된다(정상 이미지 누락 방지)', async () => {
    const r = await inlineStorageImages(`<img src="HTTPS://PROJ.SUPABASE.CO/storage/v1/object/public/product-images/a.png">`, { allowedBase: BASE, fetchImage: okFetcher })
    expect(r.inlined).toHaveLength(1)
  })

  it('쿼리스트링이 붙은 정상 URL도 허용한다', async () => {
    const r = await inlineStorageImages(`<img src="${SEAL}?v=2">`, { allowedBase: BASE, fetchImage: okFetcher })
    expect(r.inlined).toHaveLength(1)
  })
})
