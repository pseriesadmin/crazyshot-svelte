import { describe, it, expect } from 'vitest'
import { sanitizeArchiveHtml } from '$lib/server/contractArchive/sanitizeArchiveHtml'

describe('sanitizeArchiveHtml — PDF 렌더 전 실행 가능한 요소 제거', () => {
  it('script 블록(내용 포함)을 제거하고 계약서 본문은 유지한다', () => {
    const out = sanitizeArchiveHtml('<div class="contract-wrap"><p>임대인 홍길동</p><script>fetch("https://evil.example/x")</script><b>끝</b></div>')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toContain('evil.example')
    expect(out).toContain('<p>임대인 홍길동</p>')
    expect(out).toContain('<b>끝</b>')
  })

  it('대소문자·공백이 섞인 script 변형과 닫히지 않은 script도 제거한다', () => {
    expect(sanitizeArchiveHtml('<SCRIPT >alert(1)</SCRIPT >x')).toBe('x')
    expect(sanitizeArchiveHtml('a<script src="https://evil.example/a.js">b')).not.toMatch(/<script/i)
  })

  it('이벤트 핸들러 속성은 한 태그에 여러 개여도 모두 제거한다', () => {
    const out = sanitizeArchiveHtml('<img src="data:image/png;base64,AAAA" alt="서명" onerror="alert(1)" onload=\'x()\' ONCLICK=y>')
    expect(out).not.toMatch(/on(error|load|click)/i)
    expect(out).toContain('src="data:image/png;base64,AAAA"')
    expect(out).toContain('alt="서명"')
  })

  it('iframe·object·embed·link·base·meta refresh를 제거한다', () => {
    const out = sanitizeArchiveHtml('<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><link rel="stylesheet" href="https://evil.example/a.css"><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">ok')
    expect(out).toBe('ok')
  })

  it('javascript: 주소를 무력화한다', () => {
    const out = sanitizeArchiveHtml('<a href="javascript:alert(1)">링크</a>')
    expect(out).not.toMatch(/javascript:/i)
    expect(out).toContain('링크')
  })

  it('표·스타일·서명 이미지 등 정상 계약서 마크업은 그대로 둔다', () => {
    const html = '<style>.a{color:red}</style><table><tr><td class="a">박상진 (인)<img src="data:image/png;base64,AAAA" alt="예약자 서명" class="customer-sig-overlay" style="width:80px"></td></tr></table>'
    expect(sanitizeArchiveHtml(html)).toBe(html)
  })

  it('금지 요소가 치환 뒤 다시 조립되는 중첩 입력도 제거한다', () => {
    expect(sanitizeArchiveHtml('<scr<script></script>ipt>alert(1)</scr<script></script>ipt>')).not.toMatch(/<script/i)
    expect(sanitizeArchiveHtml('<ifr<iframe></iframe>ame src="https://evil.example"></ifr<iframe></iframe>ame>')).not.toMatch(/<iframe/i)
  })
})
