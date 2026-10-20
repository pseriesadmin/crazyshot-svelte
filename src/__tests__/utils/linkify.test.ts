// linkify.test.ts — 채팅 글 속 주소를 링크 조각으로: http(s)·www만, 문장부호·한글 조사 제외, 위험 스킴은 글자로만
import { describe, it, expect } from 'vitest'
import { linkifyText } from '$lib/utils/linkify'

const links = (t: string) => linkifyText(t).filter((s) => s.kind === 'link')

describe('linkifyText', () => {
  it('http(s) 주소를 링크로 나누고 앞뒤 글자는 그대로 둔다', () => {
    expect(linkifyText('자세한 내용은 https://crazyshot.kr/products/a 에서 확인하세요')).toEqual([
      { kind: 'text', text: '자세한 내용은 ' },
      { kind: 'link', text: 'https://crazyshot.kr/products/a', href: 'https://crazyshot.kr/products/a' },
      { kind: 'text', text: ' 에서 확인하세요' },
    ])
  })
  it('www. 주소는 https://를 붙여 연다(보이는 글자는 그대로)', () => {
    expect(links('www.crazyshot.kr 입니다')).toEqual([{ kind: 'link', text: 'www.crazyshot.kr', href: 'https://www.crazyshot.kr/' }])
  })
  it('문장 끝 마침표·쉼표·물음표·닫는 괄호는 주소에서 뺀다', () => {
    expect(links('주소는 https://crazyshot.kr/a.')[0]).toMatchObject({ text: 'https://crazyshot.kr/a' })
    expect(links('(https://crazyshot.kr/a)')[0]).toMatchObject({ text: 'https://crazyshot.kr/a' })
    expect(links('https://crazyshot.kr/a, 그리고')[0]).toMatchObject({ text: 'https://crazyshot.kr/a' })
  })
  it('주소 안의 괄호는 유지한다', () => {
    expect(links('https://ko.wikipedia.org/wiki/A_(B)')[0]).toMatchObject({ text: 'https://ko.wikipedia.org/wiki/A_(B)' })
  })
  it('한글 조사는 주소에 포함하지 않는다', () => {
    expect(links('https://crazyshot.kr를 확인')[0]).toMatchObject({ text: 'https://crazyshot.kr' })
  })
  it('쿼리 문자열이 있는 주소와 한 글에 여러 주소', () => {
    const r = links('https://a.kr/x?y=1&z=2 와 http://b.kr')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ text: 'https://a.kr/x?y=1&z=2' })
  })
  it('javascript:·data:·mailto: 같은 스킴은 링크로 만들지 않는다', () => {
    expect(links('javascript:alert(1) data:text/html,x mailto:a@b.kr')).toEqual([])
  })
  it('www. 앞에 글자가 붙은 단어는 링크로 만들지 않는다', () => {
    expect(links('awww.x.kr')).toEqual([])
  })
  it('주소가 없는 글·빈 값은 글자 한 조각 그대로', () => {
    expect(linkifyText('안녕하세요')).toEqual([{ kind: 'text', text: '안녕하세요' }])
    expect(linkifyText('')).toEqual([{ kind: 'text', text: '' }])
    expect(linkifyText(null)).toEqual([{ kind: 'text', text: '' }])
  })
  it('조각을 이어 붙이면 원문과 같다(글자 손실 없음)', () => {
    const t = '보세요: https://crazyshot.kr/a. 감사합니다 www.x.kr!'
    expect(linkifyText(t).map((s) => s.text).join('')).toBe(t)
  })
})
