import { describe, it, expect } from 'vitest'
import { hasMetaRefresh, heroBannerMediaKind, injectCsp, isTrustedHeroMediaUrl } from '$lib/utils/heroBannerMedia'

describe('heroBannerMediaKind', () => {
  it('확장자로 이미지·영상·HTML을 구분한다', () => {
    expect(heroBannerMediaKind('https://x.co/a/b.png')).toBe('image')
    expect(heroBannerMediaKind('https://x.co/a/b.MP4')).toBe('video')
    expect(heroBannerMediaKind('https://x.co/a/b.html')).toBe('html')
    expect(heroBannerMediaKind('https://x.co/a/b.htm?v=1#t')).toBe('html')
    expect(heroBannerMediaKind('/home/mobile/x.webp')).toBe('image')
  })
})

const ENV = 'https://abcd1234.supabase.co'
const OWN = `${ENV}/storage/v1/object/public/home-hero-media/home/hero-banner/x.html`

describe('isTrustedHeroMediaUrl', () => {
  it('이 프로젝트의 전용 저장소 주소만 신뢰한다', () => {
    expect(isTrustedHeroMediaUrl(OWN, ENV)).toBe(true)
    expect(isTrustedHeroMediaUrl('https://evil.example/x.html', ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(`${ENV}/storage/v1/object/public/product-images/x.mp4`, ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(OWN.replace('https:', 'http:'), ENV)).toBe(false)
  })
  it('다른 Supabase 프로젝트·계정정보·포트·경로 우회는 거절한다', () => {
    expect(isTrustedHeroMediaUrl(OWN.replace('abcd1234', 'attacker'), ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(OWN.replace('https://', 'https://user:pw@'), ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(OWN.replace('.co/', '.co:8443/'), ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(`${ENV}/storage/v1/object/public/home-hero-media/../product-images/x.mp4`, ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(`${ENV}/storage/v1/object/public/home-hero-media/%2e%2e/x.mp4`, ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl('https://abcd1234.supabase.co.evil.example/storage/v1/object/public/home-hero-media/x.html', ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(`${ENV}/storage/v1/object/public/home-hero-media/%252e/x.mp4`, ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(`${ENV}/storage/v1/object/public/home-hero-media/%5Cx.mp4`, ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(`${ENV}/storage/v1/object/public/home-hero-media/a\\b.mp4`, ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl('not a url', ENV)).toBe(false)
    expect(isTrustedHeroMediaUrl(OWN, '')).toBe(false)
  })
})

describe('injectCsp', () => {
  const CSP = "default-src 'none'"
  it('DOCTYPE 뒤에 넣어 표준 모드를 유지한다', () => {
    const out = injectCsp('<!DOCTYPE html><html><head></head></html>', CSP)
    expect(out.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true)
  })
  it('DOCTYPE 이 없으면 붙여서 맨 앞에 CSP 를 둔다(BOM 제거 포함)', () => {
    const out = injectCsp('\uFEFF<script>1</script>', CSP)
    expect(out.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(out.indexOf('<script>')).toBeGreaterThan(out.indexOf('Content-Security-Policy'))
  })
})

describe('hasMetaRefresh', () => {
  it('meta refresh 를 감지한다', () => {
    expect(hasMetaRefresh('<meta http-equiv="refresh" content="0;url=https://x">')).toBe(true)
    expect(hasMetaRefresh("<META HTTP-EQUIV='Refresh' content='0'>")).toBe(true)
    expect(hasMetaRefresh('<meta charset="utf-8"><p>hi</p>')).toBe(false)
  })
})
