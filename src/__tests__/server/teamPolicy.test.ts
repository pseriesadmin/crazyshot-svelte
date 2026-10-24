import { describe, it, expect } from 'vitest'
import { parseTeamPolicyBlocks, prepareTeamPolicyForView, TEAM_POLICY_MAX_BLOCKS } from '$lib/server/teamPolicy'

describe('팀 정책 저장 입력 검증(parseTeamPolicyBlocks)', () => {
  it('빈 값·깨진 JSON·배열이 아닌 값은 거절한다', () => {
    expect(parseTeamPolicyBlocks('').ok).toBe(false)
    expect(parseTeamPolicyBlocks('{').ok).toBe(false)
    expect(parseTeamPolicyBlocks('{"type":"text"}').ok).toBe(false)
    expect(parseTeamPolicyBlocks(null).ok).toBe(false)
  })
  it('빈 배열(내용 비우기)과 정상 블록은 통과한다', () => {
    expect(parseTeamPolicyBlocks('[]')).toEqual({ ok: true, blocks: [] })
    const r = parseTeamPolicyBlocks(JSON.stringify([{ type: 'text', html: '<p>팀</p>' }, { type: 'divider' }]))
    expect(r.ok).toBe(true)
  })
  it('알 수 없는 블록 종류·객체가 아닌 항목은 거절한다', () => {
    expect(parseTeamPolicyBlocks(JSON.stringify([{ type: 'script', html: 'x' }])).ok).toBe(false)
    expect(parseTeamPolicyBlocks(JSON.stringify(['text'])).ok).toBe(false)
    expect(parseTeamPolicyBlocks(JSON.stringify([null])).ok).toBe(false)
  })
  it('블록 수·전체 크기 상한을 넘으면 거절한다', () => {
    const many = Array.from({ length: TEAM_POLICY_MAX_BLOCKS + 1 }, () => ({ type: 'divider' }))
    expect(parseTeamPolicyBlocks(JSON.stringify(many)).ok).toBe(false)
    const big = [{ type: 'text', html: 'a'.repeat(1_000_001) }]
    expect(parseTeamPolicyBlocks(JSON.stringify(big)).ok).toBe(false)
    // DB는 글자 수가 아니라 바이트(한글 3바이트·jsonb 공백 포함)로 센다 — 글자 수가 한도 안이어도 바이트가 크면 서버에서 먼저 거절한다
    const korean = [{ type: 'text', html: '가'.repeat(400_000) }]
    expect(JSON.stringify(korean).length).toBeLessThan(1_000_000)
    expect(parseTeamPolicyBlocks(JSON.stringify(korean)).ok).toBe(false)
    const nearLimit = [{ type: 'text', html: 'a'.repeat(940_000) }]
    expect(parseTeamPolicyBlocks(JSON.stringify(nearLimit)).ok).toBe(false)
  })
})

describe('고객 화면용 정화(prepareTeamPolicyForView)', () => {
  it('텍스트의 스크립트·이벤트 속성·javascript 링크를 제거한다', () => {
    const out = prepareTeamPolicyForView([
      { type: 'text', html: '<p onclick="x()">안녕</p><script>alert(1)</script><a href="javascript:alert(1)">링크</a>' },
    ])
    const html = (out[0] as { html: string }).html
    expect(html).toContain('안녕')
    expect(html).not.toMatch(/script|onclick|javascript:/i)
  })
  it('안전하지 않은 이미지 주소·유튜브 ID·링크 주소는 블록에서 걸러낸다', () => {
    const out = prepareTeamPolicyForView([
      { type: 'image', layout: 'individual', images: [{ url: 'javascript:alert(1)', alt: 'x' }, { url: 'https://cdn.example/a.png', alt: '사진' }] },
      { type: 'youtube', videoId: '"><script>', url: '' },
      { type: 'youtube', videoId: 'dQw4w9WgXcQ', url: '' },
      { type: 'link-entry', url: 'javascript:alert(1)', text: '나쁜 링크' },
      { type: 'link-entry', url: 'https://example.com/team', text: '팀 페이지' },
    ])
    const types = out.map((b) => b.type)
    expect(types).toEqual(['image', 'youtube', 'link-entry'])
    expect((out[0] as { images: { url: string }[] }).images.map((i) => i.url)).toEqual(['https://cdn.example/a.png'])
    expect((out[1] as { videoId: string }).videoId).toBe('dQw4w9WgXcQ')
    expect((out[2] as { url: string }).url).toBe('https://example.com/team')
  })
  it('잘못된 입력(배열 아님)은 빈 배열', () => {
    expect(prepareTeamPolicyForView(null)).toEqual([])
    expect(prepareTeamPolicyForView('x')).toEqual([])
  })
})
