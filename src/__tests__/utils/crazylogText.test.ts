import { describe, it, expect } from 'vitest'
import { plainTextPreview } from '$lib/utils/crazylogText'

describe('plainTextPreview — 크레이지로그 본문 미리보기(&nbsp; 노출 수정)', () => {
  it("에디터가 만든 '&nbsp; &nbsp; …'를 일반 공백으로 정리해 빈 문자열이 된다", () => {
    expect(plainTextPreview('<p>&nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;</p>')).toBe('')
  })

  it('앞쪽 &nbsp; 뒤의 실제 문장은 그대로 남는다', () => {
    expect(plainTextPreview('<p>&nbsp; &nbsp;안녕하세요 &amp; 반가워요&lt;3</p><p>둘째&nbsp;줄</p>')).toBe('안녕하세요 & 반가워요<3 둘째 줄')
  })

  it('태그는 공백으로 바뀌어 문단 사이 단어가 붙지 않는다', () => {
    expect(plainTextPreview('<p>첫째</p><p>둘째</p>')).toBe('첫째 둘째')
  })

  it('실제 NBSP(U+00A0)·연속 공백·줄바꿈을 하나로 정리한다', () => {
    expect(plainTextPreview('a  b\n\n c')).toBe('a b c')
  })

  it('최대 길이(기본 120자)로 자른다', () => {
    expect(plainTextPreview('<p>' + 'a'.repeat(200) + '</p>')).toHaveLength(120)
    expect(plainTextPreview('<p>abcdef</p>', 3)).toBe('abc')
  })

  it('따옴표 엔티티 디코딩', () => {
    expect(plainTextPreview('&quot;hi&quot; &#39;x&#39;')).toBe('"hi" \'x\'')
  })
})
