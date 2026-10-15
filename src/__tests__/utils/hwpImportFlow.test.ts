/**
 * importHwp 연결·오류 분류 — hwp-convert 의 hwpToHwpx 만 대체해(합성 HWPX 반환) .hwp 성공 경로의 배선을 검증한다.
 * 실문서(.hwp) 샘플은 개인정보 우려로 저장소에 두지 않는다.
 */
import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({ next: null as null | (() => Promise<Uint8Array>) }))

vi.mock('hwp-convert', async (orig) => {
  const actual = await orig<typeof import('hwp-convert')>()
  return { ...actual, hwpToHwpx: vi.fn(() => (state.next ? state.next() : Promise.reject(new Error('no mock')))) }
})

import { htmlToHwpx } from 'hwp-convert'
import { importHwp } from '$lib/utils/docImport/hwpxImport'

const file = () => new File([new Uint8Array([1, 2, 3]).buffer as ArrayBuffer], 'a.hwp')

function namedError(name: string): Error {
  const e = new Error('x')
  e.name = name // minify 로 클래스명이 줄어드는 환경을 흉내: constructor.name 은 'Error', name 만 원래 이름
  return e
}

describe('importHwp — hwpToHwpx 경유 성공 경로', () => {
  it('hwpToHwpx 결과를 HTML로 변환해 돌려준다', async () => {
    state.next = () => htmlToHwpx('<h1>제목</h1><table border="1"><tr><td colspan="2">병합</td></tr></table>')
    const { html, warnings } = await importHwp(file())
    expect(html).toContain('제목')
    expect(html).toContain('colspan="2"')
    expect(warnings.length).toBe(1)
  })
})

describe('오류 분류는 err.name 기반(번들 minify 대비)', () => {
  it.each([
    ['HwpEncryptedError', '암호가 걸린'],
    ['HwpxEncryptedDocumentError', '암호가 걸린'],
    ['HwpUnsupportedError', '배포용'],
    ['HwpInvalidFormatError', '형식이 아니거나'],
    ['InvalidHwpxFormatError', '형식이 아니거나'],
  ])('%s → 안내 문구', async (name, expected) => {
    state.next = () => Promise.reject(namedError(name))
    await expect(importHwp(file())).rejects.toThrow(expected)
  })

  it('알 수 없는 오류는 일반 안내', async () => {
    state.next = () => Promise.reject(new Error('boom'))
    await expect(importHwp(file())).rejects.toThrow('변환하지 못했어요')
  })
})
