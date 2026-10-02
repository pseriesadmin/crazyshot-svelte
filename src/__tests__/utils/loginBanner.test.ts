import { describe, it, expect } from 'vitest'
import { parseLoginBannerSettings, orderLoginBanners, safeBannerHref, type LoginBannerRow } from '$lib/utils/loginBanner'

/**
 * 로그인 화면 배너 — 설정 해석·노출 배너 선택 (2026-10-02)
 * 설정(cms_settings.login_banner_mode): { pc_mode, mobile_mode, mobile_visible }
 * mobile_visible=false 일 때만 모바일 배너 영역을 숨긴다(설정이 없거나 값이 이상하면 노출 — 기존 동작 보호).
 */

const row = (id: string, over: Partial<LoginBannerRow> = {}): LoginBannerRow => ({
  id, title: `t${id}`, sub_copy: null, image_url: `https://x/${id}.png`, link_url: null, ...over,
})

describe('parseLoginBannerSettings', () => {
  it('설정이 없으면 기본값(순서대로·노출)', () => {
    expect(parseLoginBannerSettings(null)).toEqual({ pcMode: 'fixed', mobileMode: 'fixed', mobileVisible: true })
    expect(parseLoginBannerSettings(undefined)).toEqual({ pcMode: 'fixed', mobileMode: 'fixed', mobileVisible: true })
  })
  it('random·false 를 그대로 반영', () => {
    expect(parseLoginBannerSettings({ pc_mode: 'random', mobile_mode: 'random', mobile_visible: false }))
      .toEqual({ pcMode: 'random', mobileMode: 'random', mobileVisible: false })
  })
  it('기존 저장값(mobile_visible 없음)은 노출 유지', () => {
    expect(parseLoginBannerSettings({ pc_mode: 'fixed', mobile_mode: 'random' }).mobileVisible).toBe(true)
  })
  it('엄격 판정: false 가 아닌 값("false"·0·null)은 숨기지 않는다', () => {
    for (const v of ['false', 0, null, 'off']) {
      expect(parseLoginBannerSettings({ mobile_visible: v }).mobileVisible).toBe(true)
    }
  })
  it('모드 값이 이상하면 fixed', () => {
    expect(parseLoginBannerSettings({ pc_mode: 'x', mobile_mode: 3 })).toMatchObject({ pcMode: 'fixed', mobileMode: 'fixed' })
  })
  it('객체가 아닌 값은 기본값', () => {
    expect(parseLoginBannerSettings('str')).toEqual({ pcMode: 'fixed', mobileMode: 'fixed', mobileVisible: true })
    expect(parseLoginBannerSettings([1])).toEqual({ pcMode: 'fixed', mobileMode: 'fixed', mobileVisible: true })
  })
})

describe('orderLoginBanners', () => {
  const ids = (r: LoginBannerRow[]) => r.map((x) => x.id)
  it('빈 목록·이미지 없는 행만 있으면 빈 배열', () => {
    expect(orderLoginBanners([], 'fixed')).toEqual([])
    expect(orderLoginBanners([row('1', { image_url: '' })], 'random')).toEqual([])
  })
  it('fixed: 등록 순서 그대로 전부 반환', () => {
    expect(ids(orderLoginBanners([row('1'), row('2'), row('3')], 'fixed'))).toEqual(['1', '2', '3'])
  })
  it('이미지 없는 행은 건너뛴다', () => {
    expect(ids(orderLoginBanners([row('1', { image_url: '' }), row('2')], 'fixed'))).toEqual(['2'])
  })
  it('random: 전부 한 번씩 포함한 섞인 순서(난수 고정 시 결정적)', () => {
    const rows = [row('1'), row('2'), row('3')]
    const out = orderLoginBanners(rows, 'random', () => 0)
    expect(ids(out).slice().sort()).toEqual(['1', '2', '3'])
    expect(ids(out)).toEqual(['2', '3', '1'])
    expect(ids(orderLoginBanners(rows, 'random', () => 0.999999))).toEqual(['1', '2', '3'])
  })
  it('원본 배열을 변경하지 않는다', () => {
    const rows = [row('1'), row('2'), row('3')]
    orderLoginBanners(rows, 'random', () => 0)
    orderLoginBanners(rows, 'fixed')
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3'])
  })
})

describe('safeBannerHref', () => {
  it('내부 경로·http(s)만 허용', () => {
    expect(safeBannerHref('/products/abc')).toBe('/products/abc')
    expect(safeBannerHref(' https://crazyshot.kr/x ')).toBe('https://crazyshot.kr/x')
    expect(safeBannerHref('http://a.b')).toBe('http://a.b')
  })
  it('javascript:·data:·프로토콜 상대(//)·빈 값·공백 포함은 null', () => {
    for (const v of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', '', '   ', null, undefined, 'https://a b', 'ftp://x', 'mailto:a@b.c']) {
      expect(safeBannerHref(v as string | null | undefined)).toBeNull()
    }
  })
})
