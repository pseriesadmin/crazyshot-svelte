import { describe, it, expect } from 'vitest'
import { imageBlockStyle, normalizeImageAlign, normalizeImageWidth } from '$lib/types/content-editor'
import { sanitizeCrazylogBlocks } from '$lib/server/sanitizeCrazylogHtml'

describe('이미지 묶음 폭·정렬 값 검증(화면 스타일로 쓰이므로)', () => {
  it('폭은 20~100 정수로 한정, 비정상은 100', () => {
    expect(normalizeImageWidth(50)).toBe(50)
    expect(normalizeImageWidth('75')).toBe(75)
    expect(normalizeImageWidth(5)).toBe(20)
    expect(normalizeImageWidth(1000)).toBe(100)
    expect(normalizeImageWidth('50%; position:fixed')).toBe(100)
    expect(normalizeImageWidth(undefined)).toBe(100)
    expect(normalizeImageWidth(NaN)).toBe(100)
    expect(normalizeImageWidth('')).toBe(100) // 빈 문자열이 20%로 올라가지 않음
    expect(normalizeImageWidth('  ')).toBe(100)
  })
  it('정렬은 left/center/right만', () => {
    expect(normalizeImageAlign('left')).toBe('left')
    expect(normalizeImageAlign('right')).toBe('right')
    expect(normalizeImageAlign('<script>')).toBe('center')
  })
  it('스타일 문자열: 기본값이면 빈 문자열, 그 외는 안전한 값만', () => {
    expect(imageBlockStyle(undefined, undefined)).toBe('')
    expect(imageBlockStyle(100, 'center')).toBe('')
    expect(imageBlockStyle(50, 'right')).toBe('width: 50%; align-self: flex-end')
    // 비정상 폭은 100%로 보정되고 주입 문자열은 결과에 남지 않는다
    expect(imageBlockStyle('1;background:url(x)', 'left')).toBe('width: 100%; align-self: flex-start')
    expect(imageBlockStyle('50%; position:fixed', '"><script>')).toBe('width: 100%; align-self: center'.replace('width: 100%; align-self: center', ''))
  })
  it('서버 정화가 이미지 블록의 폭·정렬을 허용 범위로 고친다', () => {
    const out = sanitizeCrazylogBlocks([{ type: 'image', layout: 'individual', images: [], width: '9999px', align: 'evil' }]) as Array<Record<string, unknown>>
    expect(out[0].width).toBe(100)
    expect(out[0].align).toBe('center')
    const untouched = sanitizeCrazylogBlocks([{ type: 'image', layout: 'individual', images: [] }]) as Array<Record<string, unknown>>
    expect('width' in untouched[0]).toBe(false)
  })
})
